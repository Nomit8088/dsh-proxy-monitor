# ARCHITECTURE.md — 数据流与落点

本文说明 `@dsh-external/dsh-proxy-monitor` 现在实际怎么跑，而不是合并初期的设想。
新增订阅、改 UI、改模型目录之前先读这一份，再按 `NEW_PROVIDER_GUIDE.md` 落地。

---

## 1. 插件同时做两件事

1. **订阅反代**：把 Codex / Antigravity / WorkBuddy / Grok 的鉴权、LLM 路由、生图/搜索等接到 DSH。
2. **额度与账户面**：侧栏圆环（`shell.overlay`）和设置页「订阅反代」共用同一份账户/额度快照。

DeepSeek、Claude 只进额度采集，不进反代账户层——本插件不拥有它们的会话。

---

## 2. 两半平面

| 平面 | 入口 | 允许接触 | 禁止 |
| --- | --- | --- | --- |
| Host | `src/index.ts` `apply` | 凭证、上游 HTTP、`ctx.llm`、webServer 路由、Connection RPC | 浏览器包、`window` |
| Client | `src/client/index.tsx` | slots、settingsScope、Connection RPC、本插件 HTTP | 凭证、Node API、未注册的 `@deepseek-ai/*` require |

浏览器半只收**无密钥的值**：账户身份、额度百分比、登录指引（URL / 设备码）。令牌出现在 client 是适配器的 bug。

Client 打包走 `tsdown` → `lib/client.js`。平台依赖必须写在 `package.json` 的 `dsh.client.inject`，构建会 AST 审计。

---

## 3. 身份对照

账户 UI 用短 id；LLM 路由用 DSH provider id。二者不要混用。

| 账户 / 设置 Tab | LLM 路由 | 模型目录 HTTP |
| --- | --- | --- |
| `codex` | `openai-codex` | `/plugins/dsh-proxy-monitor/codex/models` |
| `antigravity` | `antigravity` | `/antigravity/api/models` |
| `workbuddy` | `workbuddy` | `/plugins/dsh-proxy-monitor/workbuddy/models` |
| `grok` | `xai` | `/plugins/dsh-proxy-monitor/grok/models` |

目录 URL **必须挂在本插件自己的 path 下**（Antigravity 是历史例外，沿用 `/antigravity/api/*`）。不要复用旧包的 `/plugins/dsh-openai-codex/models` 之类——旧包还在 profile 时会 400/405。

---

## 4. Host 装配顺序（`src/index.ts`）

1. 注册 settings namespace `dsh-proxy-monitor`。
2. 建 `QuotaCollector`（可对 Grok 等注入 `overrides`，走持锁的认证服务而不是第二套文件读取）。
3. 建 `AccountRegistry`，挂四个 `AccountAdapter`。
4. `setupCodex` / `setupAntigravity` / `setupWorkBuddy` / `setupGrok`：LLM 路由 + 目录 HTTP + 各家专属能力。
5. Connection RPC：浏览器只经此通道拿额度快照与账户动作。

热重载时 leftover 独立包可能已经占了 LLM 路由。`registerAdapter` 会抛 `DUPLICATE_ADAPTER`。本插件用 `src/llm-takeover.ts`：

- **`installOrTakeOverAdapter`**：整槽替换（Codex / Grok / Antigravity）。对话选择器的 `listModels` / `stream` 都走我们。
- **`wrapAdapterCatalog`**：只包 `listModels` / `resolveModel`（WorkBuddy）。旧包继续 stream，我们叠启用/图像偏好。

接管后必须 `emitAdaptersUpdated()`（或 `ctx.emit('llm/adapters-updated')`），否则设置页改了，对话模型选择器仍是旧列表。

旧包 fiber dispose 会删掉被偷的槽。正式割接是从 profile `dsh.profile.bundles` 去掉 `dsh-codex`、`dsh-antigravity`、`dsh-workbuddy-connect`、`dsh-grok-auth`，并把本插件写入 bundles。在那之前 steal 是过渡手段。

---

## 5. 额度：只有一个真相源

```
各家凭证/上游 ──► providers/* 或 overrides ──► QuotaCollector.snapshot()
                                              │
                    侧栏圆环 ◄─────────────────┤
                    设置页 QuotaPanel ◄────────┘
```

禁止前端直打上游额度接口。失败必须是 error 行，**禁止把失败画成 0%**。

`AccountAdapter.quota()` 从同一份 snapshot 取行，不另开通道。

---

## 6. 账户面：能力即数据

`src/accounts/contract.ts` 是 UI 唯一允许绑定的账户协议。

每个适配器必须诚实上报：

- `state`: `signed-in` | `signed-out` | `error`
- `login.kind`: `none` | `browser` | `device` | `device-request` | `cli`
- `canLogout` / `canReauth`：独立布尔，**禁止** UI 按 provider id 推断

`AccountBlock` 只 switch `login.kind` 和这两个布尔。WorkBuddy 是 `login.kind: 'none'` + `canLogout: false` 的样板：桌面端拥有会话，本插件不假装能登出。

Re-auth（已登录再换号）不能把「凭证文件还在」当成成功。必须等到新的 URL/设备码出现并被消费。Grok 的 `sawPending` 是这个坑的回归锁。

---

## 7. 模型目录（摘要）

活体目录是 source of truth，静态 JSON 只作族模板/缺省补丁。

设置页勾选 → 本插件 HTTP → 持久化 `enabledModelIds` / `imageModelIds` → adapter `listModels` 过滤并给选中模型声明 `inputModalities: ["text","image"]`。

DSH 在 `inputModalities` 存在且不含 `"image"` 时会走 `projectImagesForTextModel`，把附件变成文本。所以「支持图像」不是展示用标签，是必须写进 adapter 模型对象的能力位。

完整规则见 `MODEL_CATALOG.md`。

---

## 8. Client 表面

| Slot | 组件 | 职责 |
| --- | --- | --- |
| `shell.overlay` | `QuotaRail` | 贴边圆环 + 详情卡 + 与设置页同一套 `AccountBlock` |
| `settings.section` | `SectionShell` | 一个导航项，内部 Tab 切换四家；共享账户块 + 额度面板，Tab 体只放各家专属字段（主要是模型目录） |

新增订阅：**不要**再注册一个 settings.section。加 Tab + 账户适配器 + 目录面板。

页面风格见 `UI_STYLE.md`。

---

## 9. 关键目录

```
src/accounts/          账户契约、registry、四家适配器
src/catalog/           启用/图像偏好的纯合并（无 IO）
src/catalog-http.ts    WorkBuddy 目录 HTTP + leftover overlay
src/llm-takeover.ts    抢槽 / 包 leftover catalog
src/*-integration.ts   各家 LLM + HTTP 装配
src/collector.ts       额度单源缓存
src/client/accounts/   设置壳、AccountBlock、QuotaPanel、tabs
src/client/models/     共用 ModelCatalogPanel + catalogRequest
src/client/QuotaRail.* 侧栏圆环
```
