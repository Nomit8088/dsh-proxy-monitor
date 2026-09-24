# NEW_PROVIDER_GUIDE.md — 新订阅接入规范

在 `dsh-proxy-monitor` 里接入一家新的订阅反代。做完后它必须和其他四家一样：

- 设置页「订阅反代」里有一个 Tab，登录/额度/模型目录风格统一。
- 侧栏圆环能展开同一套账户块。
- 模型从账号动态拉取，可开关，可声明图像；**对话模型选择器吃同一份目录**。
- 额度与设置页共用 `collector.snapshot()`。

配套阅读：`ARCHITECTURE.md`（数据流）、`UI_STYLE.md`（页面）、`MODEL_CATALOG.md`（刷新与选择器）。

---

## 0. 先分清两种「提供商」

| 种类 | 例子 | 要做的 |
| --- | --- | --- |
| **订阅反代** | Codex / Antigravity / WorkBuddy / Grok | 账户适配器 + LLM 路由 + 模型目录 + 设置 Tab + 额度 reader |
| **只计量** | DeepSeek / Claude | 只加 `providers/*.ts` reader。不要做登录，不要进 `ProxiedProviderId` |

本指南只谈订阅反代。

---

## 1. 身份与文件地图

选两个 id，写入契约后不要改：

- **账户 id**（Tab、圆环、`ProviderAccount.id`）：短名，如 `foo`。
- **LLM 路由**（DSH 模型选择器）：上游习惯名，如 `foo-bar`。两者经常不同（Grok 账户 `grok`、路由 `xai`）。

最少要动的文件：

```
src/accounts/contract.ts          ProxiedProviderId 联合类型
src/accounts/<id>.ts              AccountAdapter
src/accounts/adapters.ts          若走通用 snapshot 映射
src/<id>/ 或 src/<id>-integration.ts
                                  LLM adapter、目录 HTTP、鉴权
src/llm-takeover.ts               复用 installOrTakeOverAdapter / wrap
src/catalog/preferences.ts        不要复制合并逻辑，直接调用
src/collector.ts + src/providers/<id>.ts
src/index.ts                      setup + registry
src/client/accounts/tabs.tsx
src/client/<id>/<Id>SettingsPanel.tsx
src/client/QuotaRail.tsx          PROXIED_IDS 字面量（须与账户 id 同步）
scripts/test-<id>-account.mjs
scripts/build.mjs                 挂上测试
```

Client 的 `PROXIED_IDS` 不能从 Host `contract.ts` import——浏览器半禁止依赖 Host 模块。两边用字面量对齐，类型靠 `ProviderAccount['id']` 卡住。

---

## 2. 账户适配器

实现 `AccountAdapter`（`src/accounts/contract.ts`）。

必须：

- `account()` / `quota()` **永不抛**：失败变成 `state: 'error'` 或 quota error 行。
- 布尔能力如实填。不能登出就 `canLogout: false`，不要在 UI 里写 `id !== 'workbuddy'`。
- `login.kind` 描述用户真正要做的事。桌面端拥有会话 → `none` + `reason`。
- `quota()` 从 `collector.snapshot()` 取行，禁止第二套上游读取。
- 返回值不含 token。身份用 email / 昵称。

登录状态机：

- `beginLogin` 返回 ticket（URL 或设备码），`done: false`。
- `pollLogin` 在用户完成前保持 open。
- **Re-auth**：已登录时不可把「凭证还在」当成成功。必须看到新的 pending 挑战被消费（Grok `sawPending`）。
- `logout` 只在本插件拥有会话时实现。

---

## 3. LLM 路由与 leftover

`ctx.llm.registerAdapter` 在路由已被旧包占用时抛 `DUPLICATE_ADAPTER`。

- 我们拥有完整 adapter（鉴权 + stream + 目录）→ `installOrTakeOverAdapter(llm, route, adapter, log)`。
- 旧包必须继续负责 stream（例如 WorkBuddy 国服运行时）→ `wrapAdapterCatalog` 只包 `listModels` / `resolveModel`，原方法 `.bind(inner)` 后再包，避免递归。

抢槽后调用 `emitAdaptersUpdated()`。失败（`adapters` Map 不可达）要打 warn：选择器会继续用旧包。

目录 HTTP **不要**注册到旧包 path。用 `/plugins/dsh-proxy-monitor/<id>/models`。Antigravity 的 `/antigravity/api/models` 是历史例外，新订阅不要再挂到别人的前缀上。

---

