import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CRMData } from './types';
import { buildBackup, buildExcel } from './data/export';
import { createInitialData } from './data/seed';
import { closeDatabase, loadData, RevisionConflictError, saveData, validateBackup } from './data/store';
import { fixtureData as fullFixture } from './test/fixtures';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('sumavision-europe-crm');
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Test database was not closed'));
  });
}
beforeEach(async () => { await closeDatabase(); await deleteDatabase(); });

async function populatedData(): Promise<CRMData> {
  const empty = await loadData();
  return saveData(fullFixture(), empty.revision);
}

describe('IndexedDB durability and concurrent tabs', () => {
  it('starts empty and persists records when the connection is reopened', async () => {
    const data = await loadData();
    expect(data.customers).toHaveLength(0); expect(data.projects).toHaveLength(0); expect(data.cases).toHaveLength(0);
    const fixture = fullFixture();
    fixture.customers[0].name = '示例代理商编辑后'; fixture.projects[0].stages[0].notes[0].content = '付款跟进的新备注';
    const saved = await saveData(fixture, data.revision);
    expect(saved.revision).toBe(1);
    await closeDatabase();
    const reopened = await loadData();
    expect(reopened).toEqual(saved);
    expect(reopened.customers[0].name).toBe('示例代理商编辑后');
    expect(reopened.projects[0].stages[0].notes[0].content).toBe('付款跟进的新备注');
  });

  it('atomically initializes once when two tabs start together', async () => {
    const [first, second] = await Promise.all([loadData(), loadData()]);
    expect(first).toEqual(second); expect(first.revision).toBe(0);
    expect(first.projects).toEqual([]);
  });

  it('rejects a stale revision without overwriting another tab', async () => {
    const first = await populatedData(), stale = structuredClone(first);
    first.customers[0].notes = '先保存的内容';
    const saved = await saveData(first, first.revision);
    stale.customers[0].notes = '过期标签页的内容';
    await expect(saveData(stale, stale.revision)).rejects.toBeInstanceOf(RevisionConflictError);
    expect(await loadData()).toEqual(saved);
  });

  it('allows exactly one winner when simultaneous writes share a revision', async () => {
    const initial = await populatedData(), other = structuredClone(initial);
    initial.customers[0].notes = '写入 A'; other.customers[0].notes = '写入 B';
    const results = await Promise.allSettled([saveData(initial, initial.revision), saveData(other, other.revision)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await loadData()).revision).toBe(2);
  });

  it('rejects an invalid import before changing stored data', async () => {
    const saved = await populatedData(), bad = structuredClone(saved);
    bad.projects[0].customerId = 'missing-customer';
    await expect(saveData(bad, saved.revision)).rejects.toThrow('关联客户不存在');
    expect(await loadData()).toEqual(saved);
  });

  it('does not reseed after all initial records were intentionally deleted', async () => {
    const initial = await populatedData();
    initial.customers = []; initial.projects = []; initial.cases = []; initial.relationships = [];
    await saveData(initial, initial.revision);
    await closeDatabase();
    const reopened = await loadData();
    expect(reopened.customers).toEqual([]); expect(reopened.projects).toEqual([]); expect(reopened.revision).toBe(2);
  });

  it('restores a complete backup atomically using the current database revision', async () => {
    const initial = await populatedData();
    initial.customers[0].notes = '恢复前的工作数据';
    const current = await saveData(initial, initial.revision);
    const restored = validateBackup(JSON.parse(JSON.stringify(buildBackup(fullFixture()))));
    const saved = await saveData(restored, current.revision);
    expect(saved.revision).toBe(3);
    await closeDatabase();
    const reopened = await loadData();
    expect(reopened).toEqual(saved);
    expect(reopened.cases[0].serialNumbers).toEqual(['SN-1', 'SN-2']);
    expect(reopened.projects[0].logs[0].content).toBe('项目沟通');
    expect(reopened.customers[0].contacts[0].email).toBe('contact@example.test');
  });
});

