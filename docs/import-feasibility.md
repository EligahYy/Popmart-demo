# 导入数据源可行性验证记录（P0）

- 验证日期：2026-10-30
- 验证方式：本机直接发起 HTTP 请求（curl / Python），Node 与浏览器同源场景分开判断
- 对应文档：《技术设计与开发实施文档》v1.1 §8、§17 P0、§18
- 结论：**款式图库（名称／图片／隐藏款标记）可行且已验证；官方人民币单盒价不可自动获取；小程序分享码不可解析。**

## 1. 现有方案的数据源定义

技术文档 §8 的方案是三层：

1. 用户输入官方商品／系列链接（或小程序分享文本）；
2. 同源 Node 导入服务读取 POP MART **公开网页**，解析系列、款式、图片、价格；
3. 失败时用「已核验公开目录索引 + 中文别名」做系列名称匹配。

即：**不依赖官方 API、不依赖小程序接口、不引入 LLM 猜测**，数据来自公开 HTML 及其内嵌结构化数据。

## 2. 实测记录

### 2.1 环境与方法

| 项目 | 值 |
| --- | --- |
| 站点 | `https://www.popmart.com`（区域前缀 `/ca`、`/us`） |
| 请求方式 | 纯 HTTP GET，无 Cookie、无登录、无签名 |
| User-Agent | 普通桌面 Chrome UA |
| 样本 | 5 个官方商品页 + 2 个 sitemap + 1 个 collection 接口 |

### 2.2 页面可读性

| 编号 | 商品 | URL | HTTP | 字节 |
| --- | --- | --- | --- | --- |
| S1 | Twinkle Twinkle Live the Ordinary Series Figures | `/ca/products/9120/...` | 200 | 457,097 |
| S2 | CRYBABY Crying For Love Series Figures | `/ca/products/3114` | 200 | 462,551 |
| S3 | Nyota Growing up by Your Way Series Figures | `/ca/products/3392` | 200 | 405,899 |
| S4 | CRYBABY Wild but Cutie Series - Vinyl Plush Pendant | `/ca/products/3036` | 200 | 454,206 |
| S5 | Twinkle Twinkle Live the Ordinary Series - Pillow | `/ca/products/9125` | 200 | 446,494 |

无验证码、无登录墙、无地区封禁（中国大陆 IP 可访问 `/ca` 路径）。

### 2.3 结构化数据位置

页面是 Next.js 应用，数据内嵌在：

```
<script id="__NEXT_DATA__" type="application/json"> ... </script>
  props.pageProps.serverSeoData.commonInfo
```

一次请求即可拿到全部所需字段（无需二次调用）：

| 字段 | 内容 | 样本实测 |
| --- | --- | --- |
| `commonInfo.title` | 系列名称（英文） | `Twinkle Twinkle Live the Ordinary Series Figures` |
| `commonInfo.ipDesignerInfo.brandName` / `brandID` | IP 名称与稳定 ID | `Twinkle Twinkle` / 63；`CRYBABY`；`Nyota` |
| `commonInfo.toys[]` | **款式图库**：`{name, type, url}` | 9120：13 条（12 常规 + 1 隐藏） |
| `commonInfo.banners[]` | 系列官方图（可用于素材池） | 9120：8 张 |
| `commonInfo.desc` | 商品说明 | 含发售时间、尺寸、材质 |
| `commonInfo.spuPriceInfo` | **价格** | 恒为 `{price: 0, currency: ""}` |

`toys[].type` 语义：`1` = 常规款，`2` = 隐藏款（名称同时带 `(Secret)` / `（Secret）`）。

实测款式数量与 PRD §4.6 记载一致：

| 商品 | IP | 款式数 | 隐藏款 |
| --- | --- | --- | --- |
| 9120 Twinkle Twinkle Live the Ordinary | Twinkle Twinkle | 13（12+1） | `Joyride（Secret）` |
| 3114 CRYBABY Crying For Love | CRYBABY | 14 | `Sparkling Love (Secret)` |
| 3392 Nyota Growing up by Your Way | Nyota | 13 | 有 |
| 3036 CRYBABY Vinyl Plush Pendant | CRYBABY | 7 | `Wild Cutie(Secret)` |
| 9125 Pillow（非手办） | Twinkle Twinkle | **0** | — |

### 2.4 JSON 数据端点（可减少解析成本）

```
GET /_next/data/<buildId>/<locale>/products/<spuId>.json
```

