import { useCallback, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  CASE_STATUSES, CUSTOMER_STATUSES, CUSTOMER_TYPES, PRODUCTS, PROJECT_STATUSES,
  makeStages, recordBase, today, uid,
} from '../types';
import type { AfterSalesCase, Contact, Customer, Followup, Project } from '../types';
import { Button, Field, Modal } from './UI';

const AMOUNT_KINDS: Project['amountKind'][] = ['待确认', '预计金额', '框架金额', '确认订单', '已回款'];
const PRIORITIES: AfterSalesCase['priority'][] = ['低', '中', '高', '紧急'];

function useSave<T>(onSave: (value: T) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(value: T) {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await onSave(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, save };
}

function FormActions({ busy, error, onClose }: { busy: boolean; error: string; onClose: () => void }) {
  return <>
    {error && <div className="form-error full" role="alert">{error}</div>}
    <div className="form-actions full">
      <Button disabled={busy} onClick={onClose}>取消</Button>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
    </div>
  </>;
}

function Section({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="full form-section"><div className="section-heading"><h3>{title}</h3>{children}</div></div>;
}

function numberOrNull(value: string, label: string, integer = false): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000_000) {
    throw new Error(`${label}必须是 0 至 1,000,000,000,000 之间的数字，未知时请留空。`);
  }
  if (integer && !Number.isSafeInteger(parsed)) throw new Error(`${label}必须是非负整数，未知时请留空。`);
  return parsed;
}

const blankContact = (): Contact => ({ id: uid(), name: '', title: '', email: '', phone: '' });

function submittedDate(fields: FormData, name: string): string {
  const value = fields.get(name);
  return typeof value === 'string' ? value : '';
}

