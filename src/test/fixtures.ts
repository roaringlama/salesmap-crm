import { makeStages, type CRMData, type Customer, type Project } from '../types';

// Anonymous, synthetic examples for automated tests. No real account records,
// customer names, contracts or payments are embedded in the public source.
export function fixtureData(): CRMData {
  const timestamp = '2026-01-01T00:00:00.000Z';
  const base = (id: string) => ({ id, archived: false, createdAt: timestamp, updatedAt: timestamp });
  const customers: Customer[] = [
    { ...base('customer-a'), name: '示例代理商', country: '德国', region: '欧洲', type: '代理商', status: '已建联', contacts: [{ id: 'contact-test', name: '测试联系人', title: '采购', email: 'contact@example.test', phone: '+49 000' }], interests: ['DOCSIS/CMTS'], lastFollowup: '', nextFollowup: '', background: '匿名测试档案', notes: '', logs: [{ id: 'log-customer', date: '2026-01-10', contact: '测试联系人', content: '客户沟通', result: '收到资料', nextStep: '确认需求' }] },
    { ...base('customer-b'), name: '示例运营商', country: '荷兰', region: '欧洲', type: '运营商', status: '潜在线索', contacts: [], interests: ['Headend'], lastFollowup: '', nextFollowup: '', background: '', notes: '', logs: [] },
  ];
  const project = (id: string, customerId: string, name: string, fields: Partial<Project> = {}): Project => ({
    ...base(id), customerId, name, country: customers.find(customer => customer.id === customerId)!.country, relatedParty: '', product: 'TEST-DEVICE', quantity: null, amount: null, currency: 'USD', amountKind: '待确认', receivedAmount: null, po: '', pi: '', status: '进行中', lastFollowup: '', nextFollowup: '', owner: '', notes: '', currentStageId: 'solution', stages: makeStages(), logs: [], ...fields,
  });
  const projects = [
    project('project-a', 'customer-a', '示例框架项目', { quantity: 10, amount: 1000, amountKind: '框架金额', logs: [{ id: 'log-project', date: '2026-01-09', contact: '测试联系人', content: '项目沟通', result: '等待确认', nextStep: '付款跟进' }] }),
    project('project-b', 'customer-a', '示例独立询价'),
    project('project-c', 'customer-b', '示例部分回款项目', { quantity: 2, amount: 400, amountKind: '已回款', receivedAmount: 400 }),
  ];
  projects[0].stages[0].notes.push({ id: 'note-test', date: '2026-01-08', content: '方案备注' });
  const stages = makeStages(true);
  stages[2].status = '已完成'; stages[3].status = '已跳过'; stages[4].status = '已完成';
  stages[2].notes.push({ id: 'note-rma', date: '2026-01-10', content: '远程解决' });
  return {
    schemaVersion: 1, revision: 0, updatedAt: timestamp, customers, projects,
    cases: [{ ...base('case-test'), caseNumber: 'RMA-TEST', customerId: 'customer-a', projectId: 'project-a', product: 'TEST-DEVICE', serialNumbers: ['SN-1', 'SN-2'], issue: '测试故障', priority: '高', reportedDate: '2026-01-09', status: '已结案', nextStep: '留存记录', nextFollowup: '', currentStageId: 'closure', stages, logs: [{ id: 'log-rma', date: '2026-01-10', contact: '', content: '远程排查', result: '已解决', nextStep: '结案' }] }],
    relationships: [{ id: 'relationship-test', fromCustomerId: 'customer-a', toCustomerId: 'customer-b', type: '代理关系', notes: '匿名测试关系' }],
  };
}
