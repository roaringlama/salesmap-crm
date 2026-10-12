import { useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Circle, FileText, Loader2, Minus, Pencil, Plus, SkipForward, Trash2 } from 'lucide-react';
import { SALES_STAGES, SERVICE_STAGES, STAGE_STATUSES, today, uid } from '../types';
import type { Followup, Stage, StageNote } from '../types';
import { Button, Empty, Field, Modal } from './UI';
import './workflow.css';

function StageIcon({ status }: { status: Stage['status'] }) {
  if (status === '已完成') return <Check size={16} />;
  if (status === '已跳过') return <SkipForward size={16} />;
  if (status === '不适用') return <Minus size={16} />;
  return <Circle size={status === '进行中' ? 13 : 11} fill={status === '进行中' ? 'currentColor' : 'none'} />;
}

export function StageBoard({ stages, currentStageId, service = false, compact = false, label, readOnly = false, onChange }: {
  stages: Stage[];
  currentStageId: string;
  service?: boolean;
  compact?: boolean;
  label?: string;
  readOnly?: boolean;
  onChange: (stages: Stage[], currentStageId: string) => Promise<void>;
}) {
  const definitions = service ? SERVICE_STAGES : SALES_STAGES;
  const [draft, setDraft] = useState<Stage | null>(null);
  const [isCurrent, setIsCurrent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedDefinition = definitions.find(stage => stage.id === draft?.id);

  function open(stageId: string) {
    const existing = stages.find(stage => stage.id === stageId);
    setDraft(existing ? { ...existing, notes: existing.notes.map(note => ({ ...note })) } : { id: stageId, status: '未开始', notes: [] });
    setIsCurrent(currentStageId === stageId);
    setError('');
  }

  function updateNote(id: string, value: Partial<StageNote>) {
    if (readOnly) return;
    setDraft(previous => previous ? { ...previous, notes: previous.notes.map(note => note.id === id ? { ...note, ...value } : note) } : null);
  }

  function addNote() {
    if (readOnly) return;
    setDraft(previous => previous ? { ...previous, notes: [...previous.notes, { id: uid(), date: today(), content: '' }] } : null);
    setError('');
  }

  function deleteNote(noteId: string) {
    if (readOnly) return;
    if (!window.confirm('确认删除这条阶段备注？保存阶段后删除生效。')) return;
    setDraft(previous => previous ? { ...previous, notes: previous.notes.filter(note => note.id !== noteId) } : null);
    setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving || readOnly) return;
    // Read native date controls before disabling the form. Some browser date
    // pickers update their value before React's change event reaches state.
    const formValues = new FormData(event.currentTarget);
    const savedNotes = draft.notes.map(note => {
      const date = formValues.get(`note-date-${note.id}`);
      return { ...note, date: typeof date === 'string' ? date : note.date, content: note.content.trim() };
    });
    if (draft.notes.some(note => !note.content.trim())) {
      setError('请填写每条备注的内容，或删除空白备注。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const savedStage = { ...draft, notes: savedNotes };
      const savedStages = stages.some(stage => stage.id === savedStage.id)
        ? stages.map(stage => stage.id === savedStage.id ? savedStage : stage)
        : [...stages, savedStage];
      const nextCurrent = isCurrent ? draft.id : currentStageId === draft.id ? '' : currentStageId;
      await onChange(savedStages, nextCurrent);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return <section className={`workflow${compact ? ' workflow-compact' : ''}`}>
    {!compact && <div className="workflow-heading">
      <div><h3>{service ? '售后处理阶段' : '销售项目阶段'}</h3><p>{readOnly ? '点击任意阶段查看状态与备注。当前工作空间为只读权限。' : '点击任意阶段编辑状态与备注；可跳过、回退或直接切换阶段。'}</p></div>
    </div>}
    <div className="stage-board-scroll">
    <div className="stage-board stage-board-line journey-track" aria-label={`${label ? `${label} · ` : ''}${service ? '售后阶段进度' : '销售阶段进度'}`}>
      {definitions.map(definition => {
        const stage = stages.find(item => item.id === definition.id);
        const status = stage?.status ?? '未开始';
        const current = currentStageId === definition.id;
        const latestNote = [...(stage?.notes ?? [])].reverse().sort((a, b) => b.date.localeCompare(a.date))[0];
        const tooltip = `${definition.name} · ${status}${current ? ' · 当前阶段' : ''}${latestNote ? `\n${latestNote.date || '日期待补充'}：${latestNote.content}` : '\n暂无阶段备注'}\n点击${readOnly ? '查看' : '编辑'}状态与备注`;
        return <button key={definition.id} type="button" className={`journey-node stage-${status === '已完成' ? 'done' : status === '已跳过' || status === '不适用' ? 'muted' : status === '进行中' ? 'active' : 'open'} ${current ? 'stage-current' : ''}`} onClick={() => open(definition.id)} aria-current={current ? 'step' : undefined} aria-label={`${label ? `${label} · ` : ''}${readOnly ? '查看' : '编辑'}${definition.name}阶段，${status}${current ? '，当前阶段' : ''}`} title={tooltip}>
          <span className="journey-circle"><StageIcon status={status} /></span>
          <strong className="journey-label">{definition.name}</strong>{!compact && <span className="stage-english">{definition.english}</span>}
          <span className="journey-meta"><span className="journey-status">{current && <span className="journey-current-label">当前 · </span>}{status}</span><span className="stage-note-count"><FileText size={11} />{stage?.notes.length ?? 0}</span></span>
        </button>;
      })}
    </div>
    </div>
    {draft && <Modal title={`${label ? `${label} · ` : ''}${selectedDefinition?.name ?? '阶段'} · 状态与备注${readOnly ? '（只读）' : ''}`} wide onClose={() => { if (!saving) setDraft(null); }}>
      <form onSubmit={save} className="stage-editor">
        <div className="form-grid">
          <Field label="阶段状态"><select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Stage['status'] })} disabled={saving || readOnly}>{STAGE_STATUSES.map(status => <option key={status}>{status}</option>)}</select></Field>
          <div className="stage-current-option"><label className="check-option"><input type="checkbox" checked={isCurrent} onChange={event => setIsCurrent(event.target.checked)} disabled={saving || readOnly} /><span>{readOnly ? '当前阶段' : '设为当前阶段'}</span></label><p>{readOnly ? '仅查看此工作空间中的实际阶段记录。' : '直接切换不会改变其他阶段的状态或记录。'}</p></div>
        </div>
        <div className="stage-notes-heading"><h3>阶段备注 <span>{draft.notes.length}</span></h3>{!readOnly && <Button onClick={addNote} disabled={saving}><Plus size={15} />新增备注</Button>}</div>
        {draft.notes.length === 0 && <div className="stage-notes-empty">{readOnly ? '此阶段尚无已保存备注。' : '尚无备注。可记录报价变化、测试结果或交付信息。'}</div>}
        <div className="stage-notes-editor">
          {draft.notes.map((note, index) => <div className="stage-note-editor" key={note.id}>
            <div className="stage-note-header"><strong>备注 {index + 1}</strong>{!readOnly && <Button variant="ghost" onClick={() => deleteNote(note.id)} disabled={saving} aria-label={`删除第 ${index + 1} 条阶段备注`}><Trash2 size={14} />删除</Button>}</div>
            <Field label="日期" hint="历史日期未知时可留空。"><input type="date" name={`note-date-${note.id}`} aria-label={`第 ${index + 1} 条备注日期`} value={note.date} onInput={event => updateNote(note.id, { date: event.currentTarget.value })} onChange={event => updateNote(note.id, { date: event.target.value })} disabled={saving} readOnly={readOnly} /></Field>
            <Field label="内容" required={!readOnly}><textarea rows={3} aria-label={`第 ${index + 1} 条备注内容`} value={note.content} onChange={event => updateNote(note.id, { content: event.target.value })} disabled={saving} readOnly={readOnly} placeholder={readOnly ? '' : '填写本阶段的记录…'} /></Field>
          </div>)}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-actions"><Button onClick={() => setDraft(null)} disabled={saving}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly && <Button type="submit" variant="primary" disabled={saving}>{saving && <Loader2 size={15} className="spin" />}{saving ? '保存中…' : '保存阶段'}</Button>}</div>
      </form>
    </Modal>}
  </section>;
}

