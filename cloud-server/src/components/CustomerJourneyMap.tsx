import type { CSSProperties } from 'react';
import { ArrowUpRight, Building2, CalendarDays, FileText, Pencil, Wrench } from 'lucide-react';
import type { AfterSalesCase, Customer, Project, Stage } from '../types';
import { amountText, dateText, isDue, tone } from '../utils';
import { Badge, Empty } from './UI';
import { StageBoard } from './Workflow';
import './customer-journey.css';

const LINE_COLORS = ['#2563eb', '#0d9488', '#8b5cf6', '#d88b22', '#0891b2', '#db5a85'];

export function CustomerJourneyMap({ customer, projects, cases, service = false, readOnly = false, onStageChange, onEdit }: {
  customer: Customer;
  projects: Project[];
  cases: AfterSalesCase[];
  service?: boolean;
  readOnly?: boolean;
  onStageChange: (entity: 'project' | 'case', id: string, stages: Stage[], currentStageId: string) => Promise<void>;
  onEdit: (record: Project | AfterSalesCase) => void;
}) {
  const records = service ? cases : projects;
  if (!records.length) return <Empty title={service ? '还没有售后线路' : '还没有销售项目线路'} description={readOnly ? '当前工作空间还没有已保存的线路。' : service ? '新增一个售后案例，开始记录独立的处理进展。' : '新增项目后，每个项目会有自己的一条阶段线。'} />;
  return <section className="journey-map" aria-label={`${customer.name}${service ? '售后' : '销售项目'}节点线图`}>
    <div className="journey-map-heading"><div><h2>{service ? '售后处理线路' : '销售项目线路'}<span>{records.length} 条独立线路</span></h2><p>{readOnly ? '点击任意阶段节点查看状态与备注。当前工作空间为只读权限。' : '点击任意阶段节点编辑状态与备注，可直接跳转、跳过或回退。'}</p></div><div className="journey-legend" aria-label="节点图例"><span><i className="legend-current"/>当前阶段</span><span><i className="legend-done"/>已完成</span><span><i className="legend-open"/>未开始</span><span><i className="legend-skip"/>已跳过 / 不适用</span></div></div>
    <div className="journey-scroll"><div className="journey-canvas">
      <div className="journey-origin"><div className="journey-origin-node"><span className="journey-origin-icon"><Building2 size={23}/></span><strong>{customer.name}</strong><small>{customer.country || '国家待补充'} · {customer.type}</small><Badge tone={tone(customer.status)}>{customer.archived ? '已归档' : customer.status}</Badge><span className="journey-origin-count">{records.length} 个{service ? '售后案例' : '销售项目'}</span></div></div>
      <div className="journey-branches">
        {records.map((record, index) => {
          const isCase = 'caseNumber' in record;
          const entity = isCase ? 'case' : 'project';
          const title = isCase ? record.caseNumber : record.name;
          const href = `#/${isCase ? 'after-sales' : 'projects'}/${record.id}`;
          const currentNotes = record.stages.find(s => s.id === record.currentStageId)?.notes ?? [];
          const lastNote = currentNotes.at(-1);
          const progress = lastNote?.content || (isCase ? record.nextStep || record.issue : record.notes);
          const style = { '--journey-color': LINE_COLORS[index % LINE_COLORS.length] } as CSSProperties;
          const associatedProject = isCase && record.projectId ? projects.find(p => p.id === record.projectId) : undefined;
          const associationLabel = isCase ? (record.projectId ? `关联：${associatedProject?.name || '项目已归档或未显示'}` : '独立售后案例') : record.amountKind;
          return <article key={record.id} className={`journey-row ${record.archived ? 'journey-row-archived' : ''}`} style={style} aria-label={`${title}线路`}>
            <div className="journey-project"><div className="journey-project-title"><span className="journey-project-dot"/><a href={href} title={`打开${title}详情`}>{title}</a>{!readOnly && <button className="journey-edit" aria-label={`编辑 ${title} 基本信息`} title={isCase ? '编辑案例基本信息' : '编辑项目基本信息'} onClick={()=>onEdit(record)}><Pencil size={13}/></button>}</div><p>{record.product || '产品型号待补充'}{!isCase && record.quantity !== null ? ` · ${record.quantity.toLocaleString()} 台` : ''}</p><div className="journey-project-status"><Badge tone={tone(record.status)}>{record.status}</Badge>{record.archived && <Badge>已归档</Badge>}{isCase ? <span><Wrench size={11}/>{record.priority}优先级</span> : <span className="journey-money">{amountText(record)}</span>}</div><small>{associationLabel}</small></div>
            <div className="journey-project-track"><StageBoard compact label={title} service={isCase} readOnly={readOnly} stages={record.stages} currentStageId={record.currentStageId} onChange={(stages,currentStageId)=>onStageChange(entity,record.id,stages,currentStageId)}/><div className="journey-row-bottom"><span className="journey-progress-note" title={progress || '尚无阶段备注'}><FileText size={12}/>{progress || (readOnly ? '尚无已保存阶段备注。' : '尚无阶段备注，点击节点开始记录。')}</span><span className={`journey-next-date ${isDue(record.nextFollowup) ? 'date-due' : ''}`}><CalendarDays size={12}/>{record.nextFollowup ? `下次 ${dateText(record.nextFollowup)}` : '跟进日期待补充'}</span><a className="journey-details-link" href={href} aria-label={`打开 ${title} 跟进日志`}>详情 / 日志<ArrowUpRight size={12}/></a></div></div>
          </article>;
        })}
      </div>
    </div></div>
    <div className="journey-map-footer"><span>每条线路独立推进，节点状态按实际记录显示。</span><span>{service ? '售后状态' : '项目状态'}与阶段分别维护 · 当前节点：点击带圆环的节点</span></div>
  </section>;
}
