# 部署说明

## 形态

单个 Node 进程同时提供：

- `GET /`、`/ledger` 等：前端构建产物（SPA 回退到 `index.html`）
- `/api/import/*`：公开资料导入与媒体代理
- `/api/health`：应用健康检查
- `/api/shared/*`：共享状态、业务命令和媒体分片

默认使用 Neon Postgres 保存一份公开共享数据。收藏、订单、预算、空间名称和上传素材均由后端持久化，所有访客可查看和修改；浏览器 IndexedDB 作为本地查询和媒体缓存。设置 `DATA_MODE=local` 时使用旧的纯本机模式。

## 本地验证

```bash
pnpm install
pnpm --filter @my-popmart/web build
# 使用 Neon 时先在 shell 设置 DATABASE_URL；纯本机开发可设置 DATA_MODE=local
pnpm --filter @my-popmart/import-server start
# 打开 http://127.0.0.1:8787
```

`127.0.0.1` 属于安全上下文，Service Worker 与主屏幕安装可在本机验证。

## 生产部署

1. 构建前端：`pnpm --filter @my-popmart/web build`（产出 `apps/web/dist`）
2. 设置环境变量（见 `apps/import-server/.env.example`）：
   - `PORT`、`HOST`
   - `IMPORT_SIGNING_SECRET`：务必替换为随机长字符串
   - `STATIC_DIR`：前端 dist 的绝对路径，默认 `../../web/dist`
3. 启动：`pnpm --filter @my-popmart/import-server start`
4. 由平台或反向代理提供 **HTTPS**，并固定域名。

## Vercel Services 部署

仓库根目录的 `vercel.json` 声明了 Vite 前端和 Fastify 导入服务。Vercel 项目的
Root Directory 应指向仓库根目录，使该配置和 pnpm workspace 都参与构建。
`/api/*` 先转发到 `import-server`，保留原路径；其余请求交给 `web`。

- 入口源文件是 `apps/import-server/src/server.ts`；`pnpm build` 先类型检查，再将 workspace 代码打包为 `dist/server.js`，Vercel 从该 JavaScript 产物启动。生产环境同样调用 `listen()`。
  Vercel 的 Node 运行时会拦截该调用，获取 HTTP server。
- Fastify 工厂放在 `src/buildApp.ts`，避免被自动发现逻辑误选为应用入口。
  构建产物包含 Fastify import，服务配置的 `outputDirectory: dist` 明确指定该产物；别名 JSON 用 `includeFiles` 包含。
- 在 Vercel 项目中设置固定的 `IMPORT_SIGNING_SECRET`，至少覆盖实际使用的
  Production / Preview 环境。服务需要访问官方商品页、sitemap 和图片 CDN。
- `@fastify/static` 固定为 `8.3.0`（兼容 Fastify 5），并提交 pnpm lockfile。
  已确认 `10.1.10` 通过 CommonJS `require()` 加载 ESM-only 的
  `content-disposition@3.0.0`，在 Vercel 运行时触发 `ERR_REQUIRE_ESM`，
  导致包括健康检查在内的所有 API 启动失败。`runtime.test.ts` 覆盖此兼容性。
- 部署后先请求 `GET /api/health`，确认返回 JSON，再测试商品链接导入。
  若返回 HTML，检查项目根目录和 API 路由；若返回 5xx，查看导入服务 Runtime Logs。
- 名称搜索仅覆盖本地别名库和加拿大站英文 sitemap，不是官方全量中文搜索。
  上游不可达且没有别名结果时返回 `SOURCE_UNAVAILABLE`；真正无匹配才返回 `NO_MATCH`。