- 实测：`/_next/data/20261028172527/ca/products/9120.json` → 200，347,172 B，`application/json`，结构与 `__NEXT_DATA__` 相同。
- `buildId` 每次部署变化（样本为 `20261028172527`）；用旧值请求返回 404，必须先从任一页面 HTML 提取。
- 该端点同样没有 CORS 头，仍需服务端代理。

### 2.5 目录索引

| 资源 | 实测 |
| --- | --- |
| `/ca/sitemap-products.xml` | 200，1,002 条商品 URL |
| `/ca/sitemap-collections.xml` | 200，427 条系列集合 URL |
| `/_next/data/<buildId>/ca/collection/<id>.json` | 200，含该集合商品列表与 SKU |

collection JSON 的每个商品带 `skus[]`，含 `price`、`discountPrice`、`currency`、`stock`、`isSkuSoldOut`。这是**唯一可公开拿到价格的入口**。

### 2.6 图片与媒体

| 项目 | 结果 |
| --- | --- |
| CDN | `prod-global-biz.popmart.com`、`global-static.popmart.com`、`prod-america-res.popmart.com` |
| CORS | `access-control-allow-origin: *`（实测两个 host） |
| 格式 | JPG / PNG；可加 `?x-oss-process=image/resize,w_1600/quality,q_90/format,webp` |
| 体积 | 单款约 60–130 KB（w_1600 webp 64 KB；原图 PNG 111 KB） |
| Node 直接下载 | 成功，字节完整 |

### 2.7 价格可得性（关键失败项）

| 尝试 | 结果 |
| --- | --- |
| 商品页 `__NEXT_DATA__.spuPriceInfo` | `{price: 0, currency: ""}`，5 个样本全部为 0 |
| 商品页渲染价 | 客户端异步请求，SSR 无价格 |
| `https://prod-na-api.popmart.com/shop/v4/shop/productDetail/info?spuId=9120` | HTTP 200，`{"code":"4001","message":"Authentication signature error"}` |
| `https://www.popmart.com/shop/...` | 301 → `www.popmart.com.cn`（中国大陆公司站） |
| 中国大陆站 `www.popmart.com.cn` | 公司／投资者站（Vue SPA），无商品与 CNY 售价 |
| 首页 `/cn` | 301 → `www.popmart.com.cn/cn`，非商城 |

结论：**官方公开网页不提供人民币单盒价**；海外站的价格字段为当地币种（样本为 CAD），且商品详情接口需签名。

### 2.8 collection 价格数据的整盒陷阱

样本 9120 的两个 SKU：

| SKU | price | currency | wholeSetCount |
| --- | --- | --- | --- |
| 12168 | 2,699 | CAD | 0 |
| 12169 | 32,388 | CAD | 0 |

`32,388 = 2,699 × 12`，即整盒价。但 `wholeSetAvailable` / `wholeSetCount` 均为 false/0，**无法用字段直接区分单盒与整盒**。若直接取第一个 SKU 尚可，取最高价或"集合价"就会错。

### 2.9 限流与反爬

- 连续 8 次 JSON 请求：全部 200，单次耗时 1.7–2.9 s。
- 未触发验证码或封禁。
- 站点接入同盾指纹（`usfp.tongdun.net`），存在风控，规模化抓取不保证不被限。
- `robots.txt`：`Allow: /`，但 `Disallow: /search?`、`/*?sort=`、`/*?filter=`、`/*?page=`、`/backend/` 等。

### 2.10 社交媒体价格来源（2026-11-12 补充实测）

设想的来源：新品发布后博主拆盒测评会标注单盒价，从小红书等平台抓取。

| 平台 | 无登录、纯 HTTP 实测 | 结论 |
| --- | --- | --- |
| 小红书 `/search_result` | 301 重定向；`/explore` 302 登录墙 | 不可匿名访问 |
| 小红书笔记页 | 需登录 + 请求签名（x-s/x-t），图片带水印 | 不可稳定抓取 |
| 微博 `s.weibo.com` | 302 登录 | 不可匿名访问 |
| B 站搜索 API | HTTP 200，但返回 `aba.bilibili.com` 风控错误页 | 被风控拦截 |
| 抖音搜索 | HTTP 200，72 KB JS 壳，无内容 | 客户端渲染 + 风控 |
| 百度 | 首次 200/1 MB 有结果；第 3 次起跳 `wappass` 图形验证码 | 可偶尔读到，不可稳定运行 |
| 搜狗 | 302 反爬 | 不可用 |
| 京东／天猫 搜索 | 302 | 需登录 |
| 天猫／京东 旗舰店首页 | 200，但商品与价格走签名接口 | 不能直接取价 |

