# MODEL_CATALOG.md — 模型刷新与选择器生效

设置页的模型列表必须来自**当前账号的活体目录**，并能动态开关；勾选「支持图像」的模型在 DSH 对话里不得被拦截成文本。对话模型选择器必须读同一份偏好，而不是旧包写死的静态表。

---

## 1. 为什么设置页改了选择器没变

DSH 模型选择器只认 `ctx.llm.adapters` 里该路由的 `listModels` / `resolveModel`。

两件独立的事经常被混在一起：

| 层 | 作用 | 不作用的范围 |
| --- | --- | --- |
| 目录 HTTP + 设置页 `ModelCatalogPanel` | 给人看、给人改 `enabledModelIds` / `imageModelIds` | 不自动改选择器 |
| LLM adapter 的 `listModels` | 选择器真正的数据源 | 不读设置页 React state |

因此每个订阅都要同时做：

1. 本插件自己的 GET/POST 目录 API。
2. adapter（或 leftover wrap）按同一份偏好过滤并声明 `inputModalities`。
3. 写入后 `emitAdaptersUpdated()` / `ctx.emit('llm/adapters-updated')`。
4. 用户**重新打开**模型选择器（运行中的旧会话不回溯）。

Profile 里若还装着 `dsh-codex` 等旧包，它们会先占路由。必须走 `installOrTakeOverAdapter` 或 `wrapAdapterCatalog`（见 `ARCHITECTURE.md` §4），否则设置页再完整，选择器仍是旧目录。

### 1.1 选择器的答案可以直接问（诊断端点）

```sh
curl http://127.0.0.1:3080/plugins/dsh-proxy-monitor/picker/models
# ?provider=workbuddy 只看一家
```

它调用的是选择器自己用的两个公开方法（`llm.listProviders()` → `llm.listModels(id)`），所以返回的就是选择器的答案，
并把**注册失败**也一并列出（`setup` 数组），而不是像往常那样只留在宿主日志里。

「设置页有、选择器没有」这类问题先跑这一条：`providers` 里没有那家 ⇒ **adapter 根本没注册**，
和偏好、目录、CSS 都无关；有那家但模型少 ⇒ 才是过滤/偏好问题。

### 1.2 合并进来的运行时：宿主插件的 `inject` 必须补全

**这是 `workbuddy` 曾经掉出选择器的真实原因。** 原 `dsh-workbuddy-connect` 自己声明 `inject = ["llm"]`；
合并进本插件后，宿主用的是 `src/index.ts` 的 `export const inject`，当时是 `['settings', 'connection']` —— 少了 `llm`。
cordis 于是拒绝属性访问：

```
cannot get property "llm" without inject
```

vendored `startVariant()` 自己 `try/catch` 住这条异常并 `return false`（它以为只是"这次没起来"），
结果就是：**设置页照常有 WorkBuddy（配置目录在），选择器里一台都没有**，且宿主日志之外没有任何提示。

铁律：搬进来的运行时若**直接**访问 `ctx.<service>`（不是 `ctx.inject([...], cb)`），
那个 service 必须出现在宿主插件的 `inject` 里。加完请用 §1.1 的诊断端点确认 `providers` 里出现了它。

### 1.3 一份偏好文件，而不是两份

WorkBuddy 的启用/图像偏好只有一份：`~/.dsh/.workbuddy-user-catalog.json`
（`src/catalog-http.ts` 的 `WORKBUDDY_PREFS_FILENAME` ≡ vendored `WORKBUDDY_USER_CATALOG_FILENAME`）。
曾经设置页写 `storages/workbuddy-model-settings.json`、adapter 读前者，于是勾选落在 A、选择器按 B 过滤 —— 同一个坑的另一半。
`scripts/test-workbuddy-catalog.mjs` 用源码文本断言盯着这条等式，并且**禁止 vendored 读取带进程级缓存**
（缓存会让"谁写谁读不是同一个模块实例"时的写入永久不可见）。

---

## 2. HTTP 契约

路径挂在本插件下，避开旧包：

| 订阅 | Path | 活体来源 |
| --- | --- | --- |
| Codex | `/plugins/dsh-proxy-monitor/codex/models` | `GET https://chatgpt.com/backend-api/codex/models`（Bearer + `chatgpt-account-id`）；未登录则静态补丁（含 gpt-6 族） |
| Grok | `/plugins/dsh-proxy-monitor/grok/models` | Grok 活体 catalog + pi-ai `xai` 模板 |
| WorkBuddy | `/plugins/dsh-proxy-monitor/workbuddy/models` | leftover `/plugins/dsh-workbuddy-connect/status`；刷新走 `POST .../probe` `{action:"refresh"}` + `x-workbuddy-probe-key` |
| Antigravity | `/antigravity/api/models` | 账号 available models；硬编码 `MODELS` 只当族模板，未出现在 payload 的族不得注入 |
| **选择器诊断** | `/plugins/dsh-proxy-monitor/picker/models` | `llm.listProviders()` + `llm.listModels(id)`，外加各 provider 的注册结果（§1.1） |

### 2.1 信封

成功：

```json
{ "ok": true, "value": {
  "enabledModelIds": ["..."],
  "imageModelIds": ["..."],
  "options": [
    { "id": "...", "name": "...", "enabled": true,
      "supportsImages": true, "inputModalities": ["text", "image"],
      "meta": "optional" }
  ]
}}
```

失败：`{ "ok": false, "error": "..." }`，HTTP 4xx/5xx。Client 用 `catalogRequest()` 解信封。

