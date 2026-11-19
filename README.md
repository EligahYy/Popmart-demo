# my popmart

盲盒收藏与消费记录 PWA，支持 Vercel + Neon 云端共享展示。产品规则见 [PRD](my-popmart-PRD.md)，技术方案见[技术设计与开发实施文档](my-popmart-技术设计与开发实施文档.md)，导入可行性见 [docs/import-feasibility.md](docs/import-feasibility.md)。

## 功能总览

- **首页「我的小窝」**：3D 盲盒收纳柜、6 个 IP 入口、可点击播放的打招呼透明视频（WebGL 彩色+蒙版合成）
- **收藏架**：卡片循环滑动（首尾相接）、点击卡片从原位置翻转放大；正面款式图，背面身份信息（IP / 系列 / 当前拥有 / 获取记录 / 收藏故事），支持编辑小名与故事、送出/售出
- **添加 / 导入**：内联导入（输入系列名称英文或粘贴链接）、自定义系列、按行填写订单（来源 / 日期 / 金额）
- **账本「捂一下钱包？」**：周 / 月 / 年三档时间维度 + 顶部 IP 筛选 tab、点选单位与明细联动、明细两级折叠（年 → 月 → 款式）、月度预算（金额 / 数量）
- **身份卡**：收藏编号、小名、收藏故事、获取记录、转让
- **设置**：备份 / 还原、共享形象与打招呼视频、PWA 安装指引、版本号
- 默认云端共享：收藏、账本、预算、空间名称、图片与视频保存在 Neon；所有访客的修改彼此可见，已打开的页面约 5 秒更新一次。浏览器 IndexedDB 作为查询与媒体缓存。
- 首次建库为空，不生成演示数据；由站点所有者通过实际操作录入。设置 `DATA_MODE=local` 可使用原本机模式。
- Vercel 接入步骤、共享范围和旧数据迁移见 [部署说明](docs/deploy.md)。

## 交付说明

整体状态、验证证据、已知限制与后续步骤见 [docs/handover.md](docs/handover.md)。

## 部署

单进程即可运行：`pnpm start` → `http://127.0.0.1:8787`。生产环境需 HTTPS，
细节见 [docs/deploy.md](docs/deploy.md)。

## 目录结构

```text
apps/web/                 React + Vite 客户端
  src/domain/             业务纯函数（价格、库存、预算）
  src/db/                 Dexie schema 与命令层
  src/styles/             设计 token（正式配色待用户参考图确定）
apps/import-server/       导入与云端共享数据服务（Fastify）
  src/providers/          POP MART 页面适配器与 fixture
  data/aliases.zh.json    人工核验的中文别名（有限覆盖）
packages/contracts/       金额、日期精度、分摊、导入 DTO
docs/                     可行性记录与后续验收报告
```

## 环境

- Node ≥ 20（本项目实测 24.21.0）
- pnpm 11

> 注意：本机 DSH 运行时自带的 Node 开启了 hardened runtime 且未授予
> `disable-library-validation`，无法加载 rollup/esbuild 的原生模块。
> 因此仓库内使用官方 Node 二进制（`tools/`，已 gitignore）：
>
> ```bash
> export PATH="$PWD/tools/node-v24.21.0-darwin-arm64/bin:$PATH"
> ```
>
> 普通开发机使用系统 Node 即可，无需该步骤。

## 命令

```bash
pnpm install          # 安装依赖
pnpm test             # 全部单元测试
pnpm typecheck        # 类型检查
pnpm dev              # 启动 web 开发服务器（5173）
pnpm build            # 生产构建
pnpm --filter @my-popmart/import-server start   # 导入服务（8787）
pnpm --filter @my-popmart/web smoke             # 浏览器冒烟（需两个服务在跑）
pnpm --filter @my-popmart/web e2e               # 导入→购买→收藏架 全链路（需两个服务在跑）
pnpm --filter @my-popmart/import-server e2e:shared # 构建后验证双浏览器共享（自动启动测试服务，不使用生产库）
pnpm start                                      # 构建前端 + 单进程启动（8787，静态 + API）
```

## 已实现（P1 数据核心）

- **金额**：十进制字符串严格转分、BigInt 最大余数法分摊、合计一致性校验。
- **日期**：精确到日 / 仅月份 / 不详三档；周一为周起点；本地日期不经过 UTC 截断。
- **参考价**：款式级覆盖系列级，缺失返回 null，不虚构默认金额。
- **库存与账本**：持有量、净购买数量、净消费均从订单/明细/退款/转出实时派生。
- **预算**：整数比较的 75% / 100% / 超额三档，余额不截断。
- **命令层**：`createAcquisition` 在单一事务内写订单、明细、收藏编号、命令结果；
  同一 `commandId` 重复提交返回原结果，不同 payload 拒绝；维护模式阻止写入。

测试覆盖技术文档 T01–T05、T11、T13–T17 及边界用例，以及 Neon SQL、跨客户端共享、并发冲突、媒体分片和备份恢复。执行 `pnpm test` 验证。

## 导入服务

```text
POST /api/import/resolve   { input }       链接解析 / 小程序码返回 needs_name
POST /api/import/search    { query }       别名库 + sitemap 兜底
POST /api/import/preview   { candidateId } 标准化系列、款式、图片与警告
GET  /api/import/media/:token              签名媒体代理（1 小时过期）
GET  /api/health
```