**数据质量层面的问题（比访问更难解决）：**

1. 博主标注的常是**整盒／端盒价**（如 ¥828/盒），不是单盒价；也有隐藏款溢价、二手价、海外购价。
2. 同一主题存在手办、POP BEAN、挂件等不同品类，价格不同，UGC 文本无法可靠区分。
3. 测评发布于发售前后，价格可能过时；无法核验"官方建议零售价"。
4. 无法提供 PRD 要求的 provenance（来源、地区、抓取时间、单盒依据）。
5. 平台用户协议普遍禁止未经许可的自动化采集，个人项目也有账号与合规风险。

**结论：社交媒体不适合作为自动价格源。** 即便技术上打开一个口子，得到的也是不可核验的 UGC 数值，会把"官方价"和"博主说法"混为一谈，正好违反 PRD §4.5 与 §11 的价格口径。

## 3. 分层可行性评估

| 能力 | 可行性 | 依据 | 对方案的影响 |
| --- | --- | --- | --- |
| 系列识别（名称／IP／品类） | **高** | `commonInfo.title` + `ipDesignerInfo` 稳定存在 | 按现方案实现 |
| 款式名称 + 图片 + 隐藏款标记 | **高（已验证）** | `toys[]` 完整，含 type | 按现方案实现 |
| 款式图库导入（一次一个系列） | **高** | 单页一次请求即得 | 按现方案实现 |
| 图片字节保存 | **高** | CDN `ACAO: *`，Node/浏览器均可 | 可简化：浏览器可直接取，服务端代理作兜底 |
| 系列目录索引／名称匹配 | **中高** | sitemap 1,002 条；中文别名需人工映射 | 需维护 catalog JSON + 别名表 |
| 官方人民币单盒价 | **低（基本不可行）** | SSR 恒 0；详情接口需签名；大陆官网无商城 | 必须走"用户确认/补填一次"分支 |
| 社交媒体 UGC 价格（小红书等） | **不可行** | 登录墙、请求签名、风控；内容为图文/视频 | 不纳入方案 |
| 搜索引擎摘要价格 | **低** | 百度第 3 次起验证码，搜狗 302 | 最多作人工参考，不自动写库 |
| 当地币种参考价（CAD/USD） | **中** | collection JSON 有 `price`+`currency` | 只能作参考展示，禁止换算成 CNY |
| 小程序分享码解析 | **不可行** | 无公开解码路径 | 维持 `needs_name` |
| 中文款式名 | **低** | 页面为英文 | 只能人工映射或用户输入 |
| 官方 IP 动画 | **未知（本次未验证）** | 页面仅见静态 banner | 维持"静态 + 轻动效"兜底 |

## 4. 结论

1. **款式图库自动导入是可行的，且已验证**。数据源为商品页内嵌 `__NEXT_DATA__`（或 `_next/data` JSON），一次请求可得系列名、IP、全部款式名、图片、隐藏款标记。
2. **人民币官方价不可自动获取**。现方案的"尝试获取人民币单盒价"实际会稳定落到 PRICE_UNVERIFIED 分支，需要产品上把"首次确认单盒价"设计成顺畅的一步，而不是异常路径。
3. **社交媒体不能作为价格源**。小红书／微博／抖音／B 站均需登录或签名，且内容价格多为整盒、溢价或二手价，无 provenance，自动写入会直接违反 PRD 的价格口径。
4. **架构基本不需要改**：仍需同源 Node 代理（页面与 JSON 无 CORS）。原计划的"签名媒体 token"可以简化——CDN 已允许跨域直取，但建议保留代理作为兜底。
5. **主要风险不是"能不能读"，而是"读得对不对"**：单盒/整盒混价、非手办商品无款式、英文名到中文的映射、以及 Next.js 内部结构变更。

## 5. 对技术文档的修正建议

> 以下 1–5 已并入《技术设计与开发实施文档》§4.3、§6.1、§8.3、§8.4 与 PRD §4.5、§5.4。

