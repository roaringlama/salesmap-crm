import { CASE_STATUSES, CUSTOMER_STATUSES, CUSTOMER_TYPES, PRODUCTS, PROJECT_STATUSES, RELATIONSHIP_TYPES, SALES_STAGES, SERVICE_STAGES, STAGE_STATUSES, type CRMData } from '../types';

const MAX_RECORDS = 20000;
const MAX_NESTED = 100000;
const MAX_TEXT = 100000;
type ObjectValue = Record<string, unknown>;

function fail(path: string, reason: string): never { throw new Error(`数据格式不正确：${path} ${reason}`); }
function object(value: unknown, path: string): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, '必须是对象');
  return value as ObjectValue;
}
function fields(value: ObjectValue, required: string[], path: string) {
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${path}.${key}`, '缺少字段');
  for (const key of Object.keys(value)) if (!required.includes(key)) fail(`${path}.${key}`, '包含不支持的字段');
}
function text(value: unknown, path: string, maximum = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length > maximum) fail(path, `必须是字符串且不超过 ${maximum} 字符`);
  return value;
}
function enumeration(value: unknown, choices: readonly string[], path: string) {
  if (typeof value !== 'string' || !choices.includes(value)) fail(path, '不是有效的选项');
}
function array(value: unknown, path: string, maximum = MAX_RECORDS): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `必须是数组且不超过 ${maximum} 条`);
  return value;
}
function date(value: unknown, path: string) {
  const valueString = text(value, path, 10);
  if (!valueString) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueString)) fail(path, '日期必须为 YYYY-MM-DD 或空字符串');
  const parsed = new Date(`${valueString}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== valueString) fail(path, '日期不存在');
}
function timestamp(value: unknown, path: string) {
  const valueString = text(value, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(valueString) || !Number.isFinite(Date.parse(valueString))) fail(path, '必须是有效的 UTC ISO 时间');
  date(valueString.slice(0, 10), path);
  const timeParts = valueString.slice(11, 19).split(':').map(Number);
  if (timeParts[0] > 23 || timeParts[1] > 59 || timeParts[2] > 59) fail(path, '时间不存在');
}
function number(value: unknown, path: string, integer = false) {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e15 || (integer && !Number.isSafeInteger(value))) fail(path, integer ? '必须是非负整数或 null' : '必须是有限非负数字或 null');
}