环境变量：`PORT`（默认 8787）、`HOST`、`IMPORT_SIGNING_SECRET`。

真实链路已验证（2026-11-12）：

- 商品页链接 → 1 个候选 → 预览 13 个款式（12 常规 + 1 隐藏）
- 系列页 `/ca/collection/531` → 12 个候选
- 中文别名「好好生活」→ 命中 9120
- 签名媒体 token → 129 KB JPEG 正常返回
- 小程序分享码 → `needs_name`
- 未知名称 → 422 `NO_MATCH`

价格策略：商品页不提供人民币价，预览统一带 `PRICE_UNVERIFIED` +
`CNY_PRICE_UNAVAILABLE`，由用户在预览或首次购买时确认（见技术文档 §6.1）。

## 已实现主链路（P2 端到端）

真实浏览器（Chrome）已验证：

1. 首页 → ＋ → 导入新系列 → 粘贴官方链接
2. 解析出候选 → 预览 13 款 → 填单盒价 ¥69 → 保存到图库
3. ＋ → 选中款式 → 默认实付 **69.00**（参考价 × 1）→ 加入收藏
4. 提示「Stay Curious」已入住 ✨ → 首页显示 IP 入口「1 个系列 · 1 款 · 共 1 只」
5. 多选两款（数量 1 + 2）：默认总额 ¥207，改为 ¥180 后自动分摊 ¥120 / ¥60，保存后共 3 只
6. 点击 IP 入口进入收藏夹：系列卡组「第 1 / 3 款」，翻页、打开身份卡、正反面均无金额，关闭后回到原款式
7. 账本：累计 ¥180 / 2 只，本月 30 根柱子，点柱显示「12 · ¥180.00」，IP 筛选后金额与数量一致
8. 预算：设 ¥300 / 4 只 → 显示「还剩 ¥120.00 / 2 只」与状态文案，IP 筛选不影响额度
9. 明细：改金额 ¥138→¥120 后累计同步；退款 ¥20 → ¥100；送出一只 → 持有 2→1；删除误录 → 累计 ¥0、明细清空
10. 图片：导入后自动经同源代理缓存为本机 Blob（13/13），断网重载仍显示封面与收藏
11. PWA：manifest + Service Worker 接管，更新提示与安装指引可用
12. 备份：导出 ZIP → 恢复（校验 → 摘要 → 确认替换），恢复后旧数据集 retired、新数据集 active
13. 多明细退款：两款默认全选，¥30 自动分摊 ¥15/¥15，累计同步
14. 全程无 console 报错

截图流程脚本见 `apps/web/scripts/`（import / multi / collection / ledger / ledger-edit / refund-multi / offline / backup / personal / ac / device-prep / sheets）。

## 离线与 PWA

- 款式列表按需加载 384px WebP 缩略图，身份卡展示原图；原图地址始终保留（经 `/api/import/image` 同源代理，主机白名单校验，仅支持 OSS 的官方 CDN 启用缩放）
- 已展示的图片复用浏览器与 Vercel CDN 缓存，不在导入时同时下载整套原图；设置页仍可补缓存原图到 IndexedDB 用于离线与完整备份
- 界面优先使用本机 Blob，未缓存时回退远程地址
- 生产构建生成 `manifest.webmanifest`、`sw.js`，应用外壳可离线打开
- 设置页可补缓存图片、重新显示安装指引

## 安全与隐私

默认共享模式由服务端保存数据到 Neon；所有访客均可查看和修改。原本机模式的存储边界仍适用。响应头、依赖审计与存储边界见
[docs/security.md](docs/security.md)。

## 视觉主题

配色、圆角、阴影、字号与动效全部集中在 `apps/web/src/styles/theme.css`。
已按粉彩参考图接入主题（粉色主色、大圆角卡片、柔和阴影）。接入流程见
[docs/visual-theme.md](docs/visual-theme.md)。

## 个人化

- 共享模式的个人形象与打招呼视频上传到 Neon，浏览器缓存媒体；本机模式仍只保存于 IndexedDB；首页未设置时显示占位
- 首页为场景化布局：左侧盲盒收纳柜、右侧个人形象，中间渐变过渡
- 打招呼保留静态首帧，视频解码并完成透明合成后再淡入；结束先淡回静态图再重置播放位置。人物按钮关闭手机默认矩形触摸高亮，并保留键盘焦点提示；无关云端更新复用现有媒体地址
- 每次应用重新初始化时，从该 IP 已拥有款式图片中轮换封面（同会话稳定）
- 可在身份卡编辑小名与收藏故事

## 备份与恢复

```text
my-popmart-backup-YYYYMMDD-HHmm.zip
  manifest.json          格式/版本/时间/计数/文件哈希/媒体完整性
  data/<table>.json      14 张业务表
  media/<sha256>.<ext>   已缓存图片
```

- 导出在只读事务里取一致快照，哈希与压缩在事务外进行
- 未缓存的远程图会被标记为缺项，不谎称完整
- 恢复先校验容器、版本、文件哈希、外键与分摊一致性，再写入 staging 数据集，
  最后一次事务切换 `activeDatasetId`；旧数据集保留为 retired，失败不动当前数据

## 尚未实现

- iPhone 15 Pro Max 实机验收（步骤见 [docs/device-acceptance.md](docs/device-acceptance.md)）
