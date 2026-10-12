# SalesMap CRM

面向硬件销售的轻量级客户、项目、售后与公司关系管理工具。中文界面，MIT 开源。

在线使用：https://salesmap-crm.wnkxjtu.chatgpt.site

![公司关系拓扑](docs/topology.png)

## 核心功能

- 客户 → 多个独立销售项目；售后案例可独立存在或关联项目。
- 非线性销售/售后阶段，允许跳过、回退、直接切换；阶段备注与跟进日志分别保存。
- 客户详情的节点线路图：每个项目一条线路。
- 公司关系拓扑：圆形节点、带方向的代理/客户/供应/合作连线，支持搜索、缩放和拖动。
- Excel 报表、完整 JSON 备份、校验和确认后恢复。
- 本地版 IndexedDB 持久化；在线版独立账户、工作空间、编辑/只读协作邀请及版本冲突保护。

新安装默认空数据。任何客户名称、联系人、价格与业务记录都不属于公开源码。原有本地数据库升级时保留，旧版 JSON 备份可继续导入。

## 本地单用户版

需要 Node.js 22 或更新版本。

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173/ 。Windows 也可双击 `启动CRM.cmd`。

```sh
npm run typecheck
npm test
npm run build
```

本地版无需账号和外部服务。数据保存在当前浏览器、当前地址的 IndexedDB 中；换浏览器或电脑时，用 JSON 备份迁移。不要清除网站数据后再寻找记录。

## 在线协作版

`cloud-server/` 使用 Vinext、Cloudflare Worker/D1 和 Sites 的 ChatGPT 登录。Sites 部署时由平台验证身份并提供受信任身份头，不能把 Worker 直接暴露在允许用户伪造这些头的代理后面。自行部署到其他平台时，必须替换身份验证适配器，使用该平台验证后的服务器身份。

```sh
node scripts/sync-cloud.mjs
cd cloud-server
npm ci
npm run db:generate
npm run build
```

运行本地在线版前，把 `drizzle/` 中 SQL 按顺序应用到本地 D1：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_colossal_switch.sql
npm run dev -- --port 5174 --hostname 127.0.0.1
```

本地在线版的登录模拟只用于开发，生产环境依赖平台真实登录。构建与部署见 `cloud-server/README.md` 及 `docs/DEPLOYMENT.md`。

同一账号在不同电脑登录，即可访问同一云端工作空间。页面每 15 秒检查更新；编辑弹窗打开时暂停自动刷新。保存以服务器版本检查为准，同步异常会明确显示，不会切换到另一份本地数据。

每位销售首次登录会得到独立空工作空间。所有者可在「数据与备份 → 账号与协作」生成指定邮箱的邀请链接，选择可编辑或只读。受邀者登录后接受邀请，可切换工作空间。邀请链接不自动发送邮件，有效期 7 天，可撤销。

## 迁移与备份

1. 在原本地版打开「数据与备份」，下载 JSON 或点击「查看 / 复制 JSON」。
2. 在在线版登录自己的账号，检查当前工作空间。
3. 选择 JSON 备份或粘贴内容；检查预览数量，输入「恢复」并确认。
4. 恢复替换的是当前工作空间；替换前自动下载旧数据备份。

Excel 用于汇报，JSON 用于完整恢复。建议每周及重要修改前备份。备份包含真实业务数据，请只存放在私人位置；不要提交 GitHub。

## 当前边界

- 不包含邮件自动发送、附件上传、复杂权限层级、自动化营销。
- 工作空间快照限制约 1.9 MB；超过时会提示并拒绝保存，请备份后分拆工作空间或调整存储结构。
- 多人同一时间修改采用整份快照版本检查；冲突时保留当前草稿，备份并重新加载最新数据后再编辑。
- 拖动拓扑节点改变当前展示位置；关系本身保存在数据库中，节点位置不跨设备保存。

## 开源与贡献

见 `LICENSE`、`CONTRIBUTING.md` 和 `SECURITY.md`。公开仓库必须排除 `.private/`、`outputs/`、数据库、备份、`.env`、部署身份与凭据。`scripts/package-open-source.mjs` 生成经过白名单筛选的源码包。

