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
