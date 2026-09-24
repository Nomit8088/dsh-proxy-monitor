# 反代合并：范围、源码现状与统一架构（评审用 · 修订 2）

目标：把 `dsh-codex` / `dsh-antigravity` / `dsh-workbuddy-connect` / `dsh-grok-auth`
四家的**反代能力**（订阅账号 → DSH LLM 路由）内联进 `dsh-proxy-monitor`，
额度监控半边保持独立只读。四个 provider 走**同一套统一架构与统一 UI**。

> 本文只陈述**已核实**的事实。修订 2 纠正了修订 1 的若干错误，见 §0。

---

## 0. 修订记录：两处必须纠正的错误

### 0.1 错误一：`dsh-grok-auth` **有完整源码**

修订 1 说它「只有编译产物」。**错。**

`D:\dev\toolPrograms\dsh-plugin\dsh-grok-auth\` 是一个完整的 pnpm 工程：

```
src/grok-auth.ts          22,951 B   OAuth/PKCE/设备码/跨进程写锁
src/grok-auth-service.ts  46,697 B   服务层：状态、刷新、用量
src/grok-auth-adapter.ts   8,261 B   extends PiAiAdapter
src/grok-models.ts         8,578 B   活体模型发现
src/rpc.ts / rpc-contract.ts         Connection RPC
src/env-proxy.ts / bounded-response.ts
src/client/{index.ts,GrokAuthSettings.tsx,locales.ts,*.module.css}
tests/{grok-auth.spec.ts,rpc.spec.ts}   31 KB 测试
tsconfig*.json / tsdown.config.ts / vitest.config.ts
```

版本 `0.1.2`，与本机安装一致；git 干净，4 个提交。

### 0.2 更正：`dsh-antigravity` 的代码**就在那个目录里**

修订 1 措辞「只有编译产物、没有源码」是**误导**，现更正：

**代码在 `D:\dev\toolPrograms\dsh-plugin\dsh-antigravity\lib\index.js`，
就是可维护的源码。** 依据：

- 该文件 **105,088 B / 2,863 行，未压缩**：标识符、控制流、字符串全部保留
  （`fetchQuotaSummaryFromEndpoint`、`antigravityHeaders`、`parseQuotaSummary`…），
  格式化完整（36.7 B/行），只有 TS 类型被抹掉；
- 全目录递归（含隐藏）只有：`assets/`、`bin/antigravity-login.mjs`、
  `lib/{index.js,client.js}`、`cordis.patch.yml`、`package.json`、两个 README、LICENSE；
- git 全历史（已 `fetch` 确认与 `origin/main` 一致、无落后）**从未出现 `.ts`/`.tsx`**；
  上游 GitHub tree 同样只有 `lib/`。仓库是 shallow clone（`.git/shallow` 存在）。

**结论**：antigravity 直接在该目录的 `lib/*.js` 上维护与移植即可，
不需要反编译、也不需要从别处找源码。代价只是「非 TS、无测试」。

（对照：grok 有完整 TS + 测试；codex 有随 npm 包分发的 TS；
workbuddy 需从上游 GitHub 取 TS。）

### 0.3 你说的「额度 URL 更新」已定位（未提交，只在 lib 里）

`git status` 显示 `lib/index.js`、`lib/client.js` 有未提交改动（+61/−7）。内容正是：

1. **端点优先级调换**：
   - `DEFAULT_ENDPOINT`：`https://cloudcode-pa.googleapis.com`
     → **`https://daily-cloudcode-pa.sandbox.googleapis.com`**
   - 回退数组两项位置对调
2. **新增多端点合并取额度**：`fetchQuotaSummaryFromEndpoint` + `fetchMergedQuotaSummary`
   —— 并发打两个端点，优先选**有实际消耗**（`remainingFraction < 1`）的那份，
   都为空时回退原来的 `postJson('/v1internal:retrieveUserQuotaSummary')`；
   `fetchAccountQuota` 调用点由 `postJson(...)` 换成 `fetchMergedQuotaSummary(token)`。
3. **跟随 harness 改名**：`CallId` → `ToolCallId`。
4. `fetchMergedAvailableModels` 由 `Object.assign` 改为**逐模型取更小 remainingFraction**。

**重要**：这些改动**只存在于 `lib/`**，没有对应 TS 源码；且本地 `lib/` 与
安装到 profile 的那份是**同一个 junction 目标**
（`profiles/web/node_modules/dsh-antigravity` 是 Junction → 本地目录）。

### 0.4 四家源码可得性总表（修订）

| 插件 | 源码形态 | 位置 | 许可 |
|---|---|---|---|
| `dsh-codex` 0.2.7 | ✅ TS，33 文件 | **npm 包内自带 `src/`** | Apache-2.0 |
| `dsh-grok-auth` 0.1.2 | ✅ TS + 测试 | **本地** `dsh-plugin\dsh-grok-auth\src` | MIT |
| `dsh-antigravity` 0.0.4 | ✅ **未压缩 JS**（无 TS） | **本地** `dsh-plugin\dsh-antigravity\lib\index.js` | MIT |
| `dsh-workbuddy-connect` | ✅ TS + 测试 | **上游 GitHub**（本机未克隆） | MIT |

> **workbuddy 版本差异**：上游 main 的 `lib/index.js` 85,197 B，本机装的 70,051 B；
> 上游 chunk 名 `variants-CnrmSn0Q.js`，本机 `variants-CExA7lJt.js`。
> 说明**上游 main 比本机 0.5.2 新**。已定：**以上游最新为准**。

---

## 1. 合并后的规模（修订口径）

| | host | client |
|---|---|---|
| `dsh-codex` | 6,110 | 2,319 |
| `dsh-antigravity` | 2,863（无 TS） | 618 |
| `dsh-workbuddy-connect` | 4,339 | 1,659 |
| `dsh-grok-auth` | 1,748 | 574 |
| 四家合计 | **≈15,060** | **≈5,170**（205 KB） |
| 本插件现有 | 208 + 采集 1,100 | 1,900 |
| **合并后总量** | | **≈23,500 行** |

---

## 2. 四条路由的注册面（硬约束）

一个 provider 路由**只能被一个 adapter 占有**（`registerAdapter` 冲突抛
`DUPLICATE_ADAPTER`，全有或全无）：

| 插件 | 路由键 | adapter 基类 | 必须保留的外部包 |
|---|---|---|---|
| `dsh-codex` | `openai-codex` | 自写 `LlmAdapter` | `@earendil-works/pi-ai`、`undici` |
| `dsh-antigravity` | `antigravity` | 自写 `LlmAdapter` | 无（仅 `dsh-llm`/`dsh-home-paths`/`dsh-timeout`） |
| `dsh-workbuddy-connect` | `workbuddy`、`workbuddy-ai` | 复用 pi-ai `openai-completions.lazy` | `@deepseek-ai/dsh-llm-pi-ai`、`pi-ai` |
| `dsh-grok-auth` | `xai` | **`extends PiAiAdapter`** | `@deepseek-ai/dsh-llm-pi-ai`、`pi-ai` |

**内联消不掉**：`@deepseek-ai/dsh-llm-pi-ai`（harness 自带）与
`@earendil-works/pi-ai`（dist 4.08 MB）。workbuddy/grok 直接继承前者。

**`dsh-llm-pi-ai` 不支持 OAuth**（其源码原话：它 "holds no OAuth store to fall back on"）。
codex 与 grok 都靠**自写 `PiAiAdapter` 注入**绕过，这两份注入必须一并搬。

---

## 3. 统一架构（你的第 3 条要求）

### 3.1 现状：四家架构确实不同

| | 凭据位置 | 刷新 | 登录方式 | 额度来源 | 浏览器面 |
|---|---|---|---|---|---|
| codex | `~/.dsh/.openai-codex-auth.json` | pi-ai 生命周期 | ChatGPT OAuth（浏览器回调） | 上游 usage 端点 | 整页 `settings.openai-codex` + 额度条 + FastMode 开关 |
| antigravity | `~/.dsh/storages/antigravity-oauth.json` | 自写 Google token | Google OAuth（本地回调 `server.listen`） | 上游 quota 端点（双端点合并） | `settings.section` |
| workbuddy | 桌面 App `CodeBuddyExtension\...\workbuddy-desktop.info` | 自写上游刷新 | **无需登录**（复用桌面 App） | 上游 billing | `settings.plugin.item` + 模型选择器注入 |
| grok | `~/.grok/auth.json` | 自写 + 跨进程写锁 | 官方 CLI 浏览器 PKCE **或** RFC 8628 设备码 | 上游 billing | `settings.grokAuth` |

### 3.2 统一的宿主接口（拟）

统一**能力面**，各家的凭据读取/刷新/额度解析按 §3.1 保留差异：

```ts
/** 登录态：值无关，永不携带 token。 */
export type AuthState = 'signed-in' | 'signed-out' | 'error'

