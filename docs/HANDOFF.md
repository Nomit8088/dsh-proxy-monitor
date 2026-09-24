# HANDOFF.md — 会话交接与现状记录

本文档为后续会话接手、新增反代模型或排查问题提供即插即用的上下文指引。

---

## 1. 任务背景与核心目标

用户希望将 DSH 环境下的 **4 个独立订阅反代插件**（`dsh-codex`、`dsh-grok-auth`、`dsh-antigravity`、`dsh-workbuddy-connect`）完整整合并入 `@dsh-external/dsh-proxy-monitor`（保持此插件名称），实现：
- 单一插件接管 4 大反代服务的路由、鉴权与配置。
- 侧栏浮动条与设置面板的账户、额度显示风格、登录/登出控制全量统一。
- 在后续操作中安全卸载/剔除原先的 4 个独立插件，不再产生任何运行时冗余。

---

## 2. 当前最新完成状态（已过 68 项自动化门禁）

### ✅ 地基（统一账户抽象层 + UI 体系）
- 确立了统一的 `AccountAdapter`、`ProviderAccount` 协议体系。
- 引入了能力即数据原则：`canLogout` 与 `canReauth` 为显式独立属性，不再在 UI 层硬编码判断。
- 实现了统一的 `QuotaPanel.tsx`，显示各窗口进度条、百分比、重置倒计时及手动刷新按钮，严格杜绝失败伪装为 0% 额度。
- 优化采集架构：侧栏悬浮球与设置页面板全部共享 `collector.snapshot()`，消除了重复请求上游额度的问题。

### ✅ Grok 反代与设备码登录
- 移植完整 Grok 宿主服务，采用 RFC 8628 设备码流程（全程无需官方 CLI 介入即可由宿主直接驱动）。
- 解决了已登录状态下重新鉴权（re-auth）误判瞬间成功的问题：引入 `sawPending` 状态机。
- 额度采集重构为优先经由持有令牌刷新锁的 Grok 认证服务，杜绝两套数据源冲突。

### ✅ Codex 反代全量能力迁移
- 完整迁入 33 个源码文件，保留 FastMode 优先模式、`imagegen` 生图、`read_image` 远程 URL 输入、独立 Web 搜索 Provider、代理模式控制器（off/scoped/global）、上下文覆盖和模型目录。
- 实现了 `CodexAccountAdapter` 与 `CodexSettingsPanel.tsx`，在设置页「订阅反代」的 Codex Tab 下完整渲染所有配置项。
- 引入动态路由冲突保护：若检测到原独立插件仍注册了 `openai-codex`，则安全让渡，避免 `DUPLICATE_ADAPTER` 异常崩溃。

### ✅ Antigravity 反代迁移
- 从本地 `dsh-antigravity/lib/index.js` 完整迁入（保留 MIT 协议）。
- **完整保留了未提交的双端点双倍额度探测改动**：`DEFAULT_ENDPOINT` 设为 `daily-cloudcode-pa.sandbox.googleapis.com`，并发请求两端点并择优选取消耗中的配额，模型列表按较小剩余比例合并，适配 `ToolCallId`。
- 实现了 `AntigravityAccountAdapter`，接入浏览器 OAuth 登录/回调与登出能力。
- **活体模型目录（非写死）**：`parseCatalogModels` 以账号 `available models` 为唯一来源，硬编码 `MODELS` 只作族模板/路由别名；未出现在活体 payload 里的族不再注入。设置页 Antigravity Tab 可刷新、勾选启用/禁用。
- **逐模型「支持图像」开关**：选择写入 `imageModelIds`，`listModels`/`resolveModel` 对选中模型声明 `inputModalities: ["text","image"]`，DSH 不会再把附件图片拦截成文本（`projectImagesForTextModel`）。

### ✅ WorkBuddy 国服 CN 变体迁移
- 完整迁移国服运行时核心代码至 `src/workbuddy/`，丢弃 `workbuddy-ai` 与海外版代码。
- 遵照 WorkBuddy 本地桌面 App 鉴权设计，诚实上报 `login.kind: 'none'`、`canLogout: false`。

---

## 3. 实机当前探针结果

运行 `node scripts/probe-accounts.mjs --grok` 得到稳定输出：
```
codex        signed-in   -                     login=browser  logout
grok         signed-in   timonchan8@gmail.com  login=device-request -
antigravity  signed-in   timonchan8@gmail.com  login=browser  logout
workbuddy    signed-in   TIMON                 login=none     -
repeat read stable: true
rows: 4 == registered: 4
```

---

## 4. 后续工作清单（收尾与独立插件下线）

1. **用户端 UI 验收**：
   - 刷新 DSH Web 界面（http://127.0.0.1:3080/），进入 设置 ->「订阅反代」。
   - 验证四个 Tab（Codex, Antigravity, WorkBuddy, Grok）的展示是否完整、额度刷新按钮是否正常。
2. **独立旧插件剔除（下线旧包）**：
   - 当前 Profile 的 `package.json`（`C:\Users\nomit\.dsh\profiles\web\package.json`）中，仍声明了原有的独立反代依赖与 bundles 项。
   - 当需要正式割接时：
     1. 从 `dsh.profile.bundles` 中移除 `dsh-codex`、`dsh-grok-auth`、`dsh-antigravity`、`dsh-workbuddy-connect`。
     2. 将 `@dsh-external/dsh-proxy-monitor` 固化在 bundles 中（当前作为 injected 模组工作正常）。
     3. 此时本插件的冲突让渡保护会自动切换为正式接管各个 LLM 适配器路由（`openai-codex`、`antigravity`、`workbuddy` 等）。