describe('complete backup validation', () => {
  it('round trips contacts, stages, multiple logs and linked cases with no loss', () => {
    const fixture = fullFixture();
    const restored = validateBackup(JSON.parse(JSON.stringify(buildBackup(fixture))));
    expect(restored).toEqual(fixture);
    restored.customers[0].notes = 'independent clone';
    expect(fixture.customers[0].notes).not.toBe('independent clone');
  });

  it('requires the supported explicit backup envelope', () => {
    expect(() => validateBackup(createInitialData())).toThrow('缺少字段');
    const backup = buildBackup(createInitialData());
    expect(() => validateBackup({ ...backup, version: 2 })).toThrow('版本');
    expect(() => validateBackup({ ...backup, format: 'unrelated-app' })).toThrow('sumavision-crm');
  });

  it('normalizes older v1 backups without relationships without changing the input', () => {
    const { relationships: _relationships, ...legacy } = fullFixture();
    const backup = { format: 'sumavision-crm', version: 1, exportedAt: new Date().toISOString(), data: legacy };
    expect(validateBackup(backup).relationships).toEqual([]);
    expect('relationships' in legacy).toBe(false);
    expect(validateBackup(backup).customers).toEqual(legacy.customers);
  });

  it('keeps existing legacy IndexedDB records when a deployment starts with an empty seed', async () => {
    const { relationships: _relationships, ...legacy } = fullFixture();
    legacy.revision = 17;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('sumavision-europe-crm', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('snapshots', 'readwrite');
        transaction.objectStore('snapshots').put(legacy, 'current');
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
    const loaded = await loadData();
    expect(loaded.customers).toEqual(legacy.customers);
    expect(loaded.projects).toEqual(legacy.projects);
    expect(loaded.cases).toEqual(legacy.cases);
    expect(loaded.revision).toBe(17);
    expect(loaded.relationships).toEqual([]);
  });

  const invalidMutations: [string, (data: CRMData) => void][] = [
    ['duplicate customer ID', data => { data.customers[1].id = data.customers[0].id; }],
    ['duplicate nested ID globally', data => { data.projects[0].logs[0].id = data.customers[0].contacts[0].id; }],
    ['duplicate stage ID', data => { data.projects[0].stages[1].id = data.projects[0].stages[0].id; }],
    ['unknown stage status', data => { data.projects[0].stages[0].status = '未知状态' as never; }],
    ['unknown customer enum', data => { data.customers[0].type = '虚构类型' as never; }],
    ['unknown case enum', data => { data.cases[0].priority = '未知' as never; }],
    ['wrong nested type', data => { data.customers[0].contacts[0].email = 123 as never; }],
    ['wrong archived type', data => { data.customers[0].archived = 'false' as never; }],
    ['missing nested field', data => { delete (data.projects[0].logs[0] as Partial<typeof data.projects[0]['logs'][number]>).result; }],
    ['wrong currency', data => { data.projects[0].currency = 'EURO'; }],
    ['missing currency for amount', data => { data.projects[0].currency = ''; }],
    ['non-finite amount', data => { data.projects[0].amount = Infinity; }],
    ['negative quantity', data => { data.projects[0].quantity = -1; }],
    ['fractional quantity', data => { data.projects[0].quantity = 2.5; }],
    ['invalid real date', data => { data.projects[0].lastFollowup = '2026-02-30'; }],
    ['wrong date format', data => { data.cases[0].reportedDate = '10/10/2026'; }],
    ['invalid timestamp', data => { data.updatedAt = '2026-10-10T99:00:00Z'; }],
    ['missing customer link', data => { data.projects[0].customerId = 'missing'; }],
    ['missing project link', data => { data.cases[0].projectId = 'missing'; }],
    ['case links project owned by another customer', data => { data.cases[0].projectId = data.projects[2].id; }],
    ['unknown current stage', data => { data.projects[0].currentStageId = 'missing-stage'; }],
    ['excessive text', data => { data.customers[0].notes = 'x'.repeat(100001); }],
    ['duplicate serial numbers', data => { data.cases[0].serialNumbers = ['same', 'same']; }],
    ['relationship references missing customer', data => { data.relationships[0].fromCustomerId = 'missing'; }],
    ['relationship references self', data => { data.relationships[0].toCustomerId = data.relationships[0].fromCustomerId; }],
    ['duplicate relationship global ID', data => { data.relationships[0].id = data.customers[0].id; }],
    ['duplicate relationship pair', data => { data.relationships.push({ ...data.relationships[0], id: 'another-relationship' }); }],
    ['invalid relationship type', data => { data.relationships[0].type = '未知关系' as never; }],
  ];
  it.each(invalidMutations)('rejects %s', (_name, mutate) => {
    const data = fullFixture(); mutate(data);
    expect(() => validateBackup({ format: 'sumavision-crm', version: 1, exportedAt: new Date().toISOString(), data })).toThrow('数据格式不正确');
  });

  it('permits an after-sales case independent of a project and unknown historical dates', () => {
    const data = fullFixture(); data.cases[0].projectId = '';
    expect(validateBackup(buildBackup(data)).cases[0].projectId).toBe('');
    expect(data.projects.every(project => !project.lastFollowup && !project.nextFollowup)).toBe(true);
  });
});

describe('public deployment and Excel report', () => {
  it('does not embed any real customers or business data in a new deployment', () => {
    const data = createInitialData();
    expect(data.customers).toEqual([]);
    expect(data.projects).toEqual([]);
    expect(data.cases).toEqual([]);
    expect(data.relationships).toEqual([]);
  });

  it('creates three main reports and full detail sheets with numeric amounts and blank unknowns', async () => {
    const data = fullFixture();
    data.customers[0].name = '=HYPERLINK("https://example.test")';
    const workbook = await buildExcel(data);
    expect(workbook.worksheets.slice(0, 3).map(worksheet => worksheet.name)).toEqual(['客户总表', '项目跟踪表', '售后跟踪表']);
    const customerSheet = workbook.getWorksheet('客户总表')!;
    expect(customerSheet.getRow(2).getCell('name').value).toBe('=HYPERLINK("https://example.test")');
    expect(customerSheet.getRow(2).getCell('name').type).toBe(3); // Plain string, not an Excel formula.
    const projectSheet = workbook.getWorksheet('项目跟踪表')!;
    expect(projectSheet.getRow(2).getCell('amount').value).toBe(1000);
    expect(projectSheet.getRow(3).getCell('amount').value).toBeNull();
    expect(projectSheet.getRow(4).getCell('amountKind').value).toBe('已回款');
    expect(projectSheet.getRow(4).getCell('receivedAmount').value).toBe(400);
    expect(workbook.getWorksheet('售后跟踪表')!.getRow(2).getCell('serialNumbers').value).toBe('SN-1\nSN-2');
    expect(workbook.getWorksheet('跟进日志')!.rowCount).toBe(4);
    expect(workbook.getWorksheet('阶段备注')!.rowCount).toBeGreaterThan(20);
    expect(workbook.getWorksheet('客户联系人')!.rowCount).toBe(2);
    expect(workbook.getWorksheet('客户关系')!.getRow(2).getCell('type').value).toBe('代理关系');
    expect(workbook.getWorksheet('客户关系')!.getRow(2).getCell('fromCustomer').value).toBe(data.customers[0].name);
    const buffer = await workbook.xlsx.writeBuffer();
    const module = await import('exceljs');
    const ExcelJS = module.default ?? module;
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);
    expect(reopened.getWorksheet('项目跟踪表')!.getCell('G2').value).toBe(1000);
    expect(reopened.getWorksheet('售后跟踪表')!.getCell('A2').value).toBe('RMA-TEST');
  }, 30000);

  it('preserves exceptionally long notes in Excel continuation rows', async () => {
    const data = fullFixture();
    const content = '完整备注😀'.repeat(10000);
    data.customers[0].notes = content;
    const workbook = await buildExcel(data);
    const mainCell = workbook.getWorksheet('客户总表')!.getRow(2).getCell('notes');
    expect(String(mainCell.value).length).toBeLessThanOrEqual(32767);
    const continuation = workbook.getWorksheet('长文本续篇')!;
    expect(continuation).toBeDefined();
    const restored: string[] = [];
    continuation.eachRow((row, rowNumber) => { if (rowNumber > 1) restored.push(String(row.getCell('content').value)); });
    expect(restored.join('')).toBe(content);
    expect((await workbook.xlsx.writeBuffer()).byteLength).toBeGreaterThan(0);
  });
});