export function CustomerForm({ initial, onSave, onClose }: {
  initial?: Customer; onSave: (value: Customer) => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState<Customer>(() => initial ? structuredClone(initial) : {
    ...recordBase(), name: '', country: '', region: '', type: '其他', status: '潜在线索',
    contacts: [], interests: [], lastFollowup: '', nextFollowup: '', background: '', notes: '', logs: [],
  });
  const { busy, error, setError, save } = useSave(onSave);
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  const [contactToRemove, setContactToRemove] = useState('');
  function set<K extends keyof Customer>(key: K, next: Customer[K]) {
    setValue(previous => ({ ...previous, [key]: next }));
  }
  function setContact(id: string, key: keyof Omit<Contact, 'id'>, next: string) {
    setValue(previous => ({ ...previous, contacts: previous.contacts.map(contact => contact.id === id ? { ...contact, [key]: next } : contact) }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const lastFollowup = submittedDate(fields, 'lastFollowup');
    const nextFollowup = submittedDate(fields, 'nextFollowup');
    if (!value.name.trim()) { setError('请填写客户名称。'); return; }
    const contacts = value.contacts.map(contact => ({
      ...contact, name: contact.name.trim(), title: contact.title.trim(), email: contact.email.trim(), phone: contact.phone.trim(),
    })).filter(contact => initial?.contacts.some(saved => saved.id === contact.id) || contact.name || contact.title || contact.email || contact.phone);
    await save({
      ...value, name: value.name.trim(), country: value.country.trim(), region: value.region.trim(),
      contacts, lastFollowup, nextFollowup, archived: value.status === '已归档', updatedAt: new Date().toISOString(),
    });
  }
  return <Modal title={initial ? '编辑客户' : '新增客户'} onClose={close} wide>
    <form className="form-grid" onSubmit={submit}>
      <Field label="客户名称" required><input className="input" required maxLength={200} value={value.name} onChange={event => set('name', event.target.value)} /></Field>
      <Field label="国家" hint="资料未知可留空"><input className="input" maxLength={100} value={value.country} placeholder="例如：德国" onChange={event => set('country', event.target.value)} /></Field>
      <Field label="地区"><input className="input" maxLength={150} value={value.region} placeholder="例如：欧洲 / DACH" onChange={event => set('region', event.target.value)} /></Field>
      <Field label="客户类型"><select className="input" value={value.type} onChange={event => set('type', event.target.value as Customer['type'])}>{CUSTOMER_TYPES.map(type => <option key={type}>{type}</option>)}</select></Field>
      <Field label="客户关系状态"><select className="input" value={value.status} onChange={event => set('status', event.target.value as Customer['status'])}>{CUSTOMER_STATUSES.map(status => <option key={status}>{status}</option>)}</select></Field>
      <div className="full field" role="group" aria-label="产品兴趣（可多选）"><span className="field-label">产品兴趣（可多选）</span><span className="check-group">{PRODUCTS.map(product => <label key={product} className="check-option"><input type="checkbox" checked={value.interests.includes(product)} onChange={event => set('interests', event.target.checked ? [...value.interests, product] : value.interests.filter(item => item !== product))} /><span>{product}</span></label>)}</span></div>
      <Field label="最近跟进日期"><input type="date" name="lastFollowup" className="input" value={value.lastFollowup} onInput={event => set('lastFollowup', event.currentTarget.value)} onChange={event => set('lastFollowup', event.target.value)} /></Field>
      <Field label="下次跟进日期"><input type="date" name="nextFollowup" className="input" value={value.nextFollowup} onInput={event => set('nextFollowup', event.currentTarget.value)} onChange={event => set('nextFollowup', event.target.value)} /></Field>
      <Section title="联系人"><Button disabled={busy} onClick={() => set('contacts', [...value.contacts, blankContact()])}>+ 添加联系人</Button></Section>
      {value.contacts.length === 0 && <p className="full muted">暂无联系人，可在获得资料后补充。</p>}
      {value.contacts.map((contact, index) => <div className="full contact-editor" key={contact.id}>
        <div className="section-heading"><strong>联系人 {index + 1}</strong><Button disabled={busy} variant="ghost" aria-label={`移除联系人 ${index + 1}`} onClick={() => setContactToRemove(contact.id)}>移除</Button></div>
        {contactToRemove === contact.id && <div className="full confirm-note" role="alert">
          <p>确认移除「{contact.name || contact.email || `联系人 ${index + 1}`}」？保存客户后生效。</p>
          <div className="row-actions"><Button disabled={busy} onClick={() => setContactToRemove('')}>保留联系人</Button><Button disabled={busy} variant="danger" onClick={() => { set('contacts', value.contacts.filter(item => item.id !== contact.id)); setContactToRemove(''); }}>确认移除</Button></div>
        </div>}
        <div className="form-grid">
          <Field label="姓名"><input className="input" maxLength={120} value={contact.name} onChange={event => setContact(contact.id, 'name', event.target.value)} /></Field>
          <Field label="职位"><input className="input" maxLength={150} value={contact.title} onChange={event => setContact(contact.id, 'title', event.target.value)} /></Field>
          <Field label="邮箱"><input type="email" className="input" maxLength={254} value={contact.email} onChange={event => setContact(contact.id, 'email', event.target.value)} /></Field>
          <Field label="电话"><input type="tel" className="input" maxLength={100} value={contact.phone} onChange={event => setContact(contact.id, 'phone', event.target.value)} /></Field>
        </div>
      </div>)}
      <div className="full"><Field label="客户背景"><textarea className="input" rows={3} value={value.background} onChange={event => set('background', event.target.value)} /></Field></div>
      <div className="full"><Field label="备注"><textarea className="input" rows={3} value={value.notes} onChange={event => set('notes', event.target.value)} /></Field></div>
      <FormActions busy={busy} error={error} onClose={onClose} />
    </form>
  </Modal>;
}

export function ProjectForm({ initial, customers, customerId, onSave, onClose }: {
  initial?: Project; customers: Customer[]; customerId?: string;
  onSave: (value: Project) => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState<Project>(() => initial ? structuredClone(initial) : {
    ...recordBase(), name: '', customerId: customerId ?? '', country: customers.find(customer => customer.id === customerId)?.country ?? '',
    relatedParty: '', product: '', quantity: null, amount: null, currency: 'USD', amountKind: '待确认', receivedAmount: null,
    po: '', pi: '', status: '进行中', lastFollowup: '', nextFollowup: '', owner: '', notes: '',
    currentStageId: 'solution', stages: makeStages(), logs: [],
  });
  const [quantity, setQuantity] = useState(initial?.quantity?.toString() ?? '');
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? '');
  const [receivedAmount, setReceivedAmount] = useState(initial?.receivedAmount?.toString() ?? '');
  const { busy, error, setError, save } = useSave(onSave);
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  function set<K extends keyof Project>(key: K, next: Project[K]) { setValue(previous => ({ ...previous, [key]: next })); }
  function changeCustomer(id: string) {
    setValue(previous => ({ ...previous, customerId: id, country: customers.find(customer => customer.id === id)?.country ?? '' }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const lastFollowup = submittedDate(fields, 'lastFollowup');
    const nextFollowup = submittedDate(fields, 'nextFollowup');
    if (!value.name.trim()) { setError('请填写项目名称。'); return; }
    if (!customers.some(customer => customer.id === value.customerId)) { setError('请选择关联客户。'); return; }
    try {
      const normalizedQuantity = numberOrNull(quantity, '预计数量', true);
      const normalizedAmount = numberOrNull(amount, '项目金额');
      const normalizedReceived = numberOrNull(receivedAmount, '已回款金额');
      const normalizedCurrency = value.currency.trim().toUpperCase();
      if (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency)) {
        setError('币种请填写三位英文字母，例如 USD 或 EUR。'); return;
      }
      if ((normalizedAmount !== null || normalizedReceived !== null) && !normalizedCurrency) {
        setError('填写金额时必须填写币种。'); return;
      }
      await save({ ...value, name: value.name.trim(), country: value.country.trim(), relatedParty: value.relatedParty.trim(),
        product: value.product.trim(), quantity: normalizedQuantity, amount: normalizedAmount, receivedAmount: normalizedReceived,
        currency: normalizedCurrency, po: value.po.trim(), pi: value.pi.trim(), owner: value.owner.trim(), lastFollowup, nextFollowup, updatedAt: new Date().toISOString(),
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '请检查数量及金额。'); }
  }
  return <Modal title={initial ? '编辑销售项目' : '新增销售项目'} onClose={close} wide>
    <form className="form-grid" onSubmit={submit}>
      <Field label="项目名称" required><input className="input" required maxLength={250} value={value.name} onChange={event => set('name', event.target.value)} /></Field>
      <Field label="关联客户" required><select className="input" required value={value.customerId} onChange={event => changeCustomer(event.target.value)}><option value="">请选择客户</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.archived ? '（已归档）' : ''}</option>)}</select></Field>
      <Field label="所在国家"><input className="input" maxLength={100} value={value.country} onChange={event => set('country', event.target.value)} /></Field>
      <Field label="关联终端客户 / 代理商" hint="直接记录名称，无需重复建档"><input className="input" maxLength={250} value={value.relatedParty} placeholder="例如：终端客户或渠道伙伴名称" onChange={event => set('relatedParty', event.target.value)} /></Field>
      <Field label="产品型号"><input className="input" maxLength={500} value={value.product} onChange={event => set('product', event.target.value)} /></Field>
      <Field label="预计数量" hint="非负整数，未知请留空"><input type="number" className="input" min={0} max={1_000_000_000_000} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} /></Field>
      <Field label="项目金额" hint="按所选金额性质记录，未知请留空"><input type="number" className="input" min={0} max={1_000_000_000_000} step="any" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
      <Field label="金额性质"><select className="input" value={value.amountKind} onChange={event => set('amountKind', event.target.value as Project['amountKind'])}>{AMOUNT_KINDS.map(kind => <option key={kind}>{kind}</option>)}</select></Field>
      <Field label="币种" hint="例如 USD / EUR，三位英文字母"><input className="input" list="crm-currencies" maxLength={3} pattern="[A-Za-z]{3}" value={value.currency} onChange={event => set('currency', event.target.value.toUpperCase())} /><datalist id="crm-currencies">{['USD', 'EUR', 'GBP', 'CZK', 'HUF', 'PLN', 'CNY'].map(currency => <option key={currency} value={currency} />)}</datalist></Field>
      <Field label="已回款金额" hint="单独记录实际回款，未知请留空"><input type="number" className="input" min={0} max={1_000_000_000_000} step="any" value={receivedAmount} onChange={event => setReceivedAmount(event.target.value)} /></Field>
      <Field label="订单号 / PO"><input className="input" maxLength={150} value={value.po} onChange={event => set('po', event.target.value)} /></Field>
      <Field label="PI 编号"><input className="input" maxLength={150} value={value.pi} onChange={event => set('pi', event.target.value)} /></Field>
      <Field label="项目状态"><select className="input" value={value.status} onChange={event => set('status', event.target.value as Project['status'])}>{PROJECT_STATUSES.map(status => <option key={status}>{status}</option>)}</select></Field>
      <Field label="负责人"><input className="input" maxLength={150} value={value.owner} onChange={event => set('owner', event.target.value)} /></Field>
      <Field label="最近跟进日期"><input type="date" name="lastFollowup" className="input" value={value.lastFollowup} onInput={event => set('lastFollowup', event.currentTarget.value)} onChange={event => set('lastFollowup', event.target.value)} /></Field>
      <Field label="下次跟进日期"><input type="date" name="nextFollowup" className="input" value={value.nextFollowup} onInput={event => set('nextFollowup', event.currentTarget.value)} onChange={event => set('nextFollowup', event.target.value)} /></Field>
      <div className="full"><Field label="备注"><textarea className="input" rows={4} value={value.notes} onChange={event => set('notes', event.target.value)} /></Field></div>
      <FormActions busy={busy} error={error} onClose={onClose} />
    </form>
  </Modal>;
}

export function CaseForm({ initial, customers, projects, customerId, onSave, onClose }: {
  initial?: AfterSalesCase; customers: Customer[]; projects: Project[]; customerId?: string;
  onSave: (value: AfterSalesCase) => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState<AfterSalesCase>(() => initial ? structuredClone(initial) : {
    ...recordBase(), caseNumber: '', customerId: customerId ?? '', projectId: '', product: '', serialNumbers: [],
    issue: '', priority: '中', reportedDate: '', status: '待处理', nextStep: '', nextFollowup: '',
    currentStageId: 'request', stages: makeStages(true), logs: [],
  });
  const [serials, setSerials] = useState(initial?.serialNumbers.join('\n') ?? '');
  const { busy, error, setError, save } = useSave(onSave);
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  const relatedProjects = projects.filter(project => project.customerId === value.customerId);
  function set<K extends keyof AfterSalesCase>(key: K, next: AfterSalesCase[K]) { setValue(previous => ({ ...previous, [key]: next })); }
  function changeCustomer(id: string) {
    setValue(previous => ({ ...previous, customerId: id, projectId: projects.some(project => project.id === previous.projectId && project.customerId === id) ? previous.projectId : '' }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const reportedDate = submittedDate(fields, 'reportedDate');
    const nextFollowup = submittedDate(fields, 'nextFollowup');
    if (!value.caseNumber.trim()) { setError('请填写案例编号。'); return; }
    if (!customers.some(customer => customer.id === value.customerId)) { setError('请选择关联客户。'); return; }
    if (!value.issue.trim()) { setError('请填写故障描述。'); return; }
    if (value.projectId && !relatedProjects.some(project => project.id === value.projectId)) {
      setError('关联项目必须属于所选客户，请重新选择。'); return;
    }
    await save({ ...value, caseNumber: value.caseNumber.trim(), product: value.product.trim(), issue: value.issue.trim(),
      serialNumbers: [...new Set(serials.split(/[\n,，;；]+/).map(serial => serial.trim()).filter(Boolean))],
      reportedDate, nextFollowup, updatedAt: new Date().toISOString(),
    });
  }
  return <Modal title={initial ? '编辑售后案例' : '新增售后 / RMA 案例'} onClose={close} wide>
    <form className="form-grid" onSubmit={submit}>
      <Field label="案例编号" required><input className="input" required maxLength={150} value={value.caseNumber} placeholder="填写内部案例编号 / RMA 编号" onChange={event => set('caseNumber', event.target.value)} /></Field>
      <Field label="关联客户" required><select className="input" required value={value.customerId} onChange={event => changeCustomer(event.target.value)}><option value="">请选择客户</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.archived ? '（已归档）' : ''}</option>)}</select></Field>
      <Field label="关联销售项目（可选）"><select className="input" value={value.projectId} disabled={!value.customerId} onChange={event => set('projectId', event.target.value)}><option value="">独立售后案例</option>{relatedProjects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archived ? '（已归档）' : ''}</option>)}</select></Field>
      <Field label="产品型号"><input className="input" maxLength={500} value={value.product} onChange={event => set('product', event.target.value)} /></Field>
      <div className="full"><Field label="设备 SN" hint="多个序列号以换行或逗号分隔"><textarea className="input" rows={3} value={serials} onChange={event => setSerials(event.target.value)} /></Field></div>
      <div className="full"><Field label="故障描述" required><textarea className="input" required rows={4} value={value.issue} onChange={event => set('issue', event.target.value)} /></Field></div>
      <Field label="优先级"><select className="input" value={value.priority} onChange={event => set('priority', event.target.value as AfterSalesCase['priority'])}>{PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select></Field>
      <Field label="报修日期" hint="历史日期未知时可留空"><input type="date" name="reportedDate" className="input" value={value.reportedDate} onInput={event => set('reportedDate', event.currentTarget.value)} onChange={event => set('reportedDate', event.target.value)} /></Field>
      <Field label="当前状态"><select className="input" value={value.status} onChange={event => set('status', event.target.value as AfterSalesCase['status'])}>{CASE_STATUSES.map(status => <option key={status}>{status}</option>)}</select></Field>
      <Field label="下次跟进日期"><input type="date" name="nextFollowup" className="input" value={value.nextFollowup} onInput={event => set('nextFollowup', event.currentTarget.value)} onChange={event => set('nextFollowup', event.target.value)} /></Field>
      <div className="full"><Field label="下一步计划"><textarea className="input" rows={3} value={value.nextStep} onChange={event => set('nextStep', event.target.value)} /></Field></div>
      <FormActions busy={busy} error={error} onClose={onClose} />
    </form>
  </Modal>;
}

