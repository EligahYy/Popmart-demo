# my popmart 技术设计与开发实施文档

版本：v1.2 · 价格实施路径补充版  
首次整理：2026-10-29  
最后复核：2026-11-12  
产品依据：[《my popmart 产品需求文档（PRD）》](./my-popmart-PRD.md) v2.2  
目标：让开发 agent 能直接进行技术验证、建模、实现、测试与交付。

## 0. 阅读顺序、约束与完成标准

先读 PRD，再读本文，最后读取用户提供的个人形象原图和视觉参考图。PRD 定义产品规则；本文确定默认技术方案和具体实施规则。若实现需要变更产品行为，不能以技术文档为理由覆盖用户决定。

本文是开发方案，不是已上线应用，也不宣称已运行导入程序或完成手机测试。外部能力的验证边界见第 8、18 节。文中 `/api/...` 都是本应用需要实现的接口，不是泡泡玛特官方接口。

已固定的边界：

- iPhone 15 Pro Max 为主要设备，PWA，两页【我的小窝】【账本】加【欢迎新宝宝】新增面板。
- 个人数据仅本机；无账号、云同步、商城、社交及售出收入统计。
- 每次仅导入一个系列；链接失败转名称匹配，不做拍照、抠图、手动创建款式。
- 支持跨 IP 多选／取消，一单多款，按官方价及数量权重分摊实付，可修改。
- 身份卡不展示金额，账本不打开身份卡；新增及账本编辑表单可以输入金额。
- 首页个人背景与 IP 动态入口同页；点击 IP 才进入系列叠卡；每系列同时最多三张卡，独立滑动。
- 真实购买必须有实付，礼物不要求金额；日期可以精确到日、仅月份或不详。
- 月度上限可复用，剩余额度不结转；预算仅在账本提示。
- 备份和恢复、离线读写、退款／退货／转出属于首版，不留到“未来再做”。

技术栈、文件组织和性能阈值是本文件给出的工程默认值，不要求用户再做技术选择。可在不改变数据契约和行为的情况下调整实现，但要在交付 README 记录原因。

## 1. 总体架构

```text
iPhone Safari / 主屏幕 PWA
  React 页面、交互面板、动画
      ↓ 业务命令与纯函数查询
  本机 IndexedDB：图库、订单、退款、转出、预算、素材 Blob
      ↓ 显式导出 / 恢复
  用户保存的备份 ZIP 文件

  仅导入公开资料时联网
      ↓ 系列链接 / 系列名称 / 官方媒体标识
  同源 Node 导入辅助服务
      ↓ 白名单公开页面和媒体、已核验目录索引
  POP MART 官方公开资源

Service Worker：缓存应用外壳；不负责个人账本同步
```

### 1.1 为什么不是只有一个静态页面

收藏与记账可以完全在设备本地运行；读取官方页面、下载图片并打包备份则受浏览器跨域策略影响。能用 `<img>` 显示一张远程图，不代表能读取其字节写入本地。`no-cors` 不能把不可读响应变成可解析商品数据。[CORS 说明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)

默认部署一个 Node 服务：同时托管前端静态文件和 `/api/import/*`，避免前后端之间再产生跨域配置。服务仅处理公开目录和官方媒体，不接收订单、金额、备注、拥有清单、个人素材或备份。

没有部署导入服务时，可开发本机功能，但不能宣称完整交付自动导入。无需因此改成云端保存个人数据。

### 1.2 默认技术选型

| 部分 | 选型 | 边界 |
| --- | --- | --- |
| 前端 | React + TypeScript + Vite | 客户端应用，无 SEO／SSR 需求，不使用服务端保存个人状态 |
| 路由 | React Router | 首页、IP 收藏夹、账本、设置；详情与新增为受控覆盖层 |
| 本地数据 | IndexedDB + Dexie，React 侧使用响应式查询 | 不使用 Dexie Cloud；不把账本放 localStorage |
| 校验 | Zod + 共享 TypeScript 契约 | 表单、接口响应、备份文件均校验 |
| 样式／动画 | CSS Modules、CSS 自定义属性、CSS transforms／Web Animations | 不引入 3D 引擎；视觉 token 根据用户参考图定义 |
| 图表 | 自建轻量 SVG 柱状图 | 最多 31 根柱，提供文本等价内容；无需大型仪表盘库 |
| PWA | vite-plugin-pwa + Workbox | 显式更新提示，保护正在填写的表单 |
| 日期 | date-fns 的日历运算 + 明确的日期字符串类型 | 不用 UTC 时间戳替代购买日期 |
| 备份 | fflate，Worker 中压缩／解压与校验 | 图片、视频不重复高压缩；恢复有原子切换 |
| 导入服务 | Node 当前受支持 LTS + Fastify + Cheerio | 原生 fetch 读取公开页面；不假设存在官方 API |
| 测试 | Vitest、fake-indexeddb、Playwright + iPhone 实机 | WebKit 模拟不能替代主屏幕安装、播放和文件恢复实测 |

