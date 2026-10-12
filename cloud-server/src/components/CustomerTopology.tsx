import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { ArrowUpRight, Building2, CircleUserRound, Handshake, Link2, Minus, Move, Network, Package, Plus, RadioTower, RotateCcw, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CUSTOMER_TYPES } from '../types';
import type { Customer, Relationship } from '../types';
import { Button, Empty, Modal } from './UI';
import './topology.css';

type Point = { x: number; y: number };
type View = { center: Point; zoom: number };
type Drag = { mode: 'node' | 'pan'; id: string; pointerId: number; client: Point; origin: Point; start: Point; inverseScale: Point; moved: boolean };
const NODE_RADIUS = 43;
const TYPES: Record<Customer['type'], { color: string; icon: LucideIcon }> = {
  运营商: { color: '#2563eb', icon: RadioTower },
  代理商: { color: '#0d9488', icon: Handshake },
  系统集成商: { color: '#7c3aed', icon: Network },
  终端客户: { color: '#c47b17', icon: Building2 },
  供应商: { color: '#cb537f', icon: Package },
  其他: { color: '#64748b', icon: CircleUserRound },
};

function shortName(value: string, limit = 24) {
  let width = 0;
  let output = '';
  for (const character of value) {
    width += /[^\x00-\x7F]/.test(character) ? 2 : 1;
    if (width > limit) return `${output}…`;
    output += character;
  }
  return output;
}

function initialLayout(customers: Customer[]) {
  const ordered = [...customers].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  const columns = Math.max(2, Math.ceil(Math.sqrt(Math.max(1, customers.length) * 1.4)));
  const rows = Math.max(1, Math.ceil(customers.length / columns));
  const width = Math.max(920, columns * 220 + 100);
  const height = Math.max(570, rows * 185 + 130);
  const positions: Record<string, Point> = {};
  ordered.forEach((customer, index) => {
    const row = Math.floor(index / columns);
    const members = Math.min(columns, ordered.length - row * columns);
    const first = (width - (members - 1) * 220) / 2;
    positions[customer.id] = { x: first + (index % columns) * 220, y: 95 + row * 185 };
  });
  return { width, height, positions };
}