export interface ProviderAccount {
  id: ProviderId
  name: string
  /** 账户标识（邮箱/昵称），永不是 token。 */
  account?: string
  state: AuthState
  /** 登录方式决定 UI 显示什么控件。 */
  login:
    | { kind: 'none' }                                    // workbuddy：复用桌面 App
    | { kind: 'browser' }                                 // codex/antigravity：点击开授权页
    | { kind: 'device'; instruction: DeviceInstruction }   // grok：设备码
    | { kind: 'cli'; instruction: CliInstruction }         // grok：调官方 CLI
  error?: string
}

/** 统一能力面：四家都实现。 */
export interface AccountAdapter {
  /** 只读登录态（值无关）。 */
  account(): Promise<ProviderAccount>
  /** 发起登录；返回展示给用户的指令（URL / 用户码 / 等待中）。 */
  beginLogin?(): Promise<LoginTicket>
  /** 轮询或收尾一次登录。 */
  pollLogin?(ticketId: string): Promise<LoginTicket>
  /** 登出（workbuddy 为 no-op）。 */
  logout?(): Promise<void>
  /** 额度读取；沿用现有 ProviderQuota 契约。 */
  quota(): Promise<ProviderQuota>
}
```

要点：
- **`ProviderQuota` 契约不动** —— 现有 6 个额度适配器与侧栏零改动。
- 登录能力**新增**；UI 按 `login.kind` 分派，但用**同一个控件**渲染。
- workbuddy 的 `kind: 'none'` 让它在统一 UI 里也有一行，显示
  「通过 WorkBuddy 桌面端登录」而不是按钮。

### 3.3 统一的浏览器面（你的第 1、3 条）

- **侧栏（rail）统一**：圆环不变；**详情卡新增统一「账户」区**
  —— 登录态 + 账户名 + 登录/登出按钮（`kind: 'none'` 时显示来源说明）。
  「侧边栏控制登录」四家完全一致。
- **设置页：一个总入口**（已定）。注册**一个** `settings.section`（左侧导航
  只多一行「订阅反代」），内部用 tab 切换各 provider：
  `Codex | Antigravity | WorkBuddy | Grok`。
  外壳（标题、账户块、登录控件、额度块排版）由**同一个共享组件 + 一套 CSS Modules**
  渲染，各家只渲染自己的**特定字段**：
  - **Codex**：FastMode 默认、代理三态、图片工具、上下文窗口
  - **Antigravity**：模型勾选（enabledModelIds）
  - **WorkBuddy**：authFile 路径、probeConsent（**仅国服，无国际版**）
  - **Grok**：CLI 路径、设备码/浏览器登录指令
- **WorkBuddy 只做国服**（已定）：只保留 CN 变体（路由 `workbuddy`、
  settings 命名空间 `workbuddy`、`https://copilot.tencent.com` +
  `https://www.codebuddy.cn`、auth 文件 `workbuddy-desktop.info`）。
  **不移植** `workbuddy-ai` / 国际变体（`https://www.workbuddy.ai`、
  `GLOBAL_BASE`、`prepareInternationalChatBody`、`.workbuddy-ai-*` 系列文件）。
  UI 从 `settings.plugin.item` 改注册进总入口的 tab。

