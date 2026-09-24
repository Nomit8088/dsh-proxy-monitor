# docs/

本插件的现行规范。写代码前按主题打开对应文件，不要从 `HANDOFF.md` 或 `merge-scope.md` 推断当前行为。

| 文档 | 何时读 |
| --- | --- |
| [INSTALL.md](./INSTALL.md) | 四种常见 DSH 安装方式、验证、升级/卸载、旧插件迁移、故障排查 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 数据流、Host/Client 边界、LLM 抢槽、额度单源 |
| [NEW_PROVIDER_GUIDE.md](./NEW_PROVIDER_GUIDE.md) | 接入一家新订阅的步骤与验收清单 |
| [UI_STYLE.md](./UI_STYLE.md) | 设置页 / 圆环 / 模型目录的视觉与组件复用 |
| [MODEL_CATALOG.md](./MODEL_CATALOG.md) | 活体刷新、启用/图像合并、选择器如何真正吃到目录 |
| [HANDOFF.md](./HANDOFF.md) | 会话交接与割接待办（可能滞后于代码） |
| [merge-scope.md](./merge-scope.md) | 四包合并的历史决策，不指导新功能 |

Agent 协作禁区（PowerShell 管道、npm i、client inject、能力即数据）在仓库根目录 `AGENTS.md`。