export function CustomerTopology({ customers, relationships, readOnly = false, onAddRelationship, onEditRelationship }: {
  customers: Customer[];
  relationships: Relationship[];
  readOnly?: boolean;
  onAddRelationship: () => void;
  onEditRelationship: (relationship: Relationship) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef('');
  const markerId = `topology-arrow-${useId().replace(/:/g, '')}`;
  const layout = useMemo(() => initialLayout(customers), [customers]);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [query, setQuery] = useState('');
  const [focusedId, setFocusedId] = useState('');
  const [hoveredId, setHoveredId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [viewingRelationship, setViewingRelationship] = useState<Relationship | null>(null);
  const [view, setView] = useState<View>(() => ({ center: { x: layout.width / 2, y: layout.height / 2 }, zoom: 1 }));
  useEffect(() => { setView({ center: { x: layout.width / 2, y: layout.height / 2 }, zoom: 1 }); }, [layout.width, layout.height]);

  const customerById = useMemo(() => new Map(customers.map(customer => [customer.id, customer])), [customers]);
  const visibleRelationships = useMemo(() => relationships.filter(relationship => customerById.has(relationship.fromCustomerId) && customerById.has(relationship.toCustomerId)), [relationships, customerById]);
  const matches = customers.filter(customer => `${customer.name} ${customer.country} ${customer.type}`.toLowerCase().includes(query.trim().toLowerCase()));
  const matchingIds = new Set(matches.map(customer => customer.id));
  const relatedIds = new Set(visibleRelationships.flatMap(relationship => [relationship.fromCustomerId, relationship.toCustomerId]));
  const activeCustomer = customerById.get(hoveredId || focusedId);
  const position = (id: string) => positions[id] ?? layout.positions[id];
  const zoom = (amount: number) => setView(previous => ({ ...previous, zoom: Math.max(0.4, Math.min(4, Math.round((previous.zoom + amount) * 100) / 100)) }));
  const reset = () => { setPositions({}); setFocusedId(''); setView({ center: { x: layout.width / 2, y: layout.height / 2 }, zoom: 1 }); };
  const focus = (customer: Customer) => { setFocusedId(customer.id); setView(previous => ({ center: position(customer.id), zoom: Math.max(1.35, previous.zoom) })); };
  const openRelationship = (relationship: Relationship) => { if (readOnly) setViewingRelationship(relationship); else onEditRelationship(relationship); };

  function screenPoint(clientX: number, clientY: number) {
    const inverse = svgRef.current?.getScreenCTM()?.inverse();
    return inverse ? new DOMPoint(clientX, clientY).matrixTransform(inverse) : new DOMPoint(clientX, clientY);
  }
  function startNodeDrag(event: PointerEvent<Element>, id: string) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const inverse = svgRef.current?.getScreenCTM()?.inverse();
    const start = screenPoint(event.clientX, event.clientY);
    dragRef.current = { mode: 'node', id, pointerId: event.pointerId, client: { x: event.clientX, y: event.clientY }, origin: position(id), start, inverseScale: { x: inverse?.a ?? 1, y: inverse?.d ?? 1 }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startPan(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest('[data-topology-interactive]')) return;
    const inverse = event.currentTarget.getScreenCTM()?.inverse();
    dragRef.current = { mode: 'pan', id: '', pointerId: event.pointerId, client: { x: event.clientX, y: event.clientY }, origin: view.center, start: screenPoint(event.clientX, event.clientY), inverseScale: { x: inverse?.a ?? 1, y: inverse?.d ?? 1 }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePointer(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.client.x;
    const dy = event.clientY - drag.client.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    setDragging(true);
    if (drag.mode === 'pan') {
      setView(previous => ({ ...previous, center: { x: drag.origin.x - dx * drag.inverseScale.x, y: drag.origin.y - dy * drag.inverseScale.y } }));
    } else {
      const point = screenPoint(event.clientX, event.clientY);
      setPositions(previous => ({ ...previous, [drag.id]: { x: drag.origin.x + point.x - drag.start.x, y: drag.origin.y + point.y - drag.start.y } }));
    }
  }
  function endPointer(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'node' && drag.moved) {
      suppressClick.current = drag.id;
      window.setTimeout(() => { if (suppressClick.current === drag.id) suppressClick.current = ''; }, 0);
    }
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyboardPan(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const deltas: Record<string, Point> = { ArrowLeft: { x: -90, y: 0 }, ArrowRight: { x: 90, y: 0 }, ArrowUp: { x: 0, y: -90 }, ArrowDown: { x: 0, y: 90 } };
    if (deltas[event.key]) { event.preventDefault(); const delta = deltas[event.key]; setView(previous => ({ ...previous, center: { x: previous.center.x + delta.x / previous.zoom, y: previous.center.y + delta.y / previous.zoom } })); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.2); }
    if (event.key === '-') { event.preventDefault(); zoom(-0.2); }
    if (event.key === 'Home') { event.preventDefault(); reset(); }
  }

  const pairGroups = new Map<string, Relationship[]>();
  visibleRelationships.forEach(relationship => {
    const pair = [relationship.fromCustomerId, relationship.toCustomerId].sort().join('\u0000');
    pairGroups.set(pair, [...(pairGroups.get(pair) ?? []), relationship]);
  });
  pairGroups.forEach(group => group.sort((a, b) => a.id.localeCompare(b.id)));

  return <section className="panel topology-panel">
    <div className="topology-heading"><div><h2>客户关系拓扑</h2><p>{customers.length} 个客户节点 · {visibleRelationships.length} 条已保存关系 · 圆节点可拖动，点击名称进入详情{readOnly ? ' · 只读权限' : ''}</p></div>{!readOnly && <Button variant="primary" disabled={customers.length < 2} onClick={onAddRelationship}><Plus size={15} />新增关系</Button>}</div>
    <div className="topology-toolbar">
      <div className="topology-search"><Search size={15} /><input aria-label="搜索拓扑客户" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索客户、国家或类型…" /><Button variant="ghost" disabled={!query.trim() || matches.length === 0} onClick={() => matches[0] && focus(matches[0])}>定位</Button>
        {query.trim() && <div className="topology-search-results" aria-label="拓扑搜索结果">{matches.length ? matches.slice(0, 6).map(customer => <button key={customer.id} onClick={() => focus(customer)}><strong>{customer.name}</strong><span>{customer.country || '国家待补充'} · {customer.type}</span></button>) : <p>未找到匹配客户</p>}{matches.length > 6 && <p>还有 {matches.length - 6} 个结果，请细化关键词</p>}</div>}
      </div>
      <div className="topology-controls" role="group" aria-label="拓扑视图操作"><button aria-label="缩小拓扑" title="缩小" disabled={view.zoom <= 0.4} onClick={() => zoom(-0.2)}><Minus size={16} /></button><span aria-live="polite">{Math.round(view.zoom * 100)}%</span><button aria-label="放大拓扑" title="放大" disabled={view.zoom >= 4} onClick={() => zoom(0.2)}><Plus size={16} /></button><button aria-label="重置拓扑布局与缩放" title="重置布局与缩放" onClick={reset}><RotateCcw size={15} /></button></div>
    </div>
    <div className="topology-legend" aria-label="客户类型图例">{CUSTOMER_TYPES.map(type => { const { color, icon: Icon } = TYPES[type]; return <span key={type}><i style={{ background: color }} /><Icon size={13} />{type}</span>; })}<span className="topology-line-legend"><Link2 size={13} />箭头表示关系方向</span></div>
    {!customers.length ? <Empty title="暂无客户节点" description="先在客户管理中新增客户，再添加实际代理、供应或合作关系。" /> : <>
      <div className={`topology-canvas ${dragging ? 'topology-dragging' : ''}`}>
        <svg ref={svgRef} className="topology-svg" viewBox={`${view.center.x - layout.width / (2 * view.zoom)} ${view.center.y - layout.height / (2 * view.zoom)} ${layout.width / view.zoom} ${layout.height / view.zoom}`} aria-label="客户关系图，方向键平移，加减键缩放，Home 重置布局" role="group" tabIndex={0} onPointerDown={startPan} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer} onKeyDown={keyboardPan}>
          <title>客户关系拓扑</title><desc>每个圆节点代表真实客户档案；连接线仅来自已保存的客户关系。点击客户名称进入详情，点击关系线编辑关系。</desc>
          <defs><marker id={markerId} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8095b0" /></marker></defs>
          <rect x={-100000} y={-100000} width={200000} height={200000} fill="transparent" aria-hidden="true" />
          <g className="topology-edges">
            {visibleRelationships.map(relationship => {
              const from = position(relationship.fromCustomerId), to = position(relationship.toCustomerId);
              if (!from || !to) return null;
              const distance = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
              const canonical = relationship.fromCustomerId < relationship.toCustomerId ? 1 : -1;
              const perpendicular = { x: -(to.y - from.y) / distance * canonical, y: (to.x - from.x) / distance * canonical };
              const pair = [relationship.fromCustomerId, relationship.toCustomerId].sort().join('\u0000');
              const group = pairGroups.get(pair)!;
              const offset = group.length === 1 ? 25 : (group.findIndex(item => item.id === relationship.id) - (group.length - 1) / 2) * 48;
              const control = { x: (from.x + to.x) / 2 + perpendicular.x * offset, y: (from.y + to.y) / 2 + perpendicular.y * offset };
              const clipped = (point: Point) => { const length = Math.max(1, Math.hypot(control.x - point.x, control.y - point.y)); return { x: point.x + (control.x - point.x) / length * (NODE_RADIUS + 7), y: point.y + (control.y - point.y) / length * (NODE_RADIUS + 7) }; };
              const start = clipped(from), end = clipped(to);
              const path = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
              const label = { x: (start.x + end.x) / 4 + control.x / 2, y: (start.y + end.y) / 4 + control.y / 2 };
              const fromName = customerById.get(relationship.fromCustomerId)!.name, toName = customerById.get(relationship.toCustomerId)!.name;
              const highlighted = relationship.fromCustomerId === focusedId || relationship.toCustomerId === focusedId;
              return <g key={relationship.id} data-topology-interactive="true" className={`topology-edge ${highlighted ? 'topology-edge-highlighted' : ''}`} role="button" tabIndex={0} aria-label={`${readOnly ? '查看' : '编辑'} ${fromName} 到 ${toName} 的${relationship.type}`} onClick={() => openRelationship(relationship)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRelationship(relationship); } }}>
                <title>{fromName} → {toName} · {relationship.type}{relationship.notes ? `\n${relationship.notes}` : ''}</title><path className="topology-edge-line" d={path} markerEnd={`url(#${markerId})`} /><path className="topology-edge-hit" d={path} />
                <rect className="topology-edge-label-bg" x={label.x - 40} y={label.y - 12} width={80} height={24} rx={5} /><text className="topology-edge-label" x={label.x} y={label.y + 4} textAnchor="middle">{relationship.type}</text>
              </g>;
            })}
          </g>
          <g className="topology-nodes">{customers.map(customer => {
            const point = position(customer.id);
            const { color, icon: Icon } = TYPES[customer.type];
            const highlighted = customer.id === focusedId || Boolean(query.trim()) && matchingIds.has(customer.id);
            const faded = Boolean(query.trim()) && !matchingIds.has(customer.id) && customer.id !== focusedId;
            return <a key={customer.id} data-topology-interactive="true" className={`topology-node ${highlighted ? 'topology-node-highlighted' : ''} ${faded ? 'topology-node-faded' : ''}`} href={`#/customers/${customer.id}`} aria-label={`打开 ${customer.name}，${customer.type}，${customer.country || '国家待补充'}`} style={{ '--node-color': color } as CSSProperties} onPointerDown={event => startNodeDrag(event, customer.id)} onClick={event => { if (suppressClick.current === customer.id) { event.preventDefault(); suppressClick.current = ''; } }} onMouseEnter={() => setHoveredId(customer.id)} onMouseLeave={() => setHoveredId('')} onFocus={() => setHoveredId(customer.id)} onBlur={() => setHoveredId('')}>
              <title>{customer.name} · {customer.country || '国家待补充'} · {customer.type} · {customer.status}</title><circle className="topology-node-halo" cx={point.x} cy={point.y} r={NODE_RADIUS + 8} /><circle className="topology-node-circle" cx={point.x} cy={point.y} r={NODE_RADIUS} /><Icon x={point.x - 12} y={point.y - 22} width={24} height={24} className="topology-node-icon" /><text className="topology-node-type" x={point.x} y={point.y + 18} textAnchor="middle">{customer.type}</text><text className="topology-node-name" x={point.x} y={point.y + NODE_RADIUS + 23} textAnchor="middle">{shortName(customer.name)}</text><text className="topology-node-country" x={point.x} y={point.y + NODE_RADIUS + 43} textAnchor="middle">{shortName(customer.country || '国家待补充', 24)}{!relatedIds.has(customer.id) ? ' · 暂无关系' : ''}</text>
            </a>;
          })}</g>
        </svg>
        {!visibleRelationships.length && <div className="topology-unlinked-note"><Link2 size={15} /><span>尚无已保存关系。新增关系后显示连线，客户类型本身不会自动生成连接。</span></div>}
      </div>
      <div className="topology-footer"><span><Move size={14} />拖动圆节点调整位置 · 拖动空白区域平移 · 布局仅保留在当前页面</span>{activeCustomer ? <a href={`#/customers/${activeCustomer.id}`}><strong>{activeCustomer.name}</strong> · {activeCustomer.country || '国家待补充'} · {activeCustomer.type}<ArrowUpRight size={13} /></a> : <span>点击关系线可{readOnly ? '查看' : '编辑'}关系及备注</span>}</div>
    </>}
    {viewingRelationship && <Modal title="客户关系（只读）" onClose={() => setViewingRelationship(null)}><dl className="topology-relationship-view"><div><dt>关系方向</dt><dd>{customerById.get(viewingRelationship.fromCustomerId)?.name || '客户未显示'} → {customerById.get(viewingRelationship.toCustomerId)?.name || '客户未显示'}</dd></div><div><dt>关系类型</dt><dd>{viewingRelationship.type}</dd></div><div><dt>备注</dt><dd className="pre-wrap">{viewingRelationship.notes || '暂无备注'}</dd></div></dl><div className="form-actions"><Button onClick={() => setViewingRelationship(null)}>关闭</Button></div></Modal>}
  </section>;
}