React 文档提供 Vite + TypeScript 的构建路径；本产品采用客户端架构是针对本机数据需求的选择，不表示它适用于所有网站。[React 构建说明](https://react.dev/learn/build-a-react-app-from-scratch)、[Vite 文档](https://vite.dev/guide/)

初始化时选取相互兼容的稳定版本，记录 Node／包管理器版本，提交 lockfile，CI 用锁定安装。不要在本文写未经验证的“最新版本号”，也不要每次构建自动升级依赖。

## 2. 工程目录与模块职责

```text
my-popmart/
  apps/web/
    src/app/                   路由、启动、错误边界、PWA 更新
    src/features/home/         个人背景、IP 入口与轮换
    src/features/collection/   系列卡组、身份卡、转出操作
    src/features/add/          单选／多选、订单草稿与购买表单
    src/features/import/       链接／名称、候选、预览、图库提交
    src/features/ledger/       统计、图表、明细、退款、预算
    src/features/settings/     本机素材配置、备份、恢复、安装指引
    src/domain/                金额、日期、库存、预算与校验纯函数
    src/db/                    Dexie schema、迁移、命令、只读查询
    src/media/                 Blob 读写、URL 生命周期、下载队列
    src/backup/                导出／恢复状态机与 Worker
    src/components/            可复用界面，不包含业务写入
    src/styles/                token、布局、减少动态效果
  apps/import-server/
    src/routes/                本文定义的导入／媒体接口
    src/providers/popmart/     已验证站点适配器
    src/catalog/               官方公开目录索引及中文别名
    src/security/              域名、重定向、响应大小校验
  packages/contracts/          DTO、日期／金额类型、错误码
  tests/                       业务、迁移、端到端、导入真实样本
  docs/                        PRD、技术文档、导入验证记录、验收报告
```

规则：组件不直接对订单表 `put()`；所有业务写入经过命令层。收藏、账本和预算使用同一份 domain 查询，不各自复制计算代码。客户端和服务端只共享公开导入契约；服务端不需要个人数据库模型。

## 3. 数据存储分层

| 数据 | 存储位置 | 是否进入备份 |
| --- | --- | --- |
| IP、系列、款式、来源与价格 | IndexedDB 结构化表 | 是 |
| 获取订单、明细、退款、转出 | IndexedDB 结构化表 | 是 |
| 小名、故事、收藏编号、预算 | IndexedDB 结构化表 | 是 |
| 个人图／视频、已保存官方图片和动画 | IndexedDB Blob 表 | 是，按内容校验 |
| 应用 JS、CSS、通用图标和字体 | Service Worker Cache Storage | 否，随应用版本部署 |
| 临时已选项、表单草稿 | IndexedDB 草稿表；前台有内存镜像 | 否，不属于已提交业务 |
| 当前翻面、拖动距离、模态焦点 | 页面内存 | 否 |
| 最近系列、IP 上次素材、设置 | IndexedDB 偏好表 | 是 |
| 已验证公开系列目录与来源 | 服务端只读 JSON／可重建缓存 | 不含个人数据；已导入条目进入本机备份 |

不得把业务数据只放内存或 localStorage；不得把图片 Base64 塞入 JSON 账本。Blob 与业务元数据分表，但存同一 IndexedDB 数据库，便于事务和恢复管理。Dexie 支持复合索引，Blob 字段不要建索引。[Dexie schema 文档](https://dexie.org/docs/Version/Version.stores())

### 3.1 本机持久化的实际边界

调用 `navigator.storage.estimate()` 展示存储状态；首次保存后可请求 `persist()`，检查结果但不把授权成功作为正常记账前提。处理 `QuotaExceededError`，失败时保留输入、回滚写入，不显示成功。

主屏幕 PWA 仍受存储配额及系统清理政策影响；不能保证“永不丢失”，也不能仅凭 persist 请求就保证永久保存。用户删除站点数据、卸载或换设备后的恢复依靠备份。[WebKit 存储政策](https://webkit.org/blog/14403/updates-to-storage-policy/)

固定正式 HTTPS origin；更换域名、协议或端口可能意味着不同存储空间。正式使用后不随意更换地址。Safari 标签与主屏幕运行环境是否共享已有数据，必须在实际 iOS 版本上验证，不假定自动迁移；必要时通过备份导出／恢复迁移。

## 4. 本地数据库模型

### 4.1 公共类型

```ts
type Id = string; // crypto.randomUUID()
type Cents = number; // 非负安全整数；人民币分
type AcquisitionDate =
  | { precision: 'day'; day: string; month: string } // YYYY-MM-DD、YYYY-MM
  | { precision: 'month'; month: string }
  | { precision: 'unknown' };

type AcquisitionSource = 'official' | 'secondhand' | 'gift';
type AmountMode = 'official_auto' | 'manual';
type RowBase = {
  datasetId: Id;
  id: Id;
  createdAt: string; // ISO 时间戳，审计／排序用
  updatedAt: string;
  revision: number; // 乐观并发版本
};
```

校验真实日历日期和年月，不只用正则。日期 `month` 必须与 `day` 一致。`createdAt` 不是购买日期。金额输入先按十进制字符串转分；拒绝负值、指数形式、多于两位小数和超出安全整数范围，不先用浮点乘 100 再猜测舍入。实际零元可以明确保存，不以零元表示未知。

### 4.2 dataset 命名空间

所有用户表以 `[datasetId+id]` 为主键。全局 `appMeta` 保存 `activeDatasetId`；界面查询与写入永远只使用当前数据集。恢复将备份写入新数据集，验证完整后一次切换指针，不先清空现有数据。此设计服务于可靠恢复，不是多用户功能。

`appMeta` 不带 datasetId：`id='control'`、activeDatasetId、dbSchemaVersion、appDataRevision、maintenance 状态（restore／none）、维护操作 ID、ownerTabId、leaseExpiresAt、fencingEpoch。每条写命令的事务必须读取该行，校验当前 dataset 与维护状态，并在成功时递增 appDataRevision。

### 4.3 表与字段

下列字段加上 RowBase，除特别说明外为必需字段。媒体是可缺失的可恢复资料，不阻塞已有订单查看。

| 表 | 主要字段 | 关系／说明 |
| --- | --- | --- |
| `datasets` | id、status(staging/active/retired)、schemaVersion、verifiedAt | 全局数据集状态，不与业务记录复用 ID |
| `ips` | canonicalKey、displayName、aliases[]、sortOrder | canonicalKey 是已核验 IP 标识，名称变化不改 ID |
| `series` | ipId、canonicalKey、names、aliases[]、productKind、sourceRefs[]、sortOrder、defaultUnitCents?、priceProvenance?、priceUpdatedAt?、foreignReference? | 区分手办、挂件、POP BEAN，不只按名称去重；系列级单盒参考价，款式无覆盖时继承；foreignReference 仅存当地币种原价供展示 |
| `styles` | seriesId、canonicalKey、names、sortOrder、isSecret、imageAssetId?、referenceUnitCents?、priceProvenance?、priceUpdatedAt? | 单盒参考价只存人民币；非空时覆盖系列默认；来源区分用户确认／人工目录／历史推断 |
| `sourceRefs` | ownerType、ownerId、provider、region、productId?、canonicalUrl、fetchedAt、parserVersion、contentHash | 不保存私有登录 token；raw HTML 不进个人备份 |
| `acquisitions` | source、date、paidTotalCents、channel?、note?、status(active/deleted)、commandId | official/secondhand 金额非空；gift 为 null，业务上不是零元购买 |
| `acquisitionLines` | acquisitionId、styleId、quantity、allocatedCents、referenceUnitCentsSnapshot、allocationMode、lineOrder | 一单同款合并一行；gift 的金额／权重为 null；一行就是来源批次 |
| `refunds` | acquisitionId、kind(refund_only/return)、processedOn、totalCents、note?、status | processedOn 精确日期；统计按原购买日期 |
| `refundLines` | refundId、acquisitionLineId、refundCents、returnedQuantity | refund_only 的 returnedQuantity=0；同次退货允许多款 |
| `transfers` | kind(give_away/sold)、occurredOn、note?、status | 无售出价格字段 |
| `transferLines` | transferId、acquisitionLineId、quantity | 对明确批次扣减持有，数量正整数 |
| `collectionProfiles` | styleId、collectionNo、nickname?、story? | 首次拥有才建立；数量归零保留，不存一套独立金额／数量 |
| `budgetRules` | effectiveFromMonth、amountLimitCents?、quantityLimit? | null 表示该维度关闭；有效期规则按月生效 |
| `budgetMonths` | month、amountLimitCents?、quantityLimit?、ruleId? | 月份上限快照；用量实时派生，不存会漂移的累加余额 |
| `assets` | hash、mime、byteLength、kind、sourceUrl?、ownerType、ownerId、status、posterAssetId? | status=pending/ready/failed；记录素材来源与用途 |
| `mediaBlobs` | id=hash、blob | `[datasetId+hash]` 唯一；二进制按 SHA-256 去重 |
| `preferences` | key、value | 个人名称、背景素材、最近系列、IP 上次素材等按受限 schema 校验 |
| `drafts` | kind、payload、baseEntityRevision?、lastSavedAt | 未提交的单一新增草稿或编辑草稿，不计统计 |
| `commandResults` | commandId、type、payloadHash、result、committedAt | 防重放；同 ID 不同 payload 拒绝 |
| `counters` | key、value | 收藏编号原子递增，首版无用户设置编号规则 |

`names` 至少包含可显示名称，允许附原文；中文别名来自已核验对应关系，不凭翻译把两个不同商品合并。sourceRefs 可内嵌或独立建表，本文采用独立表。

### 4.4 索引与约束

- 常用索引必须带 datasetId：系列按 ipId，款式按 seriesId，订单按 date.month／date.day，明细按 acquisitionId／styleId，退款与转出按来源明细。
- 唯一索引：IP canonicalKey、系列 canonicalKey、款式 canonicalKey、profile.styleId、profile.collectionNo、budgetRules.effectiveFromMonth、budgetMonths.month、commandResults.commandId（均在 dataset 内唯一）。同月修改规则使用 upsert，不创建两个互相冲突的同月规则。
- 日期不详的空索引不能用作唯一查询入口；累计查询包含所有 active 订单，并单独筛日期精度。
- IndexedDB 无自动外键约束，命令提交和备份恢复必须验证引用存在、父子 dataset 一致。
- 收藏编号采用 `MP-000001` 等格式，使用计数器事务分配，删除误录也不回收编号；恢复后计数器至少为最大已用编号。
- 源站识别去重用 `provider + region + productKind + externalProductId`；跨地区只有确认同一系列后才建立显式 alias 映射，不猜测自动合并。
- 同款式的不同购入批次引用同一个 styleId；不按付款金额或购买日期创建重复款式。

### 4.5 金额和持有的唯一事实来源

```text
lineReturnedQty = active refundLines.returnedQuantity 合计
lineTransferredQty = active transferLines.quantity 合计
lineHeldQty = acquisitionLine.quantity - lineReturnedQty - lineTransferredQty
lineNetPaid = acquisitionLine.allocatedCents - active refundLines.refundCents 合计

styleHeldQty = 同款所有 active 获取批次 lineHeldQty 合计
netBoughtQty = 仅 official / secondhand 批次 (quantity - lineReturnedQty) 合计
netSpend = 仅 official / secondhand 批次 lineNetPaid 合计
```

gift 可转出，但不能退款；礼物金额为 null，不与 unknown amount 混淆。所有公式排除已删除订单和已撤销变动。`lineHeldQty >= 0`、`lineNetPaid >= 0`。订单净额必须与其各行净额之和一致。

首版可实时复算；如为性能建立 projection 缓存，缓存必须有 dataRevision，可随时重建，不能成为唯一账本。

## 5. 业务写入与事务

### 5.1 命令接口

```ts
createAcquisition(commandId, datasetId, validatedDraft)
updateAcquisition(commandId, datasetId, orderId, expectedRevision, patch)
deleteAcquisition(commandId, datasetId, orderId, expectedRevision)
createRefund(commandId, datasetId, orderId, refundDraft)
updateRefund / deleteRefund
createTransfer(commandId, datasetId, transferDraft)
updateTransfer / deleteTransfer
updateCollectionProfile(commandId, datasetId, styleId, patch)
setBudget(commandId, datasetId, currentMonth, limits)
commitSeriesImport(commandId, datasetId, confirmedPreview)
undoCommand(commandId, originalCommandId)
```

所有命令返回明确结果或结构化错误。UI 只在事务成功后显示入住／保存成功；失败保留表单。写入期间禁用重复提交只是界面措施，不能替代数据库幂等性。

### 5.2 事务执行顺序

1. 在事务外校验输入格式，计算请求 hash、准备 ID 和需要的媒体 hash。
2. 开启涵盖 appMeta、commandResults 及所有涉及业务表的 readwrite 事务。
3. 检查 activeDatasetId、维护状态、已提交 commandId 及 expectedRevision。
4. 读取数据库当前值，再验证库存、退款、总额、引用约束，不只相信表单展示值。
5. 原子写入订单／明细／个人 profile／变动记录及 commandResult，递增 revision。
6. 提交成功后清理对应草稿、更新 UI。清草稿也应在同一写事务中完成，或通过 committedCommandId 防止恢复已提交草稿。

不得在数据库事务内等待网络下载、视频解码、ZIP 压缩、用户点击或 WebCrypto hash。Dexie 文档说明异步事务可能提前结束；上述工作先完成，再进入短事务。[Dexie transaction 文档](https://dexie.org/docs/Dexie/Dexie.transaction())

每个标签页通过同一命令层写入。BroadcastChannel 用于刷新／维护提示，不能替代数据库冲突检测。表单记录打开时 revision，其他页先修改则提示重新加载并保留用户草稿，不静默覆盖。

### 5.3 编辑、删除与撤销

- 单纯调整来源、备注、日期不创建新订单；日期变化触发所有日期维度重新查询。
- 有退款／转出后，不允许直接删去被引用的明细；应先纠正相关变动，或使用已说明关联影响的整笔误录删除。
- 减少原数量时，必须仍覆盖已退货和已转出数量；减少原分摊金额时，必须仍覆盖已退款金额。
- 整笔误录删除采用 tombstone：同时排除该订单、关联退款，以及转出中引用它的分配行。混合来源的转出保留其他批次行，不能误删其他订单的转出；无剩余行的变动再置 deleted。
- 软删除条目在备份中保留，但不参与正常统计；不自动永久清理历史。
- 新增短时撤销仅撤回这次命令。有后续依赖或 revision 已变时不做盲目逆操作，指向账本查看并纠正。
- 转出默认按最早获取日期分配批次；精确日期按日、仅月份按月的排序键比较，仅月份与当月精确日并列时使用 createdAt 打破平局；日期不详排后。允许用户显式选择批次。排序不会把月份假装成真实购买日。

## 6. 金额、日期与预算算法

### 6.1 官方价默认与输入状态

价格拆成两个独立字段，语义不同，不能互相覆盖：

| 字段 | 位置 | 含义 | 必填 |
| --- | --- | --- | --- |
| 参考价 | `style.referenceUnitCents` 或 `series.defaultUnitCents` | 该系列单盒官方价（人民币分），用于预填默认金额 | 否，可缺失 |
| 实付 | `acquisition.paidTotalCents` | 这一次实际支付；礼物为 null | 是（礼物除外） |

参考价解析顺序：`style.referenceUnitCents ?? series.defaultUnitCents ?? 无`。系列级设置一次即覆盖全系列；特殊款（隐藏款、大娃、联名）用款式级字段单独覆盖。两者都只存人民币分。

**参考价来源与更新**

- `priceProvenance ∈ user_confirmed | catalog | from_history`，配 `priceUpdatedAt`；界面必须显示当前默认值的来源（PRD 4.5）。
- 只接受人民币单盒价。抓到的海外当地币种价另存 `foreignReference { amountMinor, currency, region, sourceUrl, fetchedAt }`，仅作参考展示，**不参与默认金额、不换算**。
- 整盒价不得写入参考价：同 SPU 多 SKU 时取最低正价 SKU 作单盒候选；若多个 SKU 价差接近整数倍（如 ×12），标记 `PRICE_UNVERIFIED`，要求用户确认。
- 官方调价只更新参考价与 `priceUpdatedAt`，不改历史 `acquisitionLines.referenceUnitCentsSnapshot`。
- 二手实付、退款、赠送不回写参考价。

**设置入口（三处，互为兜底）**

1. 导入预览：与系列确认同屏，可跳过。
2. 首次按该系列录入购买：购买表单顶部内联一行，可现场填写，保存后写入图库。
3. 设置页「系列价目表」：列出系列、参考价、来源、更新时间，可批量修改。

**输入状态**

新增草稿记录 `amountMode`，不能只看金额数值判断用户是否改过。

| 操作 | 自动金额 | 已手动金额 |
| --- | --- | --- |
| 改数量／选择更多款式 | 所有价格齐全时重算 | 保留金额，标记需要核对分摊 |
| 官方切二手 | 清空自动金额 | 保留 |
| 二手切官方 | 当前空值可按官方价填入 | 保留 |
| 切礼物 | 隐藏金额，保存为 null | 不把此前金额计入消费 |
| 从礼物切回购买 | 恢复本次草稿里的购买金额状态；无值则按来源规则处理 | 核对后保存 |

缺任一参考价时，不自动把其他款的合计当作整单实付。用户可现场补参考价或直接填订单实付并手动分配；保存时全部分摊已完整，不提供金额待补。

**补录历史**

补录时优先带入该系列参考价作为默认实付，用户确认即可保存，不需逐笔回忆。这满足“每笔都有确认过的实付”，不产生金额待补。不提供“沿用上次价格”按钮（PRD 5.4）；历史实付只能作为设置参考价时的候选，须标 `from_history` 并经用户确认。

### 6.2 按官方价比例分摊

使用整数分与 BigInt 中间运算，避免 `amount * weight` 溢出或浮点尾差。

```text
weight[i] = referenceUnitCentsSnapshot[i] × quantity[i]
sumWeight = Σ weight
floor[i] = floor(totalCents × weight[i] / sumWeight)
remainder[i] = (totalCents × weight[i]) mod sumWeight
remaining = totalCents - Σ floor
按 remainder 降序，每项补 1 分，直至 remaining = 0
同余时按稳定 lineOrder 升序
```

总权重为 0 或任何需要权重缺失时，不运行该算法，要求补价或手动分配；部分权重明确为 0 时可分得 0。全部分摊为非负整数，合计严格等于订单实付。

手动改某行后不自动修改其他行以“凑平”，显示还差／超出多少。明确点击【按官方价重新分配】才覆盖手动结果。后续图库价格更新不重算历史快照。

退款使用相同最大余数方法，但权重为选中明细的当前剩余实付。保存再校验各行退款上限；订单金额编辑不能使已有退款超过分摊金额。

### 6.3 时间查询

- 时间戳仅用于 createdAt、updatedAt、导入时间。业务日期保持日历字符串。
- today 使用设备本地日历；不使用 `new Date().toISOString().slice(0,10)` 生成默认购买日。
- 周范围由当前选择日期计算周一到周日，跨月／跨年正常按实际日范围查询。
- day 精度参与日／周／月／年／累计；month 只参与月／年／累计；unknown 只参与累计。
- 礼物在记录区单列“赠送／未支出”，不进入消费柱状图或购买数量。
- 月图表返回 `datedBuckets` 和 `monthOnlySubtotal`；不把月级记录塞进 1 日。日期不详在累计列表单列，不靠创建时间混入本月。
- 退款统计使用原获取日期；本月处理上月退款不形成当前月收入或新的预算额度。

### 6.4 预算

- 初始两个维度均关闭，不擅自给用户设 ¥300 或 4 个；这些仅是示例。
- 首次设置从当前月生效。历史无规则月份显示“未设置限度”，不反填后来设置的上限。
- `budgetRules` 记录生效月和设置；`budgetMonths` 是该月快照。隔几个月未打开时，根据各月当时有效规则补快照，不拿最新规则覆盖旧月。
- 修改只更新本月快照和本月起的后续规则，过去月份不可在该设置操作中改写。
- 已用值实时从本月全部 IP 净购买和净消费查询；账本筛选不会传入预算查询。
- 已启用限度必须正数。比例用整数比较：`used * 100` 与 `limit * 75`、`limit * 100`；超额单独返回，不把超额值截成“100%”隐藏差额。
- 剩余额度不参与下个月计算，不产生结转记录。

## 7. 页面、组件与交互状态

### 7.1 路由与查询接口

| 路由／覆盖层 | 内容 | 数据入口 |
| --- | --- | --- |
| `/` | 我的小窝，个人背景与拥有 IP 的动态入口 | `getOwnedIPs()`、`getHomeAssets()` |
| `/ip/:ipId` | 两列系列叠卡 | `getOwnedSeries(ipId)` |
| 身份卡覆盖层 | 放大、翻面、小名／故事、再添一只、转出 | `getIdentityCard(styleId)`，DTO 不含金额 |
| 新增面板 | 默认最近系列、单选／多选、订单表单 | 图库查询＋draft reducer |
| 导入子面板 | 链接、名称、候选、预览 | import API；不丢弃外层订单草稿 |
| `/ledger` | 累计、周月年、图表、IP 筛选、额度、明细 | `getLedgerSummary()`、`getLedgerEntries()`、`getBudgetUsage()` |
| 账本详情覆盖层 | 编辑购买、退款／退货、删除误录 | `getAcquisitionDetail()` |
| `/settings` | 个人设置、素材、备份／恢复、安装指引 | preferences、backup service |

IdentityCard DTO 只提供名称、图片、小名、编号、数量、日期、来源和故事，从类型上减少误加金额的风险。账本缩略图没有身份卡点击回调。

同款多只的卡组元素按 styleId 去重。`getOwnedSeries` 过滤 heldQty>0 的款式和空系列；首页同理过滤空 IP。资料仍留图库／历史中。

### 7.2 新增面板状态机

```text
closed → browsing(single|multi)
browsing(single) → purchaseForm
browsing(multi) ↔ selectedSummary → purchaseForm
browsing → importing(link → name? → candidates → preview)
importing confirmed → browsing(新系列，保留全部已选)
purchaseForm → validating → saving → success → browsing(原上下文)
失败 → 留在当前表单，可修改／重试
```

单选点击款式展开表单；多选点击切换选中／取消，下一步统一表单。数量修改以草稿为准，未保存不增加任何收藏或账本数据。每次点击提交生成一次 commandId；重试复用 ID，用户开始另一笔才生成新 ID。

本机草稿自动保存，用于手机切后台恢复；再次进入时可继续或放弃。草稿不进统计、不进入完整业务备份，也不被当成已经拥有。

### 7.3 独立扇形卡组

- 两列 grid，卡片尺寸根据真实安全区与参考图调整，主要设备目标首屏约 4–6 个系列。
- 状态结构 `activeStyleIdBySeriesId`，不使用一个全局 activeIndex 控制所有系列。
- 同时最多挂载三张可见卡。n>3 时窗口可取 `start=clamp(activeIndex-1,0,n-3)`，取三项；n<=3 显示全部。
- 水平拖动采用 Pointer Events，`touch-action: pan-y`；达到水平阈值后认定滑动，抬手抑制卡片 click；垂直滚动不阻断。
- 提供可访问的前后切换操作；极少或单张时隐藏无效按钮，不显示虚假卡。
- 关闭身份卡不卸载收藏架底层状态；锁定背景滚动时记录 scrollTop，关闭后恢复焦点、滚动及当前 styleId。
- 新增／转出造成当前 styleId 消失时，选相邻仍拥有款式；不凭陈旧 index 越界。

### 7.4 账本与图表

统一 filter 对象 `{ period, anchor, ipId: 'all' | Id }`；总览、柱图、明细由同一过滤规范生成。累计卡片忽略 period，只应用 IP。预算忽略二者中的 IP，始终取当前自然月全部 IP。

图表指标切换金额／数量，柱子保留零值日期。点柱显示值，不筛明细。SVG 有标题、可聚焦柱与文本数值列表，不只靠颜色。账本订单按日期分组，同订单多款只记一笔；IP 筛选后的订单行标记“该 IP 小计”，详情可显示原订单总额但明确区分。

### 7.5 返回、键盘与金额边界

覆盖层使用对话框语义、焦点管理和明确关闭按钮；系统返回先关闭最上层面板再退路由。金额输入使用 decimal 输入模式，数量用数字输入，不允许键盘遮挡保存按钮。

首页、IP 收藏夹、身份卡无消费金额／额度；新增表单是输入例外，账本是消费查看和修改入口。导入预览可展示官方参考价，但不展示用户消费统计。

## 8. 公开资料导入服务

### 8.1 验证状态与默认范围

目前已通过网页读取看到星星人好好生活官方海外商品页的款式名称与图片，并非已验证任意手机端或 Node 抓取成功。小程序分享码未能直接解析；人民币单价、中文别名、更多系列和动画需要开发阶段验证。

参考真实页面：[Twinkle Twinkle Live the Ordinary Series Figures](https://www.popmart.com/ca/products/9120/twinkle-twinkle-live-the-ordinary-series-figures)。不要把同主题手办与 POP BEAN 或挂件混成同系列 ID。

首版采用“已核验公开目录索引＋公开商品页适配器”实现名称匹配；不引入 LLM 猜测商品信息，也不要求付费搜索 API。目录索引由开发 agent 从可访问的官方 IP／商品列表、站点公开资料建立，附中文别名映射及来源。

目录范围是有限的。上线至少验证用户关注的星星人、CRYBABY、NYOTA，优先好好生活、怦然星动等实际使用系列。找不到条目时明确返回 no_match，不声称支持官网全部系列。新增有效链接解析成功后可扩充公开目录，不包含用户是否拥有的信息。手动维护公开目录是开发任务，不是新增用户手工建款功能。

### 8.2 provider 适配接口

```ts
interface CatalogProvider {
  classify(input: string): 'web_url' | 'miniapp_text' | 'invalid';
  resolvePublicUrl(url: URL): Promise<SeriesCandidate[]>;
  searchVerifiedCatalog(query: string): Promise<SeriesCandidate[]>;
  readSeries(candidate: SeriesCandidate): Promise<SeriesPreview>;
}
```

- 网页链接：正规化 host/path，移除无关追踪参数，保留确有业务意义的参数；识别地区与产品品类。
- 小程序文本：不把 `#小程序://...` 作为普通 HTTP URL fetch。没有已验证解码路径时返回 `needs_name`，不能由 token 猜系列。
- 名称：Unicode NFKC、大小写、空格与标点规范化；优先精确别名，其次前缀／包含匹配；低匹配候选必须用户选择。
- 读取顺序：公开结构化商品数据 → 页面可读数据／结构化脚本 → 稳定 DOM 选择器。所有方案在样本中验证，不能通过字符串拼接发明官方 API 路径。
- 若静态请求不可读，浏览器渲染适配仅在验证必要时加入，不默认引入常驻浏览器服务；遇到登录、验证码或访问拒绝不绕过，给明确错误及名称路径。
- parser 输出普通数据，不把上游 HTML 插入页面或作为可执行脚本加载。

### 8.3 接口契约

| 本应用接口 | 输入 | 返回／行为 |
| --- | --- | --- |
| `POST /api/import/resolve` | `{input: string}`，长度受限 | `needs_name` 或候选列表；不落本机收藏 |
| `POST /api/import/search` | `{query: string}` | 官方目录候选、匹配原因和来源；不记录搜索历史到服务器 |
| `POST /api/import/preview` | `{candidateId: string}` | 标准化系列、款式、系列级参考价、当地币种参考价及待确认项 |
| `GET /api/import/media/:assetToken` | 服务端签发 token，可选 Range | 只代理已验证白名单媒体；支持读取字节保存 Blob |
| `GET /api/health` | 无 | 服务状态，不返回秘密或个人数据 |

```ts
type SourcePrice = {
  amountMinor: number;
  currency: string;
  basis: 'single' | 'case' | 'unknown';
  region: string;
  sourceUrl: string;
};
type SeriesPreview = {
  previewVersion: 2;
  candidateId: string;
  canonicalKey: string;
  ip: { canonicalKey: string; name: string; aliases: string[] };
  name: string;
  productKind: string;
  region: string;
  sourceUrl: string;
  fetchedAt: string;
  parserVersion: string;
  seriesReferenceUnitCents: number | null;
  priceProvenance: 'user_confirmed' | 'catalog' | 'from_history' | null;
  foreignReference: SourcePrice | null;
  styles: Array<{
    canonicalKey: string;
    name: string;
    isSecret: boolean | null;
    image: { sourceUrl: string; assetToken: string } | null;
    referenceUnitCents: number | null;
    sourcePrice: SourcePrice | null;
  }>;
  warnings: string[];
};
```

候选 ID 由服务端映射到已验证目录，不让浏览器直接指定任意内网地址。价格 provenance 存来源／地区／单盒或整盒；`foreignReference` 只放当地币种原价供展示。人民币单盒参考价为空时，由用户在预览补填一次（系列级），写入 `seriesReferenceUnitCents` 并标记 `priceProvenance = user_confirmed`，不得伪装为抓取到的官方价。同 SPU 出现疑似整盒 SKU 时，`warnings` 必须包含 `PRICE_UNVERIFIED`。

签名媒体 token 只用于本次传输，不当作永久素材地址。下载重试时若 token 过期，通过相应来源的 preview 重新取得 token；本机保留 canonical 来源及已保存字节，不把重试变成重新新增图库。

### 8.4 确认与本机提交

1. 用户预览确认候选、款式与品类。
2. 价格确认（可与预览同屏）：展示当地币种参考价并标注币种／地区（仅展示，不换算），同时提供“该系列单盒人民币价”输入。可跳过；跳过则该系列暂无参考价，交由首次购买时内联补填。确认后写 `series.defaultUnitCents` 与 `priceProvenance`。
3. 客户端开始媒体下载，成功字节 hash 后进入本机 Blob 存储；失败项标记缺失并可重试。
4. 短事务 upsert 图库、来源与素材引用，不创建订单或 collectionProfile。
5. 返回新增面板新系列，保留之前所有已选款式和数量。
6. 图片尚未缓存时显示可识别名称及占位；不得标记离线素材完整。下载是单独可重试任务，不使已导入结构数据丢失。

重复导入先计算差异，展示可更新图片／价格／新增款式；默认不删除缺失于新响应的旧款式，不改 ID，不覆盖个人内容、历史权重或实付。价格更新只写参考价与 `priceUpdatedAt`，供后续新增使用，不重算历史。跨地区名称相似但无法确认相同的，保持独立候选，不静默合并。

### 8.5 安全、隐私与资源约束

- 服务端只允许明确核验的官方 host 和 CDN host；逐跳验证 redirect、协议、DNS 目标，拒绝内网、loopback、link-local 等地址；不能做任意 URL 开放代理。
- assetToken 为有期限、可验签的媒体资源描述或服务端 ID，不能把前端传来的 URL 直接当已可信。
- 校验响应 MIME、实际类型、最大字节数、超时及重定向次数；不是图片／视频的 HTML 错误页不得以图片缓存。
- 初始工程限额：单页响应 5 MiB、单图片 10 MiB、单视频 30 MiB、页面请求 15 秒；媒体并发 2。可根据实机验证调整并记录，不是用户购买数量限制。
- API 日志只记请求 ID、provider、状态、耗时和错误类别，不记原始请求体、完整查询参数；不启用个人分析 SDK。
- 参数 schema 拒绝订单金额、备注、个人图片等额外字段；不设置个人数据上传接口。
- Rate limit、防超时、缓存公开解析结果。凭证仅留服务端；浏览器包里的变量不是秘密。
- 接口校验使用静态定义的 schema，不用上游内容生成可执行 schema。[Fastify 校验文档](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

### 8.6 错误码和降级

| 错误码 | 页面处理 |
| --- | --- |
| `MINIAPP_UNRESOLVED` | 转名称输入，保留原文本 |
| `NO_MATCH` | 修改名称或稍后重试；保留已选 |
| `AMBIGUOUS_MATCH` | 展示候选，让用户辨别品类与地区 |
| `SOURCE_UNAVAILABLE` / `SOURCE_CHANGED` | 说明暂时无法读取，不使用虚构数据填满 |
| `PRICE_UNVERIFIED` | 补填／确认人民币单盒价 |
| `MEDIA_UNAVAILABLE` | 图库条目可保留，图片占位，提供重试 |
| `OFFLINE` | 已有图库仍可新增，本次联网导入暂停 |
| `UNSUPPORTED_SOURCE` | 说明只支持当前已验证的官方公开来源 |

## 9. 图片、视频与首页轮换

### 9.1 个人素材不随公开部署泄露

个人形象和参考图不能直接放进公开 `public/` 或公开 Git 仓库。开发可在本地引用附件预览；正式 PWA 由用户在设置中从本机选取个人图片／视频，写入 IndexedDB，操作不会上传服务器。参考图是设计资料，不需要作为 app 运行资源保存。

如果部署到公开地址，通用 app 图标使用不含个人照片的标识。已公开的官方 IP 资源与私人个人素材明确区分。此设置入口是配置首页素材，不是恢复被取消的拍照盲盒录入。

### 9.2 Blob 与播放

- 下载字节保存为 Blob，metadata 用 hash 指向；渲染时 `URL.createObjectURL(blob)`，离开后释放，不把 Blob URL 持久化。
- personal image／video 与海报分别存引用；新素材成功验证并保存后才切换，失败保留原素材。
- 视频优先验证常见 MP4/H.264 路径；实际用 `canPlayType`／解码结果判断，不宣称所有来源视频都支持。无透明视频也可设计背景。
- 使用 `muted`、`playsInline`、`loop`，处理 `play()` reject；静态封面始终可用。页面不可见或元素离屏时暂停，减少动态效果时停用非必要动画。[WebKit 视频政策](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- 页面动效以 transform/opacity 为主，不在动画帧里读写数据库。
- 首页个人背景不拦截 IP 点击，纯背景 `pointer-events:none`；IP 入口是真正 button／link，文字标签始终清晰。

### 9.3 IP 轮换算法

1. 启动时查询当前仍拥有的 IP。
2. 每个 IP 的素材池仅取该 IP 已保存可用的官方形象／动画，以及已拥有款式的图片；相同字节去重。
3. 若素材多于一份，剔除上次 assetId 后随机选一个；一份则复用；无素材用 IP 名称占位。
4. 选择写入本会话内存和上次素材偏好；同一会话切页、返回首页、短暂后台恢复不重抽。
5. 页面重新初始化才是新会话；不依赖系统“打开次数”API。iOS 只是恢复原页面时不强求变化。
6. 素材失效则从同 IP 其他本地可用项回退；不改变 IP 顺序和目标路由。

视频池不足不联网生成动画；静态图片配轻动效是已确认兜底。动画与身份卡、款式持有是不同层级。

## 10. PWA、离线与更新

### 10.1 安装和应用外壳

Manifest 配置固定 `id`、`start_url`、`scope`、`display: standalone`、应用名称和必要图标；正式运行使用 HTTPS。提供 Safari“分享→添加到主屏幕”的可关闭引导；其他浏览器不强行假设同样安装入口。

使用 `env(safe-area-inset-*)`，处理底部导航、弹层、虚拟键盘；以 CSS 视口尺寸响应式布局，不硬编码设备物理像素。

### 10.2 缓存策略

| 类型 | 策略 |
| --- | --- |
| 构建后的带 hash JS/CSS／通用资源 | Workbox precache |
| 页面导航 | app shell fallback，仅应用路由 |
| 导入 API | NetworkOnly；失败进入显式离线状态 |
| 官方媒体 | 应用下载队列写入 IndexedDB，不依赖 opaque cache |
| 个人数据 | 仅 IndexedDB，Service Worker 不上传或同步 |

`/api/*` 不允许被 SPA fallback 改写成 HTML 200；缺失图片／脚本也不能回退 index.html。媒体不重复无界缓存到 Cache Storage 和 IndexedDB 两份。

### 10.3 更新与迁移

采用提示更新，不自动刷新正在录入、导入或恢复的页面。保存草稿后用户选择更新；新代码就绪才刷新。不要在 activate 阶段删除任何 IndexedDB 数据。[Vite PWA 更新说明](https://vite-pwa-org.netlify.app/guide/prompt-for-update)

- 数据库 schema 版本、备份格式版本、app build 版本分别管理。
- 迁移逻辑只进行确定性本地变换；需要远程补图的工作放迁移后任务，不阻塞数据库升级。
- `versionchange` 时其他标签关闭 DB 连接并提示刷新，避免升级卡住。
- 迁移失败显示可恢复错误，保留旧数据，不调用 deleteDatabase 作为修复捷径。
- 发布前用上一版本真实格式样本验证迁移；破坏性变化先提供导出机会。

## 11. 完整备份与原子恢复

### 11.1 文件格式

```text
my-popmart-backup-YYYYMMDD-HHmm.zip
  manifest.json
  data/ips.json
  data/series.json
  data/styles.json
  data/...所有已提交业务表.json
  media/<sha256>.<ext>
```

manifest 包含：formatName、backupFormatVersion、dataSchemaVersion、appVersion、exportedAt、sourceDatasetId、表记录数、每个文件路径／字节数／SHA-256、mediaComplete、缺失素材列表。备份不带草稿、页面拖动状态、Service Worker 文件、数据库维护锁或运行中任务。

资产引用在导出文件中用稳定 ID 和 hash；恢复重新分配 datasetId，业务 ID 保持一致。不能把运行时 Blob URL 或签名过期的媒体 token 当作备份素材。

备份 ZIP 默认不加密，必须在导出说明其含个人资料；文件由用户自己保存，不上传。ZIP 流式处理可用 fflate，图片视频使用存储或低压缩，避免在主线程整包阻塞。[fflate 官方仓库](https://github.com/101arrowz/fflate)

### 11.2 导出一致性

- 在覆盖全部相关表的同一 readonly 事务中获取结构化记录与 Blob 引用，形成某一 revision 的快照；事务中不做 ZIP 压缩。
- 之后在 Worker 中读取这些不可变 Blob，校验并逐文件打包。导出时仍允许其他写入，新修改不属于该次快照，界面显示快照时间。
- 缺图时列出缺项与重试，不宣称“完整”。可提供明确标注为不完整的备份以抢救数据，但必须用户知晓，并在 manifest 记录；完整验收使用 mediaComplete=true。
- 下载／分享保存使用设备实际支持的能力检测，优先系统分享文件，提供普通 Blob 下载兜底；不依赖 iPhone 一定支持桌面 File System Access API。
- 浏览器无法保证用户最终保存在何处，状态应区分“已生成”“已交给系统保存”，不假装知道文件已永久落盘。

### 11.3 恢复状态机

```text
选择文件 → 校验容器／schema／hash／引用／业务不变量
→ 展示日期、计数、媒体完整性 → 用户确认替换
→ 进入维护模式 → 写新 staging dataset（分批）
→ 全量复算和验证 → 原子切 activeDatasetId
→ 重新加载查询 → 旧数据集稍后清理
```

具体约束：

1. 不信任 ZIP 内路径，禁止 `../`、绝对路径、重复路径；只处理允许的 JSON 与媒体，不执行脚本。
2. 校验总解压大小、文件数、压缩比、文件 hash、schema；高于支持版本拒绝，不静默丢字段。
3. 校验引用、非负库存、订单分摊、退款上限、礼物金额、唯一编号和预算值；重算派生数据，不信任备份里可能附带的统计缓存。
4. 确认前不改 active 数据集。确认后通过 appMeta 维护标记阻止所有标签的业务写入；所有命令事务都检查该标记。维护具有 ownerTabId、带期限租约和 fencingEpoch；写 staging 的每个批次以及最终切换均在事务内验证持有同一操作与 epoch，并续约。
5. 新数据分批写 staging，界面可展示进度。空间不足或任何失败时旧数据仍 active，解除维护并清理 staging。
6. 验证完成后在一个短事务中设置 staging=active、old=retired 和 activeDatasetId，递增 revision。此步骤是唯一可见切换点。
7. 进程中断后启动检查 staging 和 maintenance：租约仍有效时显示已有恢复任务，不从另一标签擅自清理。租约过期后可在事务中提升 epoch、取消旧任务；切换前保持旧数据并清理 staging，切换后使用新数据。旧页面若随后恢复执行，会因 epoch 不符而停止，不能再写入或切换。不能在异常恢复中自动清空全部数据库。
8. 旧 dataset 延迟清理；若清理失败，不影响新数据正确性。需要暂时容纳新旧两份存储，提前估算空间，不为省空间先删旧记录。
9. 恢复后关闭旧覆盖层、丢弃旧草稿，使用恢复后的计数器和偏好；所有旧页的 stale dataset 写入必须失败。

### 11.4 大文件与工程限额

先以 10,000 条购买明细、1,000 款、150 MiB 实际备份作为验证负载，不把它们当用户业务上限。恢复前检测大小和剩余空间；若实机达不到目标，应优化或明确报告测试限制，不能静默截断。

Web Worker、分块 ZIP 降低阻塞，但最终 Blob 下载仍可能占用较多内存；必须在真实 iPhone 上验证。单素材过大时先提示优化或替换，不擅自删除原个人素材。

## 12. 本机安全与隐私

- 个人资产、账本和备份不提交到公开仓库，不打进公开部署包，不发送到日志／统计 SDK。
- 本机数据库不等于应用级加密保险库；首版没有额外口令或云登录，依赖设备及浏览器环境，不虚构安全保证。
- 把远程商品名、备注、别名当纯文本；不使用 `dangerouslySetInnerHTML` 渲染未经清理内容。
- CSP 限制脚本来源，允许必要 blob 媒体；不从上游页面执行脚本。不因导入方便而全面关闭安全限制。
- ZIP、素材文件、接口响应均作不可信输入校验；错误输出不暴露完整本机数据。
- 服务端公开资源缓存可重建，绝不能包含个人附件。HTTPS、公开导入限流和访问日志最小化是部署职责，不是增加用户账号系统。

## 13. 错误处理与可观察性

统一 `AppError { code, userMessage, retryable, fieldErrors?, debugId? }`。开发日志可记录经过脱敏的错误栈；生产不输出订单内容。

| 情况 | 必须行为 |
| --- | --- |
| 存储配额不足 | 事务回滚，保留草稿，提示导出备份／检查空间，不自动删除收藏 |
| 重复 commandId | 相同 payload 返回原结果；不同 payload 拒绝 |
| revision 冲突 | 保留草稿，提示记录已变化并重新加载 |
| 数据维护中 | 暂停写入，显示恢复进度；读旧有效数据可继续 |
| 媒体失败 | 名称占位／静态封面，业务不崩溃 |
| 动画不能自动播放 | 保持静态，不全屏强播或播放声音 |
| 导入失效 | 明确错误，保留选择，不写入虚构系列 |
| 迁移失败 | 停止写操作并保留数据，提供可执行恢复路径 |

开发诊断页面仅显示 app/schema 版本、记录计数、缓存状态、最近导入错误码和存储估算，不在正常产品界面暴露技术细节。

## 14. 性能与移动端实施目标

- 页面不等待所有 IP 视频加载再显示可点击入口；先静态后动态。
- 同屏同时解码的视频默认上限 3（含个人背景），其余入口用静态轻动效；在目标设备测量后可调整，不影响入口数量。
- 查询只加载结构化记录；图片 Blob 按可见内容取用。账本长列表分段加载，系列卡组只渲染可见窗口。
- 预算、筛选和金额计算优先使用纯函数 memo；不要在每个动画帧重算全账本。
- 目标：普通新增本机事务及 UI 反馈在 500ms 内；本机统计 10,000 行时在 300ms 内或提供明确非阻塞进度；拖动不出现持续长任务。均需实测，不是现成保证。
- 触控目标约 44 CSS px，支持 320 CSS px 窄屏；首屏 4–6 系列以 iPhone 15 Pro Max 可用视口验收。
- 业务样式 token 与视觉主题分离，依据用户参考图生成色板和字重；状态色同时有文案，减少动态效果仍可完整操作。

## 15. 测试设计与具体样例

### 15.1 纯函数与属性测试

- 金额解析、分摊最大余数法、稳定平局、手动分配不一致拒绝。
- 参考价解析 `style → series → null`、款式覆盖、缺失时不预填、来源字段不被二手实付覆盖。
- 日期精度、周一跨年周、闰年日期、月级记录不进入日柱。
- 库存与消费：退款不减件数、退货减件数、送出不减历史购买、礼物不计消费。
- 阈值恰好 75%、100%、超限、关闭维度、首月无额度、余额不结转。
- 随机合法订单验证 sum allocations=total、sum refund allocations=refund、无负值。

### 15.2 固定业务验收样例

| 编号 | 输入／操作 | 预期 |
| --- | --- | --- |
| T01 | A 官方 ¥69×2，B 官方 ¥138×1，实付 ¥240 | 分摊 A ¥120、B ¥120；购买 3 个 |
| T02 | 三款相同权重，实付 ¥0.01 | 稳定第一款 1 分，其余 0；合计 1 分 |
| T03 | T01 的 A 所在订单上月购买，本月 A 退差价 ¥20 | A 净 ¥100、订单净 ¥220，上月修正，本月不记收入；数量仍 3 |
| T04 | 接 T03，A 再退货 1 个，实际退 ¥50 | A 持有 1、净实付 ¥50；订单净 ¥170，净购买数量 2 |
| T05 | 接 T04，将剩余 A 送出 | A 持有 0、收藏架隐藏；历史净购买数量仍 2，订单净 ¥170 |
| T06 | 收到礼物 C×1 | 收藏+1，净购买+0，消费+0，无待补金额 |
| T07 | 仅月份购买 ¥69×1 | 月／年／累计有值，周／日无值，月级小计显示 |
| T08 | 日期不详购买 ¥59×1 | 仅累计有值，月份与预算不增加 |
| T09 | 订单两 IP，筛 A | 显示 A 对应净分摊，不显示整单金额作 A 小计 |
| T10 | 月上限 ¥300／4 个，用 ¥100／1 个后跨月 | 下月仍 ¥300／4 个，不是 ¥500／7 个 |
| T11 | 同 commandId 提交两次 | 一笔订单、一组明细、一次持有增加 |
| T12 | 同款多批次及混合来源转出后删一笔误录 | 仅撤销该订单及其变动分配，不破坏其他批次 |
| T13 | 系列参考价 ¥69，款式 A 无单独价，录入 A×2 | 默认实付 ¥138；`referenceUnitCentsSnapshot` = 6900 |
| T14 | 系列无参考价，补录 A×1 | 表单不预填金额；现场填 ¥69 保存后 `series.defaultUnitCents`=6900、`priceProvenance`=user_confirmed；下次 A×1 默认 ¥69 |
| T15 | 同 SPU 两 SKU 价 2699 与 32388（×12） | 取 2699 作单盒候选，`warnings` 含 `PRICE_UNVERIFIED`；不得写入 32388 |
| T16 | 系列参考价 ¥69 改为 ¥79 后 | 历史订单分摊与净额不变；新订单默认 ¥79 |
| T17 | 二手购入实付 ¥50 | 该笔记 ¥50；系列参考价仍为 ¥69，不被回写 |

### 15.3 数据库与备份集成测试

- 命令写入一半抛错，所有表均回滚。
- 并发标签保存同一订单，revision 冲突正确，不覆盖。
- 带礼物／退款／转出的完整备份 round-trip：业务 ID、数量、净金额、月份、媒体 hash 相同。
- ZIP 错误 hash、重复文件、路径穿越、超限、未来 schema、缺外键均拒绝，旧数据不变。
- 恢复在 staging、验证完成前、指针切换后各处模拟中断，启动恢复状态正确。
- 数据迁移用前一版真实 schema fixture；无版本跳跃丢数据。

### 15.4 页面端到端

覆盖 PRD AC01–AC44，重点包括：连续导入保留已选／取消、两系列独立滑动、身份卡关闭恢复位置、身份卡无金额、账本无卡片入口、首页无额度、图表与 IP 筛选一致、金额模式切换、超额仍能保存。

自动测试用 Chromium 和 WebKit；Playwright 可模拟视口和触控等参数，但设备模拟不等于真实 iOS 安装／系统行为。[Playwright 设备模拟文档](https://playwright.dev/docs/emulation)

### 15.5 实机验收不可省略

- Safari 与主屏幕安装、关闭重开、后台恢复、离线冷启动。
- 键盘、底部安全区、模态滚动锁、水平滑动与竖向滚动冲突。
- 静音视频播放失败兜底、减少动态效果、多个 IP 轮换与旧会话稳定。
- iOS 文件选择、ZIP 导出到文件、恢复成功与损坏文件不覆盖。
- 真实官方系列导入及媒体字节保存；断网后能看到已保存素材。
- 部署更新后旧数据仍在，不强刷正在填写的订单。

## 16. 部署与运行交付

默认提供单个 Node 服务部署产物：`/` 提供 Vite build，`/api/import/*` 为公开资料辅助接口，托管平台提供 HTTPS。可部署到支持 Node／容器的环境，本文不绑定某个需要用户付费的云厂商。

开发用 Vite proxy 转发到本机 import server；正式使用同源地址。不得要求用户在 iPhone 上填写 localhost 地址或始终开着开发电脑才能记账。核心离线功能不依赖服务在线，导入服务停机时如实降级。

交付需要包含：

- `.env.example`：PORT、公开目录路径、允许来源 host、超时与限流；若使用签名 token，密钥仅服务器保存。
- 启动、构建、测试、部署、公共目录更新命令及 lockfile。
- 健康检查和部署平台适配说明；静态文件长缓存按 hash，入口 HTML／Service Worker 采用可更新策略。
- 不存在 `VITE_*` 个人数据上传地址、分析 token 或隐藏云数据库。
- 正式域名稳定；迁移域名前先备份，并说明新地址本机数据不自动出现。
- 无个人附件的公开构建与本机个人素材配置说明。

当前任务只交付技术文档，不创建服务器、购买域名、部署网站或上传任何个人素材。实际发布地址与平台凭据属于部署时外部输入，不是需要用户重新确认的产品规则。

## 17. 开发顺序与阶段完成门槛

| 阶段 | 工作 | 必须提交的证据 |
| --- | --- | --- |
| P0 技术验证 | 官方页面／名称索引／媒体下载；iOS IDB Blob、备份文件、SW 离线基础 | `import-feasibility.md`，真实样本、成功／失败与支持范围 |
| P1 数据核心 | schema、命令、金额／日期、库存、退款、预算、备份恢复 | 纯函数和事务测试，恢复中断不丢数据 |
| P2 主链路 | 导入→选款→购买→收藏与账本→重开保留 | 真实系列录入验收，不用 mock 冒充生产 |
| P3 收藏与账本 | 独立叠卡、身份卡、筛选／图表、变动处理 | AC 对照，金额与交互边界截图 |
| P4 个性视觉 | 用户参考图、个人背景、IP 轮换及动画兜底 | iPhone 首屏密度与动效演示 |
| P5 交付 | 离线、更新、备份、部署说明、实机验证 | 最终验收报告、已知限制、可运行产物 |

P0 发现公开来源不可读取时，先修正导入适配／目录覆盖并记录限制；可以同时推进本机核心，但不能在最终报告里把导入标为已完成。不能用接入未经用户同意的个人云存储替代本机技术问题。

完成定义：全部确认功能和 PRD AC01–AC44 验收项均已验证，或对不可控制的外部失败明确列出证据与影响；不存在以 mock 数据代替真实导入、以浏览器刷新后丢失数据的演示代替本机持久化、以截图代替可交互页面的情况。

## 18. 已知外部依赖与验证记录格式

| 项目 | 本文已知情况 | 开发时必须验证 |
| --- | --- | --- |
| 小程序分享码 | 未有已验证直接解码路径 | 默认 needs_name；如新增解析能力提供测试证据 |
| 官方网页款式图 | 参考页面可读到名称和图片链接 | Node 实际抓取、图片字节、中文名称映射 |
| 中国大陆单盒价格 | 已实测：官方海外页 `spuPriceInfo` 恒为 0；商品详情接口需签名；大陆官网无商品商城 | 人民币单盒价只能由用户确认、人工目录或历史推断；海外币种价仅展示不换算 |
| 各 IP 官方动画 | 不保证全部存在 | 来源、可播放性、适合入口；否则静态轻动效 |
| 名称目录覆盖 | 需要从官方公开资料建立 | 已支持系列清单和别名来源，目录外 no_match |
| iOS 存储、下载与安装 | 平台有政策及能力差异 | 用户当前系统版本实测，不只用桌面模拟 |
| 个人形象与参考图 | 用户将随文档提供 | 本机使用、不公开上传、视觉与引用一致 |

每个真实导入样本记录：测试日期、输入类型、源 URL／地区、parserVersion、候选与品类、款式数量、图片成功数、价格来源、失败状态。不要把用户真实账本作为调试附件提交。

## 19. 给开发 agent 的执行摘要

1. 以 PRD v2.2 的已确认规则为准，不重复问已定产品问题。
2. 用本文件默认栈建本机 PWA；个人数据与素材不上传。
3. 先验证真实导入与本机恢复，再铺页面和视觉。
4. 订单／明细是唯一购买事实，库存与统计派生，所有写入原子化。
5. 官方价不是历史实付；日期精度不能伪造；礼物、退款和转出不能混算。
6. 首页 IP 入口、系列叠卡、身份卡是三级归属，不混用动效和详情。
7. 原图＋用户视觉参考决定主题；缺视频用既定轻动效方案，不阻塞功能。
8. 给出可运行代码、锁定依赖、真实导入支持清单、测试与实机结果、部署／备份说明；不要声称未做的验证已完成。
