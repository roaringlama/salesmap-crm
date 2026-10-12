import { getChatGPTUser, chatGPTSignInPath } from './chatgpt-auth';
import CRMClient from './client';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const user = await getChatGPTUser();
  const params = await searchParams;
  if (user) return <CRMClient />;
  const returnTo = params.invite ? `/?invite=${encodeURIComponent(params.invite)}` : '/';
  return <main className="login-screen"><div className="login-card"><span className="brand-mark">S</span><h1>SalesMap CRM</h1><p>客户、项目与售后，在同一个工作空间。</p><p className="muted">登录后拥有独立数据，可邀请同事编辑或查看。客户关系拓扑与项目阶段线路帮助你看清业务进展。</p><a className="btn btn-primary" target="_top" href={chatGPTSignInPath(returnTo)}>使用 ChatGPT 账号登录</a><small>登录即创建空工作空间，可导入已有 JSON 备份。</small></div></main>;
}
