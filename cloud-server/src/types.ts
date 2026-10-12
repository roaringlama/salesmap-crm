export const CUSTOMER_TYPES = ['运营商', '代理商', '系统集成商', '终端客户', '供应商', '其他'] as const;
export const CUSTOMER_STATUSES = ['潜在线索', '已建联', '活跃客户', '暂停跟进', '长期维护', '已归档'] as const;
export const PRODUCTS = ['DOCSIS/CMTS', 'Headend', '编解码', 'IP传输', '其他'] as const;
export const PROJECT_STATUSES = ['进行中', '暂停', '已成交', '未成交', '已关闭'] as const;
export const CASE_STATUSES = ['待处理', '处理中', '等待客户', '已结案'] as const;
export const STAGE_STATUSES = ['未开始', '进行中', '已完成', '已跳过', '不适用'] as const;
export const RELATIONSHIP_TYPES = ['代理关系', '客户关系', '供应关系', '合作伙伴', '其他'] as const;
export const SALES_STAGES = [
  { id: 'solution', name: '方案沟通', english: 'Solution Discussion' },
  { id: 'quotation', name: '商务报价', english: 'Quotation' },
  { id: 'testing', name: '测试验证', english: 'Testing / PoC' },
  { id: 'contract', name: '合同与订单', english: 'Contract / PO' },
  { id: 'fulfillment', name: '付款与交付', english: 'Payment & Fulfillment' },
] as const;
export const SERVICE_STAGES = [
  { id: 'request', name: '返修申请', english: 'Service / RMA Request' },
  { id: 'documentation', name: '资料收集', english: 'Documentation Collection' },
  { id: 'remote', name: '远程诊断', english: 'Remote Troubleshooting' },
  { id: 'processing', name: '返修处理', english: 'RMA Processing' },
  { id: 'closure', name: '返还客户及结案', english: 'Return & Closure' },
] as const;
export interface Contact { id: string; name: string; title: string; email: string; phone: string }
export interface Followup { id: string; date: string; contact: string; content: string; result: string; nextStep: string }
export interface StageNote { id: string; date: string; content: string }
export interface Stage { id: string; status: typeof STAGE_STATUSES[number]; notes: StageNote[] }
export interface RecordBase { id: string; archived: boolean; createdAt: string; updatedAt: string }
export interface Customer extends RecordBase {
  name: string; country: string; region: string; type: typeof CUSTOMER_TYPES[number];
  status: typeof CUSTOMER_STATUSES[number]; contacts: Contact[]; interests: string[];
  lastFollowup: string; nextFollowup: string; background: string; notes: string; logs: Followup[];
}
export interface Project extends RecordBase {
  name: string; customerId: string; country: string; relatedParty: string; product: string;
  quantity: number | null; amount: number | null; currency: string;
  amountKind: '待确认' | '预计金额' | '框架金额' | '确认订单' | '已回款';
  receivedAmount: number | null; po: string; pi: string; status: typeof PROJECT_STATUSES[number];
  lastFollowup: string; nextFollowup: string; owner: string; notes: string;
  currentStageId: string; stages: Stage[]; logs: Followup[];
}
export interface AfterSalesCase extends RecordBase {
  caseNumber: string; customerId: string; projectId: string; product: string; serialNumbers: string[];
  issue: string; priority: '低' | '中' | '高' | '紧急'; reportedDate: string;
  status: typeof CASE_STATUSES[number]; nextStep: string; nextFollowup: string;
  currentStageId: string; stages: Stage[]; logs: Followup[];
}
export interface Relationship {
  id: string; fromCustomerId: string; toCustomerId: string;
  type: typeof RELATIONSHIP_TYPES[number]; notes: string;
}
export interface CRMData { schemaVersion: 1; revision: number; updatedAt: string; customers: Customer[]; projects: Project[]; cases: AfterSalesCase[]; relationships: Relationship[] }
export const uid = () => crypto.randomUUID();
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const makeStages = (service = false): Stage[] => (service ? SERVICE_STAGES : SALES_STAGES).map(s => ({ id: s.id, status: '未开始', notes: [] }));
export const recordBase = (): RecordBase => ({ id: uid(), archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