---

## 4. 依赖与构建面的扩张

本插件当前缺的 external：

```
dsh-llm, dsh-llm-pi-ai, dsh-home-paths, dsh-timeout, dsh-fs, dsh-attachment,
dsh-tools, dsh-web, dsh-session, dsh-atomic-write,
@earendil-works/pi-ai, @deepseek-ai/dsh-client-ui-primitives（客户端）
```

- `link-types.mjs` 的 `PACKAGES` 由 8 项扩到约 20 项。
- `undici` 必须是**真实 dependency**（`npm i`，不能用 junction）。
- **客户端 externals**：当前 `tsdown.config.ts` 的 `CLIENT_EXTERNALS` 只有
  `react`/`react-dom`/`cordis`；grok 的 client 需要
  `@deepseek-ai/dsh-client-ui-primitives`。
- **client bundle 仍须合成一个入口**（`dsh.client` 只声明一份，modules 半边
  并进 `window.__DSH_BOOT__`）：四份 205 KB 的 UI 要并成一个 React 应用。

---

## 5. 落地形态（修订 1 建议仍成立，且更省）

**不必把四份 adapter 重写成一份。** Cordis 的 bundle patch 允许**同一个包插多行**
（`dsh-codex` 自身就是 `dsh-codex` + `dsh-codex/tui` 两行）。