1. **价格策略**（§6.1、§8.4）
   - 把"自动取人民币价"降级为"可选"：优先展示用户已确认的该系列单盒价，其次展示当地币种参考价并**明确标注币种与地区**，绝不换算。
   - 参考价按系列设置一次，写入 `series.defaultUnitCents` + `priceProvenance = user_confirmed`；款式可单独覆盖。
   - 若用户不填，允许无参考价导入图库；首次购买时内联补填，之后复用。
2. **单盒/整盒判定**（§4.3、§8.3）
   - collection SKU 无整盒标记，建议规则：取最低正价 SKU 作单盒参考价；若同 SPU 存在 ≥2 个 SKU 且价差接近整数倍，标记 `PRICE_UNVERIFIED` 并要求用户确认。禁止直接取最高价。
3. **媒体获取**（§8.3）
   - 实测 CDN `ACAO: *`，可让浏览器直接 `fetch` 字节写入 IndexedDB，减少服务端带宽；保留 `/api/import/media/:token` 作为 CORS 变化时的兜底。token 仍需过期与白名单校验。
4. **目录索引**（§8.1）
   - 用 `sitemap-products.xml`（1,002 条）+ 逐条 `__NEXT_DATA__` 离线构建 catalog JSON，附 `parserVersion`、`fetchedAt`、`contentHash`；中文别名单独维护并标注来源，不自动翻译合并。
5. **稳定性与合规**（§8.5、§10.3）
   - `buildId` 每次部署变化：先取 HTML 提 `buildId` 再取 JSON，或直接解析 `__NEXT_DATA__`（单请求）。
   - 请求串行 + 缓存，避免触发同盾风控；不抓 `/search?` 等 robots 禁止路径。
   - 增加 `SOURCE_CHANGED` 检测：`commonInfo`/`toys` 缺失即判定结构变更，走名称匹配降级，不写虚构数据。

### 5.6 价格确认的低摩擦设计

既然价格需要用户确认，就要把它做成 2 秒动作，而不是打断流程的弹窗：

1. **从自己的历史推断**（默认首选，零网络）
   - 若该系列或同 IP 已有购买记录，取最近一次单盒实付作为**参考价候选**，标注"按你上次的购买记录"。
   - 注意：仅用于设置参考价，不进入购买表单做默认值（PRD 5.4 不做"沿用上次价格"按钮）；实付可能含折扣／运费，只作候选，仍需用户确认。
2. **快捷价格选项**
   - 常见档位一键选择（如 ¥59 / ¥69 / ¥79 / ¥99 / 自定义），一次点击完成。
3. **「去看看」外链**（替代抓取，零合规风险）
   - 提供 `https://www.xiaohongshu.com/search_result?keyword=<IP+系列名+价格>` 与百度搜索链接，`target="_blank"` 打开。
   - 用户自己浏览博主测评后回到应用填写；应用不读取、不存储平台内容。
   - 代价：iOS 独立 PWA 点击外链会跳到 Safari，返回需切回，建议同时提供「复制关键词」，让用户在常驻 App 内搜索。

**开发期**可维护一份人工核验的常见系列价目表（`series-price-catalog.json`，字段：IP、系列名、单盒 CNY、来源 URL、核验日期），导入时自动带出并标注"参考价，请确认"。这是"已核验目录索引"的一部分，不是抓取结果。

## 6. 下一步（P0 收尾前）

- [ ] 取 1–2 个真实"非手办"（抱枕／挂件）样本，确认 `toys[]` 为空时的品类判定与提示文案。
- [ ] 确认 pages 在 iPhone Safari 下不可直接读取（预期一致），固定走服务端代理。
- [ ] 抽样 30 个系列，统计 `toys[]` 完整率与图片可下载率，形成覆盖率基线。
- [ ] 验证 3 个目标 IP 的官方 IP 形象／动画资源是否存在（本轮只确认了静态 banner）。
- [ ] 建立初始 `series-price-catalog.json`（用户关注的 3 个 IP、约 10–20 个系列），逐条记录来源与核验日期。

## 7. 样本与命令留档

```bash
# 商品页
curl -sS "https://www.popmart.com/ca/products/9120/twinkle-twinkle-live-the-ordinary-series-figures"
# 结构化数据（需从 HTML 取 buildId）
curl -sS "https://www.popmart.com/_next/data/20261028172527/ca/products/9120.json"
# 集合（含 SKU 价格）
curl -sS "https://www.popmart.com/_next/data/20261028172527/ca/collection/531.json"
# 目录
curl -sS "https://www.popmart.com/ca/sitemap-products.xml"
```
