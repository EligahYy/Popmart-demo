# 部署说明

## 形态

单个 Node 进程同时提供：

- `GET /`、`/ledger` 等：前端构建产物（SPA 回退到 `index.html`）
- `/api/import/*`：公开资料导入与媒体代理
- `/api/health`：健康检查

个人数据只存在用户浏览器的 IndexedDB，服务端不接收订单、金额、备份或个人素材。

## 本地验证

```bash
pnpm install
pnpm --filter @my-popmart/web build
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

- 导入服务入口是 `apps/import-server/src/server.ts`，生产环境同样调用 `listen()`。
  Vercel 的 Node 运行时会拦截该调用，获取 HTTP server。
- Fastify 工厂放在 `src/buildApp.ts`，避免被自动发现逻辑误选为应用入口。
  `server.ts` 保留来自 `fastify` 的类型导入，满足 Fastify 构建器的入口检测。
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

## 为什么必须 HTTPS

- Service Worker、PWA 安装、`crypto.randomUUID` 等能力要求安全上下文
- 更换域名、协议或端口会得到不同的浏览器存储空间：**迁移前先导出备份，再在新地址恢复**

## 反向代理要点

- `/api/*` 不要被 SPA 回退改写成 200 HTML（服务端已按前缀返回 404）
- 静态资源可长缓存；`index.html` 与 `sw.js` 使用可更新策略
- 请求体上限至少 1 MB（导入接口只接收很小的 JSON）

## 运行依赖

- 导入需要服务端出网访问 `www.popmart.com` 与图片 CDN
- 服务停止时：已缓存内容仍可离线查看与记账，导入功能如实降级
- 服务端只做公开资料抓取与图片代理，不持久化用户数据

## 健康检查

```bash
curl -s https://your-domain/api/health
# {"status":"ok","parserVersion":"popmart-next-data/1"}
```

## 备份与迁移

- 用户在本机「设置 → 导出备份」生成 ZIP，自行保存
- 换设备/换域名：先导出，再在新地址「恢复备份」
- 服务端不保存备份文件，也没有云端账户

## 已知限制

- 官方页面结构变化时导入会返回 `SOURCE_CHANGED`，需要更新适配器
- 人民币单盒价不来自官方公开页，由用户确认或人工目录提供
- 小程序分享码无法解析，走名称匹配