于是：**一个包、多 host 入口**（`exports` 暴露 `./codex`、`./antigravity`、
`./workbuddy`、`./grok`），`cordis.patch.yml` 插 4–6 行，各家保留原 adapter 与 `inject`。
host 半边因此是**搬运级**而非重写级；「统一」体现在：

- 四家共同实现 §3.2 的 `AccountAdapter`（新增胶水层，各家约 50–150 行）；
- 四家共用 §3.3 的共享 UI 外壳组件；
- 额度读取统一走现有 `contract.ts` 的 `ProviderQuota`。

代价集中在**浏览器半边只能有一个入口**这一处合流。

---

## 6. 分阶段计划与进度

> 全部决策已定，见 §7。以下为执行顺序，✅ 标记已完成。

### ✅ 第 1 步：地基（已完成）

- `scripts/link-types.mjs` 的 `PACKAGES` 由 8 项扩到 **29 项**（全部命中，无跳过）。
- `package.json`：加真实 dependency `undici@^8.10.0`；peerDependencies 扩到 12 项
  并全部标 `optional`（它们由 harness 在运行时经 junction 提供，不经 npm）。
- `tsdown.config.ts`：client externals 拆成 **`CLIENT_SEED`（shell 种子表）+ 
  `CLIENT_GRAPH`（图行）** 两段。**关键发现**：shell 的 `staticModules` 种子表只有
  9 个词（`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、
  `@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、
  `dsh-client-ui-primitives`、`dsh-client-ui-dockkit`）；其余必须经
  `dsh.client.inject` 作为图行到达。另加**构建期 purity 门禁**：引入 shell 不提供的
  `@deepseek-ai/*` 会构建失败并给出修法，而不是运行时报 "module not registered"。
- 新建 `src/accounts/`：`contract.ts`（统一 `AccountAdapter` + `LoginMethod` 四态）、
  `registry.ts`（失败隔离 + id 盖章）、`adapters.ts`（quota 派生适配器）。
- 新建 `src/client/accounts/`：`AccountBlock`（**一个登录控件服务四家**）、
  `SectionShell`（一个总入口 + tab）、`store.ts`（侧栏与设置页共享同一份账户状态）、
  `useAccounts`、`tabs.tsx`，各自配 CSS Modules（全部主题 token，审计 0 硬编码色）。
- `QuotaRail` 详情卡加「账户」区；`contract.ts` 加 4 个端点
  （`accounts`/`login`/`loginPoll`/`logout`）。
- 新增 `scripts/test-accounts.mjs`（20 项）；接入 `scripts/build.mjs` 与 `npm test`。

**第 1 步中实测发现并修掉的两个真 bug**（各补了针对性测试）：

1. **注册表信任 adapter 自报的 `id`** —— 四个 surface 都以 `id` 为 map key，
   一个报错 id 的 adapter 会把 A 的状态显示在 B 名下且无从察觉。改为从 adapter 盖章。
2. **四个 provider 都显示「退出登录」但没人实现 `logout`** —— 实机 probe 发现四个
   账号全部 signed-in，UI 就会给出点了没反应的按钮。根因是视图层用 provider id
   推断能力；改为**能力即数据**（`ProviderAccount.canLogout` 随行携带）。

