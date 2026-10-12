import type { Workbook, Worksheet } from 'exceljs';
import { SALES_STAGES, SERVICE_STAGES, today, type CRMData } from '../types';
import { validateData } from './validate';

export interface BackupFile { format: 'sumavision-crm'; version: 1; exportedAt: string; data: CRMData }
export function buildBackup(data: CRMData): BackupFile {
  return { format: 'sumavision-crm', version: 1, exportedAt: new Date().toISOString(), data: validateData(data) };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  // Keep the Blob alive long enough for the browser to accept the download.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function exportBackup(data: CRMData): void {
  download(new Blob([JSON.stringify(buildBackup(data), null, 2)], { type: 'application/json;charset=utf-8' }), `SalesMap-完整备份-${today()}.json`);
}

type CellData = string | number | null;
type ExportColumn = { header: string; key: string; width?: number };
const overflowTexts = new WeakMap<Workbook, Record<string, CellData>[]>();
function sheet(workbook: Workbook, name: string, columns: ExportColumn[], rows: Record<string, unknown>[]): Worksheet {
  const worksheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  worksheet.columns = columns.map(column => ({ width: 20, ...column }));
  rows.forEach(row => worksheet.addRow(row));
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: columns.length } };
  worksheet.getRow(1).height = 30;
  worksheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244E80' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    row.eachCell({ includeEmpty: true }, cell => {
      // Excel limits each cell to 32,767 characters. Preserve long records in a
      // separate continuation sheet rather than silently truncating the report.
      if (typeof cell.value === 'string' && cell.value.length > 32767) {
        const source = cell.value;
        const overflow = overflowTexts.get(workbook) ?? [];
        const field = worksheet.getRow(1).getCell(Number(cell.col)).text;
        for (let offset = 0, part = 1; offset < source.length; part++) {
          let end = Math.min(offset + 32000, source.length);
          if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1])) end--;
          overflow.push({ sheet: name, row: rowIndex, field, part, content: source.slice(offset, end) });
          offset = end;
        }
        overflowTexts.set(workbook, overflow);
        const previewEnd = /[\uD800-\uDBFF]/.test(source[31999]) ? 31999 : 32000;
        cell.value = `${source.slice(0, previewEnd)}\n[完整内容见「长文本续篇」：${name} 第 ${rowIndex} 行 / ${field}]`;
      }
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { size: 10 };
      if (rowIndex % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F6FA' } };
    });
  }
  return worksheet;
}
const column = (key: string, header: string, width = 20): ExportColumn => ({ key, header, width });

