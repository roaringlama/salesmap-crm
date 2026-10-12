import type { Customer, Project, AfterSalesCase } from './types';
import { SALES_STAGES, SERVICE_STAGES, today } from './types';
export function dateText(value: string) { if (!value) return '待补充'; return value.slice(0,10); }
export function amountText(p: Project) { return p.amount === null ? '待确认' : `${p.currency} ${p.amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`; }
export function stageName(p: Project | AfterSalesCase) { return (('caseNumber' in p) ? SERVICE_STAGES : SALES_STAGES).find(s => s.id === p.currentStageId)?.name ?? '待设置'; }
export function tone(status: string) { return ['活跃客户','已成交','已完成','已结案'].includes(status) ? 'green' : ['进行中','已建联','处理中','长期维护'].includes(status) ? 'blue' : ['暂停','暂停跟进','等待客户','待处理','高'].includes(status) ? 'amber' : ['紧急','未成交'].includes(status) ? 'red' : 'neutral'; }
export function daysSince(value: string) {
  if (!value) return null;
  // Compare calendar days in UTC so a 23/25-hour local day around daylight
  // saving changes is still exactly one day in the dashboard.
  return Math.round((Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${value.slice(0,10)}T00:00:00Z`)) / 86400000);
}
export function isDue(value: string) { return Boolean(value) && value.slice(0,10) <= today(); }
export function withinWeek(value: string) { if (!value) return false; const n = daysSince(value); return n !== null && n <= 0 && n >= -7; }
export function customerName(customers: Customer[], id: string) { return customers.find(c=>c.id===id)?.name ?? '客户已删除'; }