export function FollowupTimeline({ logs, onAdd, onEdit, onDelete, title = '项目跟进日志', readOnly = false }: {
  logs: Followup[];
  onAdd: () => void;
  onEdit: (log: Followup) => void;
  onDelete: (log: Followup) => void;
  title?: string;
  readOnly?: boolean;
}) {
  const sorted = [...logs].sort((a, b) => {
    if (!a.date) return b.date ? 1 : 0;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
  return <section className="followup-section">
    <div className="section-heading"><h3>{title}<span className="subtle-count">{logs.length}</span></h3>{!readOnly && <Button onClick={onAdd}><Plus size={15} />新增记录</Button>}</div>
    {sorted.length === 0 ? <Empty title="暂无沟通记录" description={readOnly ? '当前工作空间还没有已保存的沟通记录。' : '新增记录，保留沟通内容、结果与下一步计划。'} /> : <div className="followup-timeline">
      {sorted.map(log => <article className="followup-item" key={log.id}>
        <div className="followup-date"><span className="timeline-dot" /><time dateTime={log.date || undefined}>{log.date || '日期待补充'}</time></div>
        <div className="followup-card">
          <div className="followup-header"><span><strong>{log.contact || '沟通对象待补充'}</strong></span>{!readOnly && <div className="row-actions"><Button variant="ghost" onClick={() => onEdit(log)} aria-label={`编辑 ${log.date || '日期未知'} 的沟通记录`}><Pencil size={14} />编辑</Button><Button variant="ghost" onClick={() => onDelete(log)} aria-label={`删除 ${log.date || '日期未知'} 的沟通记录`}><Trash2 size={14} />删除</Button></div>}</div>
          <p className="followup-content">{log.content || '内容待补充'}</p>
          {(log.result || log.nextStep) && <dl className="followup-outcomes">{log.result && <div><dt>沟通结果</dt><dd>{log.result}</dd></div>}{log.nextStep && <div><dt>下一步</dt><dd>{log.nextStep}</dd></div>}</dl>}
        </div>
      </article>)}
    </div>}
  </section>;
}
