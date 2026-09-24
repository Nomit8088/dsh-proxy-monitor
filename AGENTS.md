# AGENTS.md — Agent 协作与开发规范

本文档为在 `dsh-proxy-monitor`（反代聚合与额度监控插件）上工作的 AI Coding Agent 与开发者提供全景规范、关键架构禁区及常用开发命令。

---

## 1. 项目定位与核心架构

`dsh-proxy-monitor` 是 DeepSeek Harness (DSH) 环境下的超级整合插件，兼备两大职责：
1. **反代模型服务接入**：聚合并替代原有的 4 个独立反代插件（`dsh-codex`、`dsh-grok-auth`、`dsh-antigravity`、`dsh-workbuddy-connect`），对外提供 `openai-codex`、`antigravity`、`workbuddy` 等 LLM Adapter 路由、生图工具、增强读取与专属设置。
2. **额度监控圆环与设置面板**：在 Web 界面侧栏悬浮条（`shell.overlay`）以及设置页「订阅反代」中提供统一的账户状态、剩余/已用额度窗口仪表盘、刷新按钮与各家登录/登出控制器。

---

## 2. 关键禁区与环境铁律（严格遵守）

### 2.1 严禁在 PowerShell 中 Piping 捕获 node 输出
在当前 Windows 沙箱环境中，执行 `node scripts/... | ...` 会直接触发 `ResourceUnavailable: 程序'node.exe'运行失败：拒绝访问 (EPERM)`。
- **正确做法**：直接运行 `node scripts/build.mjs`，不要加管道。

### 2.2 严禁 Speculative 乱装 npm 包
- 本仓库绝大部分 `@deepseek-ai/*` 依赖由 Harness 宿主运行环境提供，通过 `node scripts/link-types.mjs` 创建 Junction 链接。
- 绝不能随意执行破坏 `node_modules` 的 `npm i`，否则会冲掉 29 个类型软链。
- 若确实需要外部包，必须检查 `peerDependenciesMeta.optional`。真实依赖目前仅 `undici` 等极少数运行时必需包。

### 2.3 必须维护 Client 模块表契约（静态纯洁度）
- 浏览器端打包使用 `tsdown`，输出到 `lib/client.js`。
- **模块纯洁度门禁**：浏览器端运行时 `require()` 只允许出现平台种子模块（`react`、`react/jsx-runtime`），所有 `@deepseek-ai/*` 平台依赖必须通过 `package.json` 中的 `dsh.client.inject` 作为图行进入，严禁直接打入未注册的第三方 Node/平台包。构建脚本中已有自动 AST 审计，违背会导致门禁失败。

### 2.4 能力诚实原则（Capability as Data）
- 任何 UI 控制（登录按钮、退出按钮、重新登录）**严禁通过 provider id 硬编码推断**！
- 必须由后端的 `AccountAdapter.account()` 携带真实布尔位：
  - `canLogout: boolean`（支持主动登出才为 true；例如 WorkBuddy 依赖本地桌面端则为 false）
  - `canReauth: boolean`（支持重新鉴权/换号才为 true）
  - `login: LoginMethod`（真实指示：`none` / `browser` / `device` / `device-request` / `cli`）

---

## 3. 标准开发与构建闭环

修改任意代码后，运行全量门禁流水线：
```powershell
# 1. 链接类型并执行完整编译、类型检查、测试（含几何测试/过渡测试/账户测试等）
node scripts/build.mjs

# 2. 实机探测各账户状态（可选带 --grok 验证真实 Grok 服务）
node scripts/probe-accounts.mjs --grok

# 3. 运行时热重载本插件
# 在 DSH 会话中调用工具：
# dev_reload_package(packageName: "dsh-proxy-monitor")
```

---

## 4. 目录结构导航