参考：[Fastify on Vercel](https://vercel.com/docs/frameworks/backend/fastify)、
[Service routing](https://vercel.com/docs/services/routing)。

## Neon 共享数据库接入

1. 在 Vercel 项目 → Storage / Marketplace 连接 Neon Postgres（已连接的项目无需重复创建）。
2. 在 Settings → Environment Variables 确认 **Production** 环境存在 `DATABASE_URL`，且可供 `import-server` 服务读取。代码也支持 `POSTGRES_URL` 和 `NEON_DATABASE_URL`。连接字符串只放在后端，不使用 `VITE_` 前缀。
3. `DATA_MODE` 默认为 `shared`；之前设置过 `DATA_MODE=local` 的项目请删除该值或改为 `shared`。`SHARED_SPACE_ID` 默认 `public`。
4. 部署最新 `main`。首次访问共享状态会自动创建 `popmart_shared_spaces` 和 `popmart_shared_media` 两张表，要求 Neon 连接用户具有建表权限。数据库只初始化空白空间，不生成演示记录。
5. 打开 `/api/shared/config`，应返回 `{"mode":"shared","configured":true}`；再打开 `/api/shared/state`，应返回包含 `revision` 的 JSON，证明数据库可读写并完成初始化。`/api/health` 只证明进程可用，不代表数据库连接一定成功。
6. 在站点录入一笔数据，在另一个浏览器或设备打开验证。新访客启动时从云端加载，已打开的页面在可见状态下每 5 秒检查更新，并在窗口重新获得焦点时刷新。

同一个 Vercel 项目的自定义域名、`www` 和 `vercel.app` 地址，只要后端使用同一个数据库和 `SHARED_SPACE_ID`，就会看到相同数据。Neon 为 Preview 配置独立分支时，Preview 数据可能与 Production 分离。

### 保存、并发和媒体

- 所有业务命令在服务器执行原有事务和数量/金额校验，使用 Postgres revision 条件更新提交；并发修改从最新状态重试，编辑版本冲突会显示错误，不直接覆盖另一位访客的数据。
- 只有云端提交成功才显示保存成功。网络或数据库失败不把本地缓存当作已保存结果；共享模式保存需要联网。
- 后端在每次命令中用隔离的临时 IndexedDB 执行既有业务规则，再提交到 Postgres；临时内存和 Vercel 本地文件都不作为持久化存储。
- 形象图片和视频以 512 KiB 分片存入 Postgres，避免超过 Vercel 单次请求/响应大小限制。图片保留 10 MB 上限，视频 30 MB。官方商品图可继续按原 URL 展示，本机缓存不影响云端记录。
- 当前按简历展示规模设计，结构化快照最大 3 MiB，素材分片按内容哈希去重。这不是无限容量的图片或视频托管；较大规模应把媒体迁移至对象存储。
- 新版界面会提示「共享展示空间」，原有 Service Worker 用户可点击更新或在设置中强制更新页面缓存。

### 原有浏览器数据

旧的 `my-popmart` 本机数据库保留，不会被自动公开。新的云端缓存使用独立数据库。若需要迁移旧记录，可先在原本机版本导出 ZIP，进入共享版后恢复；也可以临时使用 `DATA_MODE=local` 导出，再切回 `shared`。恢复会替换**所有访客**看到的数据，界面会明确确认。

## 为什么必须 HTTPS

- Service Worker、PWA 安装、`crypto.randomUUID` 等能力要求安全上下文
- 共享模式更换域名后仍从同一 Neon 空间读取；本机模式的不同域名、协议或端口仍隔离存储。

## 反向代理要点

- `/api/*` 不要被 SPA 回退改写成 200 HTML（服务端已按前缀返回 404）
- 静态资源可长缓存；`index.html` 与 `sw.js` 使用可更新策略
- 共享命令请求体上限 3 MiB，媒体分片请求上限 800 KiB；不要在反向代理额外降低这些限制。

## 运行依赖

- 导入需要服务端出网访问 `www.popmart.com` 与图片 CDN
- 共享服务不可达时：已打开页面的缓存仍可查看，保存修改需要恢复联网。
- 共享模式的 Postgres 是唯一权威数据源，导入服务重启与 Vercel 重新部署不清空数据。

## 健康检查

```bash
curl -s https://your-domain/api/health
# {"status":"ok","parserVersion":"popmart-next-data/1"}
```

## 备份与迁移

- 用户在本机「设置 → 导出备份」生成 ZIP，自行保存
- 共享模式换设备/换域名无需手工迁移，只需连接同一后端；本机模式仍需导出后恢复。
- 服务端不保存 ZIP 备份文件。共享空间没有登录隔离，所有访客使用同一份公开可修改数据。

## 已知限制

- 官方页面结构变化时导入会返回 `SOURCE_CHANGED`，需要更新适配器
- 人民币单盒价不来自官方公开页，由用户确认或人工目录提供
- 小程序分享码无法解析，走名称匹配
