import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { ApiError, MAX_BODY_BYTES } from './crm-service';
import type { Account } from './crm-service';

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' } });

export async function authenticated(): Promise<{ user: Account; db: D1Database }> {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, '请先登录账号。');
  if (!env.DB) throw new ApiError(503, '云端数据库尚未配置。');
  return { user, db: env.DB };
}

export function checkWriteRequest(request: Request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, '拒绝来自其他网站的修改请求。');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ApiError(403, '拒绝跨站修改请求。');
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, '请求必须使用 application/json。');
}

export async function readJson(request: Request, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > limit) throw new ApiError(413, '请求数据过大。云端工作空间最多支持 1.9 MB 数据。');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '请求内容不能为空。');
  const decoder = new TextDecoder();
  let length = 0;
  let source = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ApiError(413, '请求数据过大。云端工作空间最多支持 1.9 MB 数据。'); }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new ApiError(400, '请求不是有效的 JSON。'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ApiError(400, '请求必须是 JSON 对象。');
  return parsed as Record<string, unknown>;
}

export async function handle(operation: () => Promise<unknown>) {
  try { return json(await operation()); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, ...error.details }, error.status);
    console.error('CRM backend operation failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: '云端服务暂时不可用，请稍后重试。此次操作未完成。' }, 503);
  }
}