export async function buildExcel(data: CRMData): Promise<Workbook> {
  const snapshot = validateData(data);
  const module = await import('exceljs');
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SalesMap';
  workbook.created = new Date();
  const customerNames = new Map(snapshot.customers.map(customer => [customer.id, customer.name]));
  const projectNames = new Map(snapshot.projects.map(project => [project.id, project.name]));
  const archive = (value: boolean) => value ? '已归档' : '未归档';
  sheet(workbook, '客户总表', [
    column('name', '客户名称', 26), column('country', '国家', 15), column('region', '地区', 15), column('type', '客户类型'), column('status', '关系状态'), column('contacts', '联系人 / 职位 / 邮箱 / 电话', 46), column('interests', '产品兴趣', 28), column('lastFollowup', '最近跟进日期'), column('nextFollowup', '下次跟进日期'), column('projects', '关联销售项目数', 18), column('cases', '关联售后案例数', 18), column('background', '客户背景', 50), column('notes', '备注', 50), column('archived', '归档状态'), column('id', '客户 ID', 36), column('createdAt', '系统创建时间', 27), column('updatedAt', '系统更新时间', 27),
  ], snapshot.customers.map(customer => ({ ...customer, contacts: customer.contacts.map(contact => [contact.name, contact.title, contact.email, contact.phone].filter(Boolean).join(' / ')).join('\n'), interests: customer.interests.join('、'), projects: snapshot.projects.filter(project => project.customerId === customer.id).length, cases: snapshot.cases.filter(serviceCase => serviceCase.customerId === customer.id).length, archived: archive(customer.archived) })));
  const projects = sheet(workbook, '项目跟踪表', [
    column('name', '项目名称', 30), column('customer', '关联客户', 26), column('country', '所在国家', 15), column('relatedParty', '关联终端客户 / 代理商', 28), column('product', '产品型号', 30), column('quantity', '预计数量', 16), column('amount', '记录金额', 18), column('currency', '币种', 10), column('amountKind', '金额口径', 16), column('receivedAmount', '已回款金额', 18), column('po', '订单号 / PO'), column('pi', 'PI 编号'), column('status', '项目状态', 16), column('currentStage', '当前阶段'), ...SALES_STAGES.map(stage => column(stage.id, `${stage.name}状态`, 20)), column('lastFollowup', '最近跟进日期'), column('nextFollowup', '下次跟进日期'), column('owner', '负责人'), column('notes', '项目备注 / 金额与数量说明', 65), column('archived', '归档状态'), column('id', '项目 ID', 36), column('customerId', '客户 ID', 36), column('createdAt', '系统创建时间', 27), column('updatedAt', '系统更新时间', 27),
  ], snapshot.projects.map(project => ({ ...project, customer: customerNames.get(project.customerId)!, currentStage: SALES_STAGES.find(stage => stage.id === project.currentStageId)?.name ?? '', ...Object.fromEntries(SALES_STAGES.map(stage => [stage.id, project.stages.find(item => item.id === stage.id)?.status ?? '不适用'])), archived: archive(project.archived) })));
  projects.getColumn('amount').numFmt = '#,##0.00'; projects.getColumn('receivedAmount').numFmt = '#,##0.00'; projects.getColumn('quantity').numFmt = '#,##0';
  sheet(workbook, '售后跟踪表', [
    column('caseNumber', '案例编号', 26), column('customer', '关联客户', 26), column('project', '关联项目（可独立）', 30), column('product', '产品型号', 30), column('serialNumbers', '设备 SN', 35), column('issue', '故障描述', 60), column('priority', '优先级', 12), column('reportedDate', '报修日期'), column('status', '当前状态', 16), column('currentStage', '当前阶段', 26), ...SERVICE_STAGES.map(stage => column(stage.id, `${stage.name}状态`, 24)), column('nextStep', '下一步计划', 50), column('nextFollowup', '下次跟进日期'), column('archived', '归档状态'), column('id', '案例 ID', 36), column('customerId', '客户 ID', 36), column('projectId', '项目 ID', 36), column('createdAt', '系统创建时间', 27), column('updatedAt', '系统更新时间', 27),
  ], snapshot.cases.map(serviceCase => ({ ...serviceCase, customer: customerNames.get(serviceCase.customerId)!, project: projectNames.get(serviceCase.projectId) ?? '', serialNumbers: serviceCase.serialNumbers.join('\n'), currentStage: SERVICE_STAGES.find(stage => stage.id === serviceCase.currentStageId)?.name ?? '', ...Object.fromEntries(SERVICE_STAGES.map(stage => [stage.id, serviceCase.stages.find(item => item.id === stage.id)?.status ?? '不适用'])), archived: archive(serviceCase.archived) })));
  sheet(workbook, '客户联系人', [column('customer', '客户名称', 26), column('name', '姓名'), column('title', '职位', 25), column('email', '邮箱', 38), column('phone', '电话', 26), column('id', '联系人 ID', 36), column('customerId', '客户 ID', 36)], snapshot.customers.flatMap(customer => customer.contacts.map(contact => ({ ...contact, customer: customer.name, customerId: customer.id }))));
  const stageRows: Record<string, CellData>[] = [];
  for (const record of [...snapshot.projects, ...snapshot.cases]) {
    const service = 'caseNumber' in record;
    const definitions = service ? SERVICE_STAGES : SALES_STAGES;
    for (const stage of record.stages) {
      const base = { type: service ? '售后案例' : '销售项目', customer: customerNames.get(record.customerId)!, record: service ? record.caseNumber : record.name, stage: definitions.find(definition => definition.id === stage.id)?.name ?? stage.id, status: stage.status, recordId: record.id, archived: archive(record.archived) };
      if (stage.notes.length) stageRows.push(...stage.notes.map(note => ({ ...base, date: note.date, content: note.content, noteId: note.id })));
      else stageRows.push({ ...base, date: '', content: '', noteId: '' });
    }
  }
  sheet(workbook, '阶段备注', [column('type', '记录类型'), column('customer', '客户名称', 26), column('record', '项目名称 / 案例编号', 30), column('stage', '阶段', 25), column('status', '阶段状态'), column('date', '备注日期（空白为未知）', 25), column('content', '备注内容', 80), column('archived', '归档状态'), column('recordId', '关联记录 ID', 36), column('noteId', '备注 ID', 36)], stageRows);
  const followupRows: Record<string, CellData>[] = [];
  for (const record of [...snapshot.customers, ...snapshot.projects, ...snapshot.cases]) {
    const service = 'caseNumber' in record;
    const project = 'customerId' in record && !service;
    const type = service ? '售后案例' : project ? '销售项目' : '客户沟通';
    const customer = 'customerId' in record ? customerNames.get(record.customerId)! : record.name;
    const subject = service ? record.caseNumber : record.name;
    followupRows.push(...record.logs.map(log => ({ ...log, type, customer, subject, recordId: record.id, archived: archive(record.archived) })));
  }
  followupRows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  sheet(workbook, '跟进日志', [column('type', '记录类型'), column('customer', '客户名称', 26), column('subject', '客户 / 项目 / 案例', 30), column('date', '跟进日期'), column('contact', '沟通对象', 26), column('content', '沟通内容', 65), column('result', '结果', 50), column('nextStep', '下一步计划', 50), column('archived', '归档状态'), column('recordId', '关联记录 ID', 36), column('id', '日志 ID', 36)], followupRows);
  sheet(workbook, '客户关系', [column('fromCustomer', '来源客户', 26), column('type', '关系类型', 20), column('toCustomer', '目标客户', 26), column('notes', '关系备注', 65), column('id', '关系 ID', 36), column('fromCustomerId', '来源客户 ID', 36), column('toCustomerId', '目标客户 ID', 36)], snapshot.relationships.map(relationship => ({ ...relationship, fromCustomer: customerNames.get(relationship.fromCustomerId)!, toCustomer: customerNames.get(relationship.toCustomerId)! })));
  sheet(workbook, '导出说明', [column('item', '说明项', 26), column('description', '内容', 100)], [
    { item: '导出时间（UTC）', description: new Date().toISOString() },
    { item: '数据范围', description: '包含全部客户（含供应商资源）、销售项目、售后案例和已归档记录；可通过归档状态及客户类型筛选。' },
    { item: '金额口径', description: '金额与币种逐行记录，不跨币种合计。框架、预计金额、确认订单、已回款相互区分；已回款列是独立参考字段，不与记录金额相加。' },
    { item: '关联终端与代理商', description: '关联终端客户或代理商仅作为关系记录；同一笔销售不应在不同项目中重复计入。框架总金额未知时保持空白，可单独记录部分回款。' },
    { item: '未知信息', description: '空白表示未知或未填写；未知金额不填 0。历史资料的实际跟进日期未知，系统创建时间仅表示录入时间。' },
    { item: '生命周期', description: '销售与售后阶段独立，允许任意跳转、回退、已跳过与不适用。跟进日志与阶段备注分别导出。' },
    { item: '完整恢复', description: 'Excel 用于汇报。请使用“备份全部数据”导出的 JSON 恢复系统数据。' },
  ]);
  const overflow = overflowTexts.get(workbook);
  if (overflow?.length) sheet(workbook, '长文本续篇', [column('sheet', '原工作表', 22), column('row', '原行号', 12), column('field', '原字段', 30), column('part', '段号', 12), column('content', '全文（按段号连接）', 100)], overflow);
  return workbook;
}

export async function exportExcel(data: CRMData): Promise<void> {
  const workbook = await buildExcel(data);
  const buffer = await workbook.xlsx.writeBuffer();
  download(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `SalesMap-客户与项目报告-${today()}.xlsx`);
}