```
dsh-proxy-monitor/
├── docs/
│   ├── README.md                   # 文档索引
│   ├── INSTALL.md                  # 安装/升级/卸载与四种常见 DSH 安装方式
│   ├── ARCHITECTURE.md             # 数据流、抢槽、额度单源
│   ├── NEW_PROVIDER_GUIDE.md       # 新订阅接入规范与验收清单
│   ├── UI_STYLE.md                 # 设置页 / 圆环 / 目录的页面风格
│   ├── MODEL_CATALOG.md            # 活体模型刷新与选择器生效
│   ├── HANDOFF.md                  # 会话交接（可能滞后）
│   └── merge-scope.md              # 四包合并的历史决策
├── scripts/
│   ├── build.mjs                   # 主构建流水线（Link -> TSC -> Tests -> Tsdown -> CSS Audit）
│   ├── build.sh                    # POSIX 包装（兼容插件生产线工具链）
│   ├── link-types.mjs              # 29 个 harness 类型软链维护
│   ├── test-accounts.mjs           # 账户适配层防隔离测试 (22 项)
│   ├── test-grok-account.mjs       # Grok 设备码状态机与额度测试 (33 项)
│   ├── test-codex-account.mjs      # Codex 浏览器 OAuth 状态机测试 (9 项)
│   ├── test-antigravity-account.mjs# Antigravity 状态与额度测试 (4 项)
│   ├── test-antigravity-models.mjs # Antigravity 活体目录与图像开关测试
│   ├── test-workbuddy-catalog.mjs  # WorkBuddy 偏好单源 / vendored 无缓存契约
│   └── probe-accounts.mjs          # 实机实时账户探针
├── src/
│   ├── accounts/                   # 统一账户适配抽象层
│   │   ├── contract.ts             # AccountAdapter, ProviderAccount, LoginMethod 核心接口
│   │   ├── registry.ts             # 适配器注册表、调用路由与异常隔离
│   │   ├── adapters.ts             # 通用快照映射逻辑
│   │   ├── grok.ts                 # Grok 设备码与配额适配
│   │   ├── codex.ts                # Codex 浏览器 OAuth 与配额适配
│   │   └── antigravity.ts          # Antigravity OAuth 与配额适配
│   ├── client/                     # 浏览器端 UI (Web Shell)
│   │   ├── accounts/               # 统一设置页「订阅反代」Tab 面板、QuotaPanel 额度进度条
│   │   ├── antigravity/            # Antigravity 活体模型目录（启用开关 + 图像能力）
│   │   ├── codex/                  # Codex 专属设置面板 (CodexSettingsPanel.tsx)
│   │   ├── QuotaRail.tsx           # 侧栏浮动悬浮球及展开卡片
│   │   └── index.tsx               # Client 端入口与 Slot 注册
│   ├── codex/                      # Codex 宿主能力全量源码 (LLM Adapter / 搜索 / 生图 / 代理)
│   ├── grok/                       # Grok 宿主能力源码 (设备码授权 / 速率限制解析)
│   ├── antigravity/                # Antigravity 宿主代码 (未压缩 JS + 双端点额度探测)
│   ├── workbuddy/                  # WorkBuddy 国服 CN 变体运行时
│   ├── collector.ts                # 统一额度采集器 (单源缓存合流，支持 overrides)
│   └── index.ts                    # 插件主入口 (Cordis apply)
└── package.json
```

---

## 5. 新增反代或修 Bug 的快速 Check-list

1. **若新增反代 Provider**：
   - 按 `docs/NEW_PROVIDER_GUIDE.md` 全清单做，页面跟 `docs/UI_STYLE.md`，模型跟 `docs/MODEL_CATALOG.md`。
   - 在 `src/accounts/contract.ts` 的 `ProxiedProviderId` 注册账户 ID（与 LLM 路由 id 分开）。
   - 实现 `AccountAdapter`（能力布尔如实填，禁止 UI 按 id 推断登录/登出）。
   - 目录 HTTP 挂 `/plugins/dsh-proxy-monitor/<id>/models`；`listModels` 必须吃同一份启用/图像偏好。
   - leftover 占路时用 `installOrTakeOverAdapter` / `wrapAdapterCatalog`，不要 `registerAdapter` 硬撞。
   - **搬进 vendored 运行时**时，若它直接读 `ctx.<service>`（而不是 `ctx.inject([...], cb)`），该 service 必须写进
     `src/index.ts` 的 `export const inject`；漏了会被 cordis 拒绝为 `cannot get property "<service>" without inject`，
     而 vendored 代码常自己 catch 掉 —— 症状是「设置页有、选择器没有」，且日志之外毫无提示（详见 `docs/MODEL_CATALOG.md` §1.2）。
   - 验收前先问选择器本人：`GET /plugins/dsh-proxy-monitor/picker/models`（含各 provider 的注册结果，§1.1）。
   - 一份偏好：别让设置页写 A 文件、adapter 读 B 文件；vendored 读取不得带进程级缓存。
   - `tabs.tsx` 加 Tab，体里复用 `ModelCatalogPanel`，不要新开 `settings.section`。
   - `scripts/test-xxx-account.mjs` 接入 `scripts/build.mjs`。
2. **若修改额度计算 / 登录状态机**：
   - 绝不要使用两套真相源（前端直查 vs 采集器快照）。必须通过 `collector.snapshot()` 同步。
   - 注意 `reauth`（已登录时的重新登录）与全新登录的状态机差异：已登录时必须等待新设备码/URL 出现并被消费，绝不可看到 `configured === true` 即刻判成功。
