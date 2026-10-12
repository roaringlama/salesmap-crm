import { useEffect, useState } from 'react';
import { getStorageInfo } from '../data/store';
import { Button, Field } from './UI';

type Member = { userId: string; email: string; name: string; role: string };
type Invite = { id: string; email: string; role: string; expiresAt: string };
type Details = { workspace: { id: string; name: string; role: string }; members: Member[]; invites: Invite[] };
const roleName = (role: string) => role === 'owner' ? '所有者' : role === 'editor' ? '可编辑' : '只读';
export async function workspaceRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? '操作失败，请重新登录后重试');
  return value;
}
export function WorkspacePanel({ info, onChange, onRefresh }: {
  info: ReturnType<typeof getStorageInfo> | null; onChange: (id: string) => Promise<void>; onRefresh: () => Promise<void>;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const endpoint = `/api/workspace?workspaceId=${encodeURIComponent(info?.currentWorkspaceId ?? '')}`;
  const load = async () => { const next = await workspaceRequest<Details>(endpoint); setDetails(next); setName(next.workspace.name); };
  useEffect(() => { if (info?.mode === 'cloud') { setDetails(null); setLink(''); void load().catch(e=>setError(e.message)); } }, [endpoint, info?.mode]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await action(); } catch(e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } }
  if (info?.mode !== 'cloud') return <section className="panel storage-info"><h2>个人工作空间</h2><p>当前使用本地版。在线版登录同一账号即可跨电脑同步，也可以邀请同事协作。</p></section>;
  return <section className="panel storage-info workspace-panel">
    <h2>账号与协作</h2><p>{info.user?.name || info.user?.email} · {info.user?.email}</p>
    <div className="workspace-controls"><Field label="切换工作空间"><select value={info.currentWorkspaceId} disabled={busy} onChange={e=>void run(()=>onChange(e.target.value))}>{info.workspaces.map(w=><option value={w.id} key={w.id}>{w.name} · {roleName(w.role)}</option>)}</select></Field><a className="btn btn-secondary" target="_top" href="/signout-with-chatgpt?return_to=%2F">退出登录</a></div>
    {details && <><h3>成员与权限</h3><div className="table-wrap"><table><thead><tr><th>成员</th><th>权限</th><th>操作</th></tr></thead><tbody>{details.members.map(member=><tr key={member.userId}><td>{member.name || member.email}<small>{member.email}</small></td><td>{roleName(member.role)}</td><td>{info.role==='owner' && member.role!=='owner' && <Button variant="ghost" disabled={busy} onClick={()=>{if(window.confirm(`移除 ${member.email} 的工作空间访问权限？`))void run(async()=>{await workspaceRequest(endpoint,{action:'removeMember',userId:member.userId});await load();setNotice('成员已移除');});}}>移除</Button>}</td></tr>)}</tbody></table></div>
    {info.role === 'owner' && <><form className="workspace-invite" onSubmit={e=>{e.preventDefault();void run(async()=>{const value=await workspaceRequest<{inviteURL:string}>(endpoint,{action:'invite',email:email.trim(),role});setLink(value.inviteURL);setEmail('');await load();setNotice('邀请链接已生成，请分享给指定同事');});}}><h3>邀请同事</h3><p className="muted">同事须用此邮箱登录后接受邀请。链接有效期 7 天，可随时撤销。</p><div className="workspace-controls"><Field label="同事登录邮箱" required><input type="email" required value={email} disabled={busy} onChange={e=>setEmail(e.target.value)} /></Field><Field label="协作权限"><select value={role} disabled={busy} onChange={e=>setRole(e.target.value as typeof role)}><option value="editor">可编辑</option><option value="viewer">只读</option></select></Field><Button variant="primary" type="submit" disabled={busy}>生成邀请链接</Button></div></form>
    {link && <div className="invite-result"><Field label="邀请链接"><input readOnly value={link}/></Field><Button disabled={busy} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(link);setNotice('邀请链接已复制');})}>复制链接</Button></div>}
    {details.invites.length>0 && <><h3>待接受的邀请</h3>{details.invites.map(invite=><div className="invite-row" key={invite.id}><span>{invite.email} · {roleName(invite.role)} · {new Date(invite.expiresAt).toLocaleDateString('zh-CN')} 到期</span><Button disabled={busy} variant="ghost" onClick={()=>{if(window.confirm('确认撤销此邀请链接？'))void run(async()=>{await workspaceRequest(endpoint,{action:'revoke',inviteId:invite.id});await load();setNotice('邀请已撤销');});}}>撤销</Button></div>)}</>}
    <form className="workspace-controls" onSubmit={e=>{e.preventDefault();void run(async()=>{await workspaceRequest(endpoint,{action:'rename',name:name.trim()});await load();await onRefresh();setNotice('工作空间名称已更新');});}}><Field label="工作空间名称"><input required maxLength={100} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></Field><Button type="submit" disabled={busy}>保存名称</Button></form></>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