export function validateData(input: unknown): CRMData {
  const original = object(input, 'data');
  // Existing v1 IndexedDB snapshots and backups remain valid. Normalization is
  // detached from the input and never resets or rewrites the existing database.
  const data = Object.prototype.hasOwnProperty.call(original, 'relationships') ? original : { ...original, relationships: [] };
  fields(data, ['schemaVersion', 'revision', 'updatedAt', 'customers', 'projects', 'cases', 'relationships'], 'data');
  if (data.schemaVersion !== 1) fail('data.schemaVersion', '版本不受支持');
  if (typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0) fail('data.revision', '必须是非负安全整数');
  timestamp(data.updatedAt, 'data.updatedAt');
  const customers = array(data.customers, 'data.customers');
  const projects = array(data.projects, 'data.projects');
  const cases = array(data.cases, 'data.cases');
  const relationships = array(data.relationships, 'data.relationships');
  if (customers.length + projects.length + cases.length + relationships.length > MAX_RECORDS) fail('data', `记录总数不能超过 ${MAX_RECORDS}`);
  const ids = new Set<string>();
  const customerIds = new Set<string>();
  const projectCustomers = new Map<string, string>();
  let nestedCount = 0;
  function id(value: unknown, path: string) {
    const result = text(value, path, 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) fail(path, 'ID 必须为非空字母、数字、点、下划线、冒号或连字符');
    if (ids.has(result)) fail(path, 'ID 重复');
    ids.add(result);
    return result;
  }
  function nested(value: unknown, path: string, maximum = 5000) {
    const values = array(value, path, maximum);
    nestedCount += values.length;
    if (nestedCount > MAX_NESTED) fail(path, `嵌套记录总数不能超过 ${MAX_NESTED}`);
    return values;
  }
  function base(value: ObjectValue, path: string) {
    id(value.id, `${path}.id`);
    if (typeof value.archived !== 'boolean') fail(`${path}.archived`, '必须是布尔值');
    timestamp(value.createdAt, `${path}.createdAt`);
    timestamp(value.updatedAt, `${path}.updatedAt`);
  }
  function logs(value: unknown, path: string) {
    nested(value, path).forEach((entry, index) => {
      const name = `${path}[${index}]`, log = object(entry, name);
      fields(log, ['id', 'date', 'contact', 'content', 'result', 'nextStep'], name);
      id(log.id, `${name}.id`); date(log.date, `${name}.date`);
      for (const key of ['contact', 'content', 'result', 'nextStep']) text(log[key], `${name}.${key}`);
    });
  }
  function stages(value: unknown, path: string, current: unknown, service = false) {
    const choices = (service ? SERVICE_STAGES : SALES_STAGES).map(s => s.id) as string[];
    const seen = new Set<string>();
    nested(value, path, 5).forEach((entry, index) => {
      const name = `${path}[${index}]`, stage = object(entry, name);
      fields(stage, ['id', 'status', 'notes'], name);
      enumeration(stage.id, choices, `${name}.id`);
      if (seen.has(stage.id as string)) fail(`${name}.id`, '阶段 ID 重复');
      seen.add(stage.id as string);
      enumeration(stage.status, STAGE_STATUSES, `${name}.status`);
      nested(stage.notes, `${name}.notes`).forEach((entryNote, noteIndex) => {
        const noteName = `${name}.notes[${noteIndex}]`, note = object(entryNote, noteName);
        fields(note, ['id', 'date', 'content'], noteName);
        id(note.id, `${noteName}.id`); date(note.date, `${noteName}.date`); text(note.content, `${noteName}.content`);
      });
    });
    const currentId = text(current, `${path}.currentStageId`, 30);
    if (currentId && !seen.has(currentId)) fail(`${path}.currentStageId`, '当前阶段必须存在于本记录的阶段列表');
  }
  const baseFields = ['id', 'archived', 'createdAt', 'updatedAt'];
  customers.forEach((entry, index) => {
    const path = `data.customers[${index}]`, customer = object(entry, path);
    fields(customer, [...baseFields, 'name', 'country', 'region', 'type', 'status', 'contacts', 'interests', 'lastFollowup', 'nextFollowup', 'background', 'notes', 'logs'], path);
    base(customer, path); customerIds.add(customer.id as string);
    for (const key of ['name', 'country', 'region']) text(customer[key], `${path}.${key}`, 500);
    if (!(customer.name as string).trim()) fail(`${path}.name`, '客户名称不能为空');
    enumeration(customer.type, CUSTOMER_TYPES, `${path}.type`); enumeration(customer.status, CUSTOMER_STATUSES, `${path}.status`);
    const interests = array(customer.interests, `${path}.interests`, PRODUCTS.length);
    interests.forEach((value, i) => enumeration(value, PRODUCTS, `${path}.interests[${i}]`));
    if (new Set(interests).size !== interests.length) fail(`${path}.interests`, '产品兴趣不能重复');
    nested(customer.contacts, `${path}.contacts`, 1000).forEach((entryContact, contactIndex) => {
      const contactPath = `${path}.contacts[${contactIndex}]`, contact = object(entryContact, contactPath);
      fields(contact, ['id', 'name', 'title', 'email', 'phone'], contactPath);
      id(contact.id, `${contactPath}.id`);
      for (const key of ['name', 'title', 'email', 'phone']) text(contact[key], `${contactPath}.${key}`, 1000);
    });
    date(customer.lastFollowup, `${path}.lastFollowup`); date(customer.nextFollowup, `${path}.nextFollowup`);
    text(customer.background, `${path}.background`); text(customer.notes, `${path}.notes`); logs(customer.logs, `${path}.logs`);
  });
  projects.forEach((entry, index) => {
    const path = `data.projects[${index}]`, project = object(entry, path);
    fields(project, [...baseFields, 'name', 'customerId', 'country', 'relatedParty', 'product', 'quantity', 'amount', 'currency', 'amountKind', 'receivedAmount', 'po', 'pi', 'status', 'lastFollowup', 'nextFollowup', 'owner', 'notes', 'currentStageId', 'stages', 'logs'], path);
    base(project, path);
    const customerId = text(project.customerId, `${path}.customerId`, 200);
    if (!customerIds.has(customerId)) fail(`${path}.customerId`, '关联客户不存在');
    projectCustomers.set(project.id as string, customerId);
    for (const key of ['name', 'country', 'relatedParty', 'product', 'po', 'pi', 'owner']) text(project[key], `${path}.${key}`, 2000);
    if (!(project.name as string).trim()) fail(`${path}.name`, '项目名称不能为空');
    number(project.quantity, `${path}.quantity`, true); number(project.amount, `${path}.amount`); number(project.receivedAmount, `${path}.receivedAmount`);
    const currency = text(project.currency, `${path}.currency`, 3);
    if (currency && !/^[A-Z]{3}$/.test(currency)) fail(`${path}.currency`, '币种必须为三位大写字母或空字符串');
    if ((project.amount !== null || project.receivedAmount !== null) && !currency) fail(`${path}.currency`, '填写金额时必须填写币种');
    enumeration(project.amountKind, ['待确认', '预计金额', '框架金额', '确认订单', '已回款'], `${path}.amountKind`);
    enumeration(project.status, PROJECT_STATUSES, `${path}.status`);
    date(project.lastFollowup, `${path}.lastFollowup`); date(project.nextFollowup, `${path}.nextFollowup`);
    text(project.notes, `${path}.notes`); stages(project.stages, `${path}.stages`, project.currentStageId); logs(project.logs, `${path}.logs`);
  });
  cases.forEach((entry, index) => {
    const path = `data.cases[${index}]`, serviceCase = object(entry, path);
    fields(serviceCase, [...baseFields, 'caseNumber', 'customerId', 'projectId', 'product', 'serialNumbers', 'issue', 'priority', 'reportedDate', 'status', 'nextStep', 'nextFollowup', 'currentStageId', 'stages', 'logs'], path);
    base(serviceCase, path);
    const customerId = text(serviceCase.customerId, `${path}.customerId`, 200);
    if (!customerIds.has(customerId)) fail(`${path}.customerId`, '关联客户不存在');
    const projectId = text(serviceCase.projectId, `${path}.projectId`, 200);
    if (projectId && projectCustomers.get(projectId) !== customerId) fail(`${path}.projectId`, '关联项目必须存在且属于同一客户');
    text(serviceCase.caseNumber, `${path}.caseNumber`, 500);
    if (!(serviceCase.caseNumber as string).trim()) fail(`${path}.caseNumber`, '案例编号不能为空');
    text(serviceCase.product, `${path}.product`, 2000); text(serviceCase.issue, `${path}.issue`); text(serviceCase.nextStep, `${path}.nextStep`);
    const serialNumbers = nested(serviceCase.serialNumbers, `${path}.serialNumbers`, 5000);
    serialNumbers.forEach((serialNumber, i) => text(serialNumber, `${path}.serialNumbers[${i}]`, 500));
    if (new Set(serialNumbers).size !== serialNumbers.length) fail(`${path}.serialNumbers`, '设备 SN 不能重复');
    enumeration(serviceCase.priority, ['低', '中', '高', '紧急'], `${path}.priority`); enumeration(serviceCase.status, CASE_STATUSES, `${path}.status`);
    date(serviceCase.reportedDate, `${path}.reportedDate`); date(serviceCase.nextFollowup, `${path}.nextFollowup`);
    stages(serviceCase.stages, `${path}.stages`, serviceCase.currentStageId, true); logs(serviceCase.logs, `${path}.logs`);
  });
  const relationshipPairs = new Set<string>();
  relationships.forEach((entry, index) => {
    const path = `data.relationships[${index}]`, relationship = object(entry, path);
    fields(relationship, ['id', 'fromCustomerId', 'toCustomerId', 'type', 'notes'], path);
    id(relationship.id, `${path}.id`);
    const from = text(relationship.fromCustomerId, `${path}.fromCustomerId`, 200);
    const to = text(relationship.toCustomerId, `${path}.toCustomerId`, 200);
    if (!customerIds.has(from) || !customerIds.has(to)) fail(path, '关系两端的客户必须存在');
    if (from === to) fail(path, '客户不能与自身建立关系');
    enumeration(relationship.type, RELATIONSHIP_TYPES, `${path}.type`);
    text(relationship.notes, `${path}.notes`);
    const pair = JSON.stringify([from, to, relationship.type]);
    if (relationshipPairs.has(pair)) fail(path, '同一方向和类型的客户关系不能重复');
    relationshipPairs.add(pair);
  });
  // Return a detached plain snapshot; the caller cannot mutate the validated input afterwards.
  return structuredClone(data) as unknown as CRMData;
}

export function validateBackup(input: unknown): CRMData {
  const backup = object(input, 'backup');
  fields(backup, ['format', 'version', 'exportedAt', 'data'], 'backup');
  if (backup.format !== 'sumavision-crm') fail('backup.format', '仅支持本系统导出的 sumavision-crm JSON 备份');
  if (backup.version !== 1) fail('backup.version', '备份版本不受支持，仅支持版本 1');
  timestamp(backup.exportedAt, 'backup.exportedAt');
  return validateData(backup.data);
}