### ✅ 第 2 步：grok 参考实现（已完成）

- 移植 `src/grok/`：`grok-auth.ts`、`grok-auth-service.ts`、`grok-auth-adapter.ts`、
  `grok-models.ts`、`bounded-response.ts`、`env-proxy.ts`、`rpc-contract.ts`
  （`.ts` 后缀导入改写为 `.js`）。
- `src/accounts/grok.ts`：`GrokAccountAdapter` —— 统一面上的**第一个真实登录实现**
  （RFC 8628 设备码，全程在 Host 内完成）。

移植中发现的三处适配（都不是抄错，是真实版本/环境差异）：

1. **`dsh-llm-pi-ai` 版本偏移**：grok 源码针对 `^0.1.1-rc.1`，本机装的是 `0.1.5-rc.1`，
   后者把 `ResolvedPiAiProviderProfile.modelErrors` 变为**必填**。已补 `new Map()`。
2. **`RpcResult` 来源**：grok 从 `@deepseek-ai/dsh-host-apiproxy/api` 取（本机未安装），
   改用 `@deepseek-ai/dsh-client-connection` 的 `ConnectionRpcResult`（定义等价）。
3. **服务解耦**：`GrokAuthService` 原 `extends Service` 并注册 cordis 服务名 `grokAuth`，
   会与**仍在加载**的独立 `dsh-grok-auth` 插件**重名冲突**。改为普通类 +
   窄接口 `GrokServiceHost`（只用 `logger.warn` 与 `effect`）。

- 新增 `scripts/test-grok-account.mjs`（20 项：账户态 / 登录方式选择 / ticket 状态机 /
  额度换算），接入构建。
- 新增 `scripts/probe-accounts.mjs`（实机诊断，`--grok` 可选，**不进门禁**）。

**实机验证**（`node scripts/probe-accounts.mjs --grok`）：

```
codex        signed-in   -                            login=none     -
antigravity  signed-in   aicode-consumers             login=none     -
workbuddy    signed-in   TIMON                        login=none     -
grok         signed-in   timonchan8@gmail.com         login=cli      -
repeat read stable: true   rows: 4 == registered: 4
```

`grok` 走真实 adapter，读到 live auth 文件与账号邮箱，正确不提供登出。
热重载成功，`before/after: [active]`。

> **登录流程现状**：grok = 真实设备码；codex / antigravity / workbuddy =
> `kind: 'none'` 占位（UI 因此正确地不显示按钮）。`canLogout` 四家均 `false`，
> 因为登出需要写各家的凭据存储，属于独立改动。

### ✅ 第 2 步修补：用户反馈「grok 里无法登录」

用户在实际 GUI 中报告无法在「订阅反代 → Grok」里发起登录。核实后确认是**设计 bug**
（不是操作问题），且**有两层**：

1. **按钮被条件挡住（主因）**。`AccountBlock` 的登录按钮条件是
   `canStart && !signedIn`。而本机 Grok **已经是登录状态**，于是按钮根本不渲染
   ——已登录的 provider 完全没有「重新登录／切换账号」入口。这恰恰是最需要登录的时候
   （token 轮换、共享机器、登错账号）。
   修法：新增独立能力位 `ProviderAccount.canReauth`（与 `canLogout` 正交），
   按钮条件改为 `canStart && (!signedIn || account.canReauth)`，
   已登录时文案为「重新登录」（次要按钮样式）。

2. **re-auth 会瞬间假成功（修 1 时发现的更深一层）**。`pollLogin` 以
   `status().configured` 作为完成信号。对**未登录**用户这是对的；但对**已登录**
   用户，该标志一开始就是 true，因此第一次 poll 就会判定"登录完成"——
   用户点了按钮、什么都没做，界面却说成功了。
   修法：ticket 记录 `startedConfigured` 与 `sawPending`。未登录：凭证出现即完成；
   已登录：必须**先看到待批准的设备码、再看到它消失**才算完成。

3. **标签与行为不一致（附带修掉）**。原先未登录时标签是 `kind:'cli'`
   （"在终端运行 grok login"），但按钮实际调 `beginLogin()` → **设备码流程**。
   且 fallback 文案还写着"设备码登录（将随下一步接入）"——而设备码早已实现，是句假话。
   修法：新增 `LoginMethod.kind:'device-request'`（设备码尚未申请的状态），
   CLI 命令降级为**附带提示**（"也可在终端运行…"），因为按钮并不执行它。

