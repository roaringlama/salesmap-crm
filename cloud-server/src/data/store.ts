import type { CRMData } from '../types';
import { createInitialData } from './seed';
import { validateData } from './validate';
import { captureCloudScope, detectStorage, loadCloudData, saveCloudData, RevisionConflictError } from './cloud';
export { validateBackup } from './validate';
export { getStorageInfo, refreshStorageInfo, switchWorkspace, RevisionConflictError, CloudAuthError, CloudConnectionError, CloudPermissionError, CloudScopeChangedError } from './cloud';
export type { StorageInfo, CloudUser, CloudWorkspace, WorkspaceRole } from './cloud';

const DATABASE_NAME = 'sumavision-europe-crm';
const STORE = 'snapshots';
const KEY = 'current';
let connection: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onerror = () => { connection = undefined; reject(request.error ?? new Error('无法打开本地数据库')); };
    request.onblocked = () => { connection = undefined; reject(new Error('本地数据库升级被其他标签页阻止，请关闭其他标签页后重试。')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
  });
  return connection;
}

export async function loadData(): Promise<CRMData> {
  const storage = await detectStorage();
  if (storage.mode === 'cloud') return loadCloudData();
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    // A single readwrite transaction makes first-run seeding atomic across tabs.
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let snapshot: CRMData;
    let failure: unknown;
    const request = store.get(KEY);
    request.onsuccess = () => {
      try {
        if (request.result === undefined) {
          snapshot = validateData(createInitialData());
          store.add(snapshot, KEY);
        } else snapshot = validateData(request.result);
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(snapshot);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('无法读取本地数据'));
    transaction.onerror = () => { failure ??= transaction.error; };
  });
}

export async function saveData(next: CRMData, expectedRevision: number): Promise<CRMData> {
  // Capture before any await: a background reload may select another account
  // while validation or mode detection is in flight.
  const scope = captureCloudScope();
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER) throw new Error('数据版本无效，请刷新页面后重试。');
  const validated = validateData(next);
  const storage = await detectStorage();
  if (storage.mode === 'cloud') return saveCloudData(validated, expectedRevision, scope);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(KEY);
    let result: CRMData;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const existing = request.result as CRMData | undefined;
        if (!existing || existing.revision !== expectedRevision) throw new RevisionConflictError();
        result = { ...validated, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
        store.put(result, KEY);
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('保存失败，本地数据没有改变。请检查浏览器存储空间。'));
    transaction.onerror = () => { failure ??= transaction.error; };
  });
}

// Used by automated tests to emulate closing/reopening the browser connection.
export async function closeDatabase(): Promise<void> {
  if (!connection) return;
  const db = await connection;
  db.close(); connection = undefined;
}