### 2.2 方法

| 方法 | Body | 行为 |
| --- | --- | --- |
| `GET` | — | 读当前目录 + 已存偏好，不打上游 |
| `POST` | `{ "refresh": true }` | 拉活体 → `mergeEnabledModelIds` / `mergeImageModelIds` → 落盘 → 通知选择器 |
| `POST` | `{ "enabledModelIds": [], "imageModelIds": [] }` | 只改偏好，不打上游 |

不要把刷新做成「改 settings schema 的某个 model 字段」——旧 Codex 包对未知字段会 400 `request contains an unknown model setting`。

前端：进入 Tab 时 `load(true)` 拉活体；勾选走 save POST。刷新失败则回退 GET，保留上一份列表。

---

## 3. 合并规则（`src/catalog/preferences.ts`）

这是四家共用的纯函数，禁止在各家 integration 里再写一套。

### 3.1 启用 `mergeEnabledModelIds`

- **第一次**（没有旧 catalog、没有旧 enabled）：启用活体里全部 id。
- **之后**：保留用户关掉的；活体里**新出现**的 id 自动启用；活体里消失的 id 丢掉。

### 3.2 图像 `mergeImageModelIds`

- 已见过的 id：保持用户上次勾选。
- 新 id：用活体推断（`supportsImages` / `inputModalities` / `input` 含 `"image"`）。
- WorkBuddy 活体没有 `supportsImages` 时，用 id 匹配 `vl|vision|5v|4v|image` 作为默认，用户仍可改。

### 3.3 写给 DSH 的能力位 `withUserImageSupport`

```
选中图像 → inputModalities: ["text", "image"]
未选   → inputModalities: ["text"]
```

DSH 的 `projectImagesForTextModel` 在「定义了 `inputModalities` 且不含 `image`」时拦截附件。因此：

- 不能只设一个 UI 布尔却不改 adapter 模型对象。
- Codex 还要把同一选择 overlay 到 pi-ai 的 `model.input`。
- 「未定义 modalities」和「明确只有 text」不是一回事；本插件统一显式写出。

---

## 4. Adapter 必须吃同一份偏好

| 订阅 | 做法 |
| --- | --- |
| Codex | 自有 adapter：静态 gpt-6 补丁 ∪ 活体 merge → 按 enabled 过滤 → overlay image |
| Grok | `GrokAuthAdapter` 读 `GrokModelSettingsStore` 的 `visibleModelIds` / `imageModelIds` |
| Antigravity | `AntigravityAdapter` + `FileModelSettingsStore`（与 `/antigravity/api/models` 同一文件） |
| WorkBuddy | 不换 stream；vendored adapter 自己按偏好过滤，本插件再叠一层 `wrapAdapterCatalog` + `overlayWorkBuddyAdapterModels`（同一份偏好文件，见 §1.3）；`overlay` 在 `llm/adapters-updated` 上重挂，因此晚一步注册的 adapter 也会被覆盖 |

`listModels` 只返回 **enabled** 的模型。`resolveModel` 对已启用的 id 仍要能解析，并带上当前图像 modalities。

---

## 5. 活体失败时的降级

- **已登录但上游失败**：保留上次成功的 catalog 与用户勾选，设置页明确报活体刷新错误，并注明当前列表可能过期；不得把它误称为本次账号的活体模型。
- **没有上次成功目录 / 上游返回空目录**：Antigravity 选择器返回空列表，不能把静态 `MODELS` 模板（含 3.7 Flash）冒充当前账号已获准使用的模型。
- **未登录**：Codex / Grok 可以展示它们的静态模板，但刷新按钮仍应存在；登录后再 refresh 才是真目录。
- **禁止**把「我们猜的常用模型」写进 `listModels` 冒充活体，也不能凭名称猜测 Gemini 3.8 Flash 的 runtime id：只有 Google 当前账号的 available-models payload 真返回，才显示并允许勾选。
- **额度与目录是两个接口**：额度分桶可读、模型目录 403 时额度仍要正常展示，目录保留旧缓存并报错；额度自身 403 时原样显示账号验证/权限失败，不能用第二次无项目/旧 token 请求覆盖首个错误。`Verify your account to continue` 是 Google 的账号门禁，不是「额度已耗尽」，插件不能替账号完成验证。

Codex 活体需要 OAuth access + `accountId`。没签过到 `/codex/models` 的会话，历史上从未 live-fetch 过——5.3 出现在选择器里只是因为 pi-ai 静态 JSON。新模型（如 gpt-6-luna / gpt-6-sol）必须进静态补丁 **或** 活体 payload，只改设置页无效。

---

## 6. 验收

0. **先问选择器本人**：`GET /plugins/dsh-proxy-monitor/picker/models` —— 要验的那家必须在 `providers` 里，
   `setup` 里它的 `route` 必须是 `ok: true`。这一条不过，后面五条都不必看（adapter 没注册）。
1. 设置页「刷新模型」后列表与账号一致，不是写死表。
2. 取消勾选 → 重新打开对话模型选择器 → 该项消失。
3. 勾选「支持图像」→ 对该模型发带图消息 → DSH **不**把图投影成文本。
4. 关掉图像 → 带图消息被拦截（证明开关真的改了 `inputModalities`）。
5. 热重载后选择器仍走本插件目录（leftover 未把槽抢回去）。
6. 对应 `scripts/test-antigravity-models.mjs`、`scripts/test-catalog-preferences.mjs` 全绿。