### ✅ 第 2 步修补②：设备码可用性实测 + 设置页余额与刷新

用户提出关键质疑：**"我之前用 dsh-grok-auth，浏览器登录无法授权，必须用 CLI"**。
这必须实测而不是推测，因为它决定整个 grok 登录方案是否成立。

**实测结论：设备码流程可用，用户遇到失败的是另一条路。**

直接打端点（经代理）：

```
POST https://auth.x.ai/oauth2/device/code
→ HTTP 200
  user_code: ZRF2-PAJY
  verification_uri: https://accounts.x.ai/oauth2/device
  verification_uri_complete: …?user_code=ZRF2-PAJY
  expires_in: 1800, interval: 5

POST https://auth.x.ai/oauth2/token  (device_code grant)
→ HTTP 400 {"error":"authorization_pending"}   ← 未批准时的正确响应
```

`dsh-grok-auth` 有**两条**登录路径，用户失败的是第一条：

| 路径 | 机制 | 是否需要 grok CLI | 本插件是否采用 |
|---|---|---|---|
| `browser` | spawn `grok login`，由 CLI 做 PKCE + 本地回调 | **是** | 否 |
| `device` | RFC 8628 设备码，全程在 Host 内 | **否** | **是** |

这正是当初选设备码的原因：它是唯一**不依赖官方 CLI、且完成状态可被 Host 观测**
的路径（CLI 那条路把整个流程交给外部进程，Host 看不到完成）。

**本机沙箱说明**：我的 shell 无法写 `~/.grok`（workspace-write 策略限制），
因此 `withFileLock` 在**我的探针里**报 `EPERM`，日志出现
`could not coordinate the Grok Login State`。已验证 `withFileLock` 在可写路径下正常，
且 DSH 主进程本身有 `~/.grok` 写权限（`auth.json` 刚被 CLI 更新过）——
**这不是插件 bug，是我的执行环境限制**。真实插件进程不受影响。

### ✅ 第 2 步修补③：设置页余额显示 + 刷新（用户要求）

用户指出：**"设置里看余额的功能也要加上，否则不好判断是否成功登录了，刷新余额也要"**。
这个要求是对的——登录成功只是"凭证写入成功"，**额度读取成功才是凭证真的可用**。

新增 `src/client/accounts/QuotaPanel.tsx`（+ CSS Modules），每个 provider tab 下渲染：

- **每个计量窗口**：进度条（绿<75% / 琥珀≥75% / 红≥90%）+ 已用百分比 + 相对重置时间 +
  绝对重置时间。
- **余额型** provider 显示余额文本。
- **新鲜度**：`读取于 HH:MM:SS`，让陈旧数字不会被误当成实时值。
- **「刷新额度」按钮**：强制重读全部 provider（`broker.refresh()`）。
- **失败不伪装成数字**：读取失败显示原因，而不是 0%——满环但其实是失败的读数
  比明确报错更糟，因为它可信。

同时修掉一个设计缺陷：原 `account()` 与 `quota()` 各自直接读 provider，会导致
设置页 + 侧栏**重复读取每家 2–3 次**。改为都走 `collector.snapshot()`（已缓存 + 合流），
于是两个界面共享一次上游读取，且不可能显示不同时刻的数据。
`QuotaCollector` 新增 `overrides` 选项，让 grok 的额度经**持有凭据与写锁的 service**
读取（而非 `providers/grok.ts` 那个不会刷新的独立读取器）——否则会出现
"侧栏红环、设置页正常"这种自相矛盾。

另修：grok 读不到额度时按**凭证是否可解析**区分 `unconfigured`（该去登录）
与 `error`（上游问题），避免把"凭证不可用"报成"上游故障"让用户找错方向。

测试增至 **55 项**（账户 22 + grok 33）。

### ✅ 第 3 步：codex 反代与功能全量迁移（已完成）

