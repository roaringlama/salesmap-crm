import { useState, type FormEvent } from 'react';
import { Button, Field, Modal } from './UI';
import { uid, type Customer, type Relationship } from '../types';

const kinds = ['代理关系', '客户关系', '供应关系', '合作伙伴', '其他'] as const;
export function RelationshipForm({ customers, initial, onSave, onDelete, onClose }: {
  customers: Customer[]; initial?: Relationship;
  onSave: (value: Relationship) => Promise<void>; onDelete?: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<Relationship>(initial ?? { id: uid(), fromCustomerId: '', toCustomerId: '', type: '代理关系', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (draft.fromCustomerId === draft.toCustomerId) { setError('请选择两个不同的公司。'); return; }
    setBusy(true); setError('');
    try { await onSave({ ...draft, notes: draft.notes.trim() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  }
  return <Modal title={initial ? '编辑公司关系' : '新增公司关系'} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={save}>
      <p className="muted">连线从起点指向终点，例如：起点公司是终点公司的代理商。</p>
      <div className="form-grid">
        <Field label="起点公司" required><select required value={draft.fromCustomerId} disabled={busy} onChange={e => setDraft({ ...draft, fromCustomerId: e.target.value })}><option value="">选择公司</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? '（已归档）' : ''}</option>)}</select></Field>
        <Field label="终点公司" required><select required value={draft.toCustomerId} disabled={busy} onChange={e => setDraft({ ...draft, toCustomerId: e.target.value })}><option value="">选择公司</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? '（已归档）' : ''}</option>)}</select></Field>
        <Field label="关系类型"><select value={draft.type} disabled={busy} onChange={e => setDraft({ ...draft, type: e.target.value as Relationship['type'] })}>{kinds.map(k => <option key={k}>{k}</option>)}</select></Field>
      </div>
      <Field label="关系说明"><textarea rows={3} value={draft.notes} disabled={busy} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="可补充区域、产品或合作范围…" /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">{initial && onDelete && <Button variant="danger" disabled={busy} onClick={onDelete}>删除关系</Button>}<Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存关系'}</Button></div>
    </form>
  </Modal>;
}