export function FollowupForm({ initial, onSave, onClose }: {
  initial?: Followup; onSave: (value: Followup) => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState<Followup>(() => initial ? { ...initial } : { id: uid(), date: today(), contact: '', content: '', result: '', nextStep: '' });
  const { busy, error, setError, save } = useSave(onSave);
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  function set(key: keyof Followup, next: string) { setValue(previous => ({ ...previous, [key]: next })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const date = submittedDate(fields, 'date');
    if (!initial && !date) { setError('请填写跟进日期。'); return; }
    if (!value.content.trim()) { setError('请填写沟通内容。'); return; }
    await save({ ...value, date, contact: value.contact.trim(), content: value.content.trim(), result: value.result.trim(), nextStep: value.nextStep.trim() });
  }
  return <Modal title={initial ? '编辑跟进日志' : '新增跟进日志'} onClose={close}>
    <form className="form-grid" onSubmit={submit}>
      <Field label="跟进日期" required={!initial}><input type="date" name="date" className="input" required={!initial} value={value.date} onInput={event => set('date', event.currentTarget.value)} onChange={event => set('date', event.target.value)} /></Field>
      <Field label="沟通对象"><input className="input" maxLength={250} value={value.contact} onChange={event => set('contact', event.target.value)} /></Field>
      <div className="full"><Field label="沟通内容" required><textarea className="input" required rows={4} value={value.content} onChange={event => set('content', event.target.value)} /></Field></div>
      <div className="full"><Field label="结果"><textarea className="input" rows={2} value={value.result} onChange={event => set('result', event.target.value)} /></Field></div>
      <div className="full"><Field label="下一步计划"><textarea className="input" rows={2} value={value.nextStep} onChange={event => set('nextStep', event.target.value)} /></Field></div>
      <FormActions busy={busy} error={error} onClose={onClose} />
    </form>
  </Modal>;
}

