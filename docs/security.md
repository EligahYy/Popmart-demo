# 安全与隐私说明

更新：2026-11-12

## 数据边界

- 收藏、订单、金额、备注、备份与个人素材**只存在浏览器 IndexedDB**。
- 服务端只提供两类能力：公开资料抓取（`/api/import/*`）与静态文件托管。
- 服务端不接收、不存储、不记录订单金额、备注、拥有清单、备份或个人图片。
- 没有账号体系、没有云端同步、没有分析 SDK 或第三方埋点。

## 传输

- 生产必须 HTTPS：Service Worker、PWA 安装与部分 Web Crypto 能力要求安全上下文。
- 前端与导入接口同源，不需要跨域配置。
- 媒体代理由服务端按主机白名单抓取（POP MART 官方域名与 CDN），
  逐跳校验重定向、拒绝非 https、非标准端口、内网与 IP 直连。
- 小程序分享码不解码，直接返回「需要名称」，不做 token 猜测。

## 响应头

静态 HTML 响应附带：

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: <官方 CDN>; media-src 'self' blob:; connect-src 'self';
  object-src 'none'; base-uri 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

`style-src` 允许内联样式是因为组件使用内联 CSS 变量与进度宽度；`script-src` 不允许内联脚本。

## 依赖审计（2026-11-12）

```bash
pnpm audit --prod   # No known vulnerabilities found
pnpm audit          # 3 条：1 low + 2 moderate
```

剩余 3 条全部来自 **构建期依赖** `workbox-build`（`glob` / `minimatch` / `deepmerge`），
不会进入前端产物，也不在运行时执行用户输入：

- `glob` 与 `minimatch` 只在 PWA 构建阶段扫描文件
- `deepmerge` 无官方修复版本，仅用于构建插件合并配置

处理方式：保持生产依赖为零告警；构建在受控环境中执行；不把构建工具暴露为服务。
升级 `vite-plugin-pwa` 时复核。

## 本机存储的真实边界

- IndexedDB 不是加密保险库：能解锁设备的人可以读取。
- 卸载应用、清理站点数据、换设备都会丢失本机数据，恢复依赖导出的备份 ZIP。
- 备份 ZIP 不加密，包含个人收藏与图片，需要用户自行妥善保存。
- 本应用不上传备份，也无法替用户保管备份。

## 日志与错误

- 前端错误边界只记录错误类型与组件栈前几行，不输出订单内容。
- 服务端不记录请求体；导入 API 只记录状态与耗时（开发模式）。
- 生产构建不含 `console.log` 级业务数据输出。

## 部署职责

- 配置 HTTPS 与证书续期
- 固定域名（换域名意味着新的浏览器存储空间，迁移前先备份）
- 反向代理不要把 `/api/*` 回退成 HTML
- 如需 HSTS、访问限流，由部署层添加