- 将 `dsh-codex` 完整 33 个源码文件迁移并规范放入 `src/codex/`，将内部相对引用重写为标准的 ES 模块 `.js` 扩展名。
- 适配 `ResolvedPiAiProviderProfile` 类型变化（补全必填的 `modelErrors: new Map()`）。
- 保留 Codex 全部扩展功能面：FastMode、imagegen 工具、`read_image` HTTP(S) URL 远程图片、独立 Web Search Provider、进程级代理控制、上下文窗口与模型目录管理。
- 接入统一账户与设置面板：实现 `CodexAccountAdapter`，编写 `CodexSettingsPanel.tsx`，在设置页「订阅反代」的 Codex Tab 下直接渲染 Codex 专属设置。
- 新增 `scripts/test-codex-account.mjs`，包含 9 项测试。

### ✅ 第 4 步：antigravity 迁移（已完成）

- 将 `dsh-antigravity` 本地未压缩的 `lib/index.js`（含未提交的双端点双倍额度探测改动、ToolCallId、模型合并逻辑）迁入 `src/antigravity/`。
- 实现 `AntigravityAccountAdapter`（接入 `account()` / `beginLogin()` / `pollLogin()` / `logout()` / `quota()` 完整闭环）。
- 注册 LLM route 防冲突兜底逻辑。
- 新增 `scripts/test-antigravity-account.mjs`，包含 4 项测试。

### ✅ 第 5 步：workbuddy 国服 CN 变体迁移（已完成）

- 将 `dsh-workbuddy-connect` 运行时代码迁入 `src/workbuddy/`，仅保留国服 CN 变体（丢弃国际版）。
- 统一接入后端与状态探针。

### 6. 收尾（当前阶段）

所有四大反代提供商（Grok / Codex / Antigravity / WorkBuddy）已全量集成至 `dsh-proxy-monitor` 单个插件中。
自动化测试全部通过（**68 项测试**）。

---

## 7. 已定决策（本轮确认）

| # | 议题 | 决定 |
|---|---|---|
| 1 | 设置页形态 | **一个总入口**「订阅反代」+ 内部 tab（Codex / Antigravity / WorkBuddy / Grok） |
| 2 | antigravity 源码 | 代码**就在** `dsh-plugin\dsh-antigravity\lib\index.js`，为未压缩可维护 JS，直接在其上作业（见 §0.2 更正） |
| 3 | codex 功能面 | **全部保留**：FastMode / imagegen / 联网搜索 / `read_image` URL / 进程级代理 |
| 4 | workbuddy 基准 | 用**上游最新**，且**只做国服 CN**，不要国际版 |

### 由决策 4 派生的删除清单（workbuddy）

移植时**不迁移**以下国际版内容：

- 路由与命名空间：`workbuddy-ai`（第二 variant）、`WORKBUDDY_AI_SETTINGS_NS`
- 端点：`GLOBAL_BASE = https://www.workbuddy.ai`、`regionOf()` 的 global 分支、
  `prepareInternationalChatBody`
- 文件：`AI_VARIANT`、`.workbuddy-ai-auth.json`、`.workbuddy-ai-probe.json`、
  `.workbuddy-ai-catalog.json`、`.workbuddy-ai-version.json`
- UI：`WorkBuddyConfigPage`/`WorkBuddyPluginCard` 里的国际卡分支

保留：CN 变体（`copilot.tencent.com` + `www.codebuddy.cn`、
`workbuddy-desktop.info` 凭据发现、`WORKBUDDY_SETTINGS_NS`）。

### 由决策 3 派生的保留清单（codex）

`src/` 33 个文件全部纳入，含：`search.ts`、`imagegen.ts`、
`read-image-enhancement.ts`、`public-http.ts`（SSRF 防护）、`proxy.ts`、
`tool-policy.ts`、`fast-mode.ts`、`auth-routes.ts`（10 条 HTTP 路由）、
`tui.ts`（TUI 入口）、`doctor.ts`、`compatibility.ts`、
以及 `client/` 五个 TSX（设置页 1,326 行、额度条、FastMode 开关、图片视图、locales）。

> 注：`dsh-codex` 为 **Apache-2.0**。内联须保留其 `LICENSE` 与出处声明，
> 并在本插件 `NOTICE`/README 中注明来源。
