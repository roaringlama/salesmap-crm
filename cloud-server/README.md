# SalesMap 在线协作版

React 客户端位于 `src/`（由项目根 `scripts/sync-cloud.mjs` 同步），页面/API 使用 Vinext，Cloudflare D1 保存每个工作空间的完整 CRM 快照。

## 本地开发

先在项目根执行 `npm ci`、`npm run sync:cloud`，再进入本目录：

```sh
npm ci
npx tsc --noEmit
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_colossal_switch.sql
npm run dev -- --port 5174 --hostname 127.0.0.1
```

本地登录模拟使用 `seedy@sites.test`，仅用于本机开发。根目录 `npm test` 包含云端 SQL 的权限、版本冲突和邀请测试。

## 身份与数据

生产环境使用 Sites 受信任代理验证的 ChatGPT 身份；每次 API 读写都会检查登录身份和工作空间成员权限。此适配器不能直接放在允许公开请求伪造身份头的服务器上。其他部署平台需替换 `app/chatgpt-auth.ts` 为真正的身份验证。

每个账号首次登录创建独立空工作空间，不导入业务样例。所有者可生成指定邮箱的编辑/只读邀请，成员必须登录并接受。服务端版本检查阻止并发覆盖；客户端不在云端失败时切换到本地数据库。

`db/schema.ts` 定义工作空间、成员、快照及邀请四张表。SQL 与 Drizzle 元数据位于 `drizzle/`，升级请新增迁移，不要更改已经应用的 SQL。所有业务数据保存在快照中。

公开源码中的 `.openai/hosting.json` 仅含默认 DB 绑定。Sites 发布时将平台注册得到的项目 ID 写入私有部署检出，使用 Sites 工具推送、保存版本及发布。不要公开源码写入令牌、私人备份或运行数据库。

完整部署/备份/迁移说明见项目根 README 和 `docs/DEPLOYMENT.md`。当前每工作空间快照最大约 1.9 MB；节点拖动位置只保留在当前页面。