## 4. 模型目录（必做，不是可选项）

规范全文见 `MODEL_CATALOG.md`。接入时最低要求：

1. Host：GET 读偏好、POST `{refresh:true}` 拉活体、POST ids 保存。信封 `{ ok, value }`。
2. 合并用 `mergeEnabledModelIds` / `mergeImageModelIds` / `withUserImageSupport`。
3. `listModels` 只返回启用项；选中图像的模型必须带 `inputModalities: ["text","image"]`。
4. Client：Tab 体只渲染 `ModelCatalogPanel`，请求走 `catalogRequest`。
5. 进入 Tab 触发一次 live refresh；勾选即保存。

活体是 source of truth。静态表只能当模板或未登录补丁。账号 payload 里没有的模型不得注入。

---

## 5. 页面（必做）

规范全文见 `UI_STYLE.md`。接入时最低要求：

1. 只在 `tabs.tsx` 加 Tab，不新增 `settings.section`。
2. 不在 Tab 里重做登录按钮——`SectionShell` 已渲染 `AccountBlock`。
3. 颜色只用 `--dsw-*`。
4. 侧栏详情卡会自动出现账户块，前提是 `QuotaRail` 的 `PROXIED_IDS` 包含新 id，且 registry 能返回该行。

---

## 6. 额度采集

1. `src/providers/<id>.ts` 实现 reader：成功返回 `ProviderQuota`，失败返回带 `error` 的行，**不要 0%**。
2. 加入 `collector.ts` 的 `READERS`（决定圆环默认顺序）。
3. 若认证服务持有刷新锁，在 `index.ts` 用 `overrides` 换掉文件 reader，避免侧栏红、设置页绿。
4. 慢厂商不得阻塞其他行：collector 已经并发 + 隔离，新 reader 不要在内部串行等待别人。

---

## 7. 测试与门禁

`scripts/test-<id>-account.mjs` 至少覆盖：

- 已登录 / 未登录 / 错误 三种 `account()` 映射。
- `canLogout` / `canReauth` / `login.kind` 与真实能力一致。
- begin + poll 未完成时 `done === false`。
- re-auth 在用户行动前不报成功（若支持登录）。
- quota 来自 snapshot，缺失时是 error 不是 0%。

模型合并加到 `scripts/test-catalog-preferences.mjs`（或该家专用脚本），断言：

- 第一次全开；之后保留用户关闭；新 id 自动启用。
- `withUserImageSupport` 写出的 modalities 正确。

然后：

```powershell
node scripts/build.mjs
```

不要 `node ... | ...`（Windows 沙箱 EPERM）。不要随便 `npm i`（会冲掉类型 junction）。

热重载：`dev_reload_package({ packageName: "dsh-proxy-monitor" })`。改了 client CSS/TSX 后浏览器 **Ctrl+F5**。

---

## 8. 验收清单

账户与额度

- [ ] 设置页 Tab 出现；登录控件与能力位一致；做不到的按钮不出现。
- [ ] 侧栏圆环展开卡的登录区与设置页同一套交互。
- [ ] 刷新额度：侧栏与设置页数字相同；失败显示错误而非 0%。

模型

- [ ] 「刷新模型」拉到账号真实列表。
- [ ] 取消勾选后，重新打开对话模型选择器，该项消失。
- [ ] 勾选「支持图像」后带图消息不被 DSH 投影成文本。
- [ ] leftover 旧包仍在 profile 时，选择器仍走本插件目录（takeover/wrap 成功）。

工程

- [ ] `ProxiedProviderId`、`tabs.tsx`、`QuotaRail` `PROXIED_IDS` 三处 id 一致。
- [ ] 目录 URL 在 `/plugins/dsh-proxy-monitor/...`。
- [ ] client 未新增未 inject 的平台包；CSS 无私货色值。
- [ ] `node scripts/build.mjs` 全绿。

---

## 9. 反例（已经付出过代价）

- 把模型写死在 pi-ai JSON / `MODELS` 常量里，设置页刷新只改本地 state。
- 设置页 POST 到旧包 `/plugins/dsh-openai-codex/models` 或根本不存在的 `/plugins/dsh-workbuddy-connect/models`。
- 只改 catalog HTTP，不抢 `listModels`：选择器毫无反应。
- UI 写 `provider.id === 'workbuddy'` 来藏登出按钮。
- 失败额度画成 0%，或侧栏与设置页各打一次上游。
- Re-auth 看到 `configured === true` 立刻报成功。
