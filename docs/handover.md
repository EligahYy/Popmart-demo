# my popmart 交付说明

日期：2026-11-12 · 版本：0.1.0

## 当前状态

- 功能闭环完成：导入 → 选款 → 购买 → 收藏 → 账本 → 预算 → 退款/退货/转出 → 备份恢复
- 视觉已按用户三张参考图落地（p1 配色与圆角、p2 3D 柔和色、p3 排版）
- PWA、离线、图片本机缓存、单进程部署就绪
- **待办**：界面反馈调整、iPhone 实机验收

## 快速运行

```bash
pnpm install
pnpm start            # 构建前端 + 单进程服务（默认 8787）
```

- 本机：http://127.0.0.1:8787
- 局域网：`HOST=0.0.0.0 pnpm --filter @my-popmart/import-server start`
- 开发：`pnpm dev`（前端 5173）+ 导入服务 8787
- 生产部署与 HTTPS 要求见 [deploy.md](deploy.md)

## 技术栈

React 19 + TypeScript + Vite 7｜Dexie 4（IndexedDB）｜Fastify 5｜fflate｜vite-plugin-pwa｜Vitest 4 + Playwright

```text
apps/web/         客户端（domain 纯函数 / db 命令层 / features 页面）
apps/import-server/ 导入适配器 + 媒体代理 + 静态托管
packages/contracts/ 金额、日期、导入 DTO
docs/             方案、验收、部署、安全、视觉说明
assets/           开发期素材（不进公开构建）
```

## 数据边界

- 收藏、订单、金额、备份、个人形象只存浏览器 IndexedDB
- 服务端只做公开资料抓取与图片代理，不接收个人数据
- 个人形象在「设置 → 首页形象」本地上传

## 关键实现

| 领域 | 做法 |
| --- | --- |
| 金额 | 整数分 + BigInt 最大余数分摊，合计严格相等 |
| 日期 | 日 / 仅月 / 不详三精度，周一为周起点 |
| 写入 | 单事务命令层 + commandId 幂等 + revision 冲突检测 |
| 统计 | 全部从订单/明细/退款/转出实时派生，不做易漂移累加 |
| 导入 | `__NEXT_DATA__` 解析 + 目录别名 + 结构变化降级 |
| 媒体 | 导入时后台缓存为 Blob，SHA-256 去重；失败回退远程 |
| 备份 | ZIP + manifest + 逐文件哈希；staging 写入后原子切换数据集 |
| PWA | 预缓存外壳 + 更新提示 + 离线态提示 |

## 验证证据

| 类别 | 结果 |
| --- | --- |
| 单元/集成测试 | 158 个通过（contracts 26 / import-server 25 / web 107） |
| 浏览器脚本 | 12 条（导入、多选、收藏架、身份卡、账本、明细编辑、多明细退款、离线、备份、个人化、AC 组合、面板交互、视觉检查） |
| 性能 | 10,000 行读取约 100ms、聚合约 2ms |
| 依赖审计 | 生产依赖 0 告警；3 条开发期依赖见 [security.md](security.md) |
| 类型检查 | 三个包全部通过 |

## 验收状态

详见 [acceptance.md](acceptance.md)：39 项自动化、2 项已完成（视觉）、2 项部分自动化（PWA 安装、动效观感）、1 项待实机（首屏密度）。实机步骤见 [device-acceptance.md](device-acceptance.md)。

## 已知限制

- 小程序分享码无法解析，走系列名称匹配
- 官方页面不提供人民币价，需要用户确认一次单盒价
- 导入依赖官方页面结构，结构变化会返回 `SOURCE_CHANGED`
- 局域网 HTTP 无法安装 PWA / 注册 Service Worker，需 HTTPS
- iOS 存储有配额与清理策略，长期依赖导出备份

## 交付物

- 可运行代码、`pnpm-lock.yaml`、`.env.example`
- 文档：PRD、技术方案、导入可行性、验收矩阵、实机清单、部署、安全、视觉
- 截图：`docs/screenshots/`
- 脚本：`apps/web/scripts/`（每条 e2e 可单独运行）

## 下一步

1. 按你的界面反馈调整 `theme.css` 与布局
2. 部署到 HTTPS 环境
3. 按 [device-acceptance.md](device-acceptance.md) 完成 9 项实机验收并记录结果
