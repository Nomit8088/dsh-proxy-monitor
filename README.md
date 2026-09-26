# dsh-proxy-monitor

`@dsh-external/dsh-proxy-monitor` — DeepSeek Harness 的**订阅反代聚合 + 额度监控**插件。

一个插件顶四个：把原 `dsh-codex` / `dsh-grok-auth` / `dsh-antigravity` / `dsh-workbuddy-connect` 的能力
（LLM Adapter 路由、生图工具、活体模型目录、账户与专属设置页）收进同一层，
并在界面边缘加一条**额度悬浮侧栏**。

## 安装

标准 DSH bundle 插件（`dsh.bundle.patch` + `dsh.client`）。**构建产物 `lib/` 已入库**，
所以从 git 源安装不需要本地构建，也不需要放行 pnpm 的构建脚本：

```sh
# 推荐：官方插件安装命令（内部转发给 profile 目录的 pnpm，并按安装结果自动收编进 dsh.profile.bundles）
dsh plugin --profile web add github:Nomit8088/dsh-proxy-monitor

# 钉版本
dsh plugin --profile web add github:Nomit8088/dsh-proxy-monitor#v0.2.4

# Release 预打包 tgz（等价，不碰 git）
dsh plugin --profile web add https://github.com/Nomit8088/dsh-proxy-monitor/releases/download/v0.2.4/dsh-external-dsh-proxy-monitor-0.2.4.tgz

# 本地目录 link（开发调试）
dsh plugin --profile web add link:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor

# 国内网络加 gh-proxy 前缀
dsh plugin --profile web add git+https://gh-proxy.com/https://github.com/Nomit8088/dsh-proxy-monitor.git
```

验证并重启：

```sh
dsh --profile web --dump-config | grep -i proxy-monitor   # PowerShell 用 Select-String
# 重启 dsh web 并刷新页面：设置页出现「订阅反代」与「额度监控」，有数据时侧栏出现圆环
```

卸载：`dsh plugin --profile web remove @dsh-external/dsh-proxy-monitor`。

> **不要与四个旧插件同时安装**（`dsh-codex` / `dsh-grok-auth` / `dsh-antigravity` / `dsh-workbuddy-connect`）：
> 本插件会接管同一批 provider 的 adapter 与设置区，重复安装会导致设置页重复条目、模型目录来回跳。
> 迁移前先卸旧的 —— 完整说明（四种安装方式、手写 profile 清单、升级/回滚、故障排查）见
> [`docs/INSTALL.md`](./docs/INSTALL.md)。

## 它长什么样

侧栏是从屏幕边缘**长出来的一条标签**：外侧紧贴屏幕（不圆角，否则会留下一道应用背景的缺口），
内侧圆角，上下两端用**连续的凹形过渡（scoop）**收进屏幕边缘 —— 就是参考图里那种
"从边缘里长出来"的形态，而不是一张贴着边的浮动卡片。

```
 屏幕边缘
    │
    ├╌╌╌                          ← 起始是贴着边缘的一丝
    ├──╮
    │  │
    │  │  ╭───╮
    │  │  │ ✳ │  73%              ┌──────────────────────┐
    │  │  ╰───╯                   │ ✳  Claude Usage      │
    │  │  ╭───╮                   │ Current session 51min│
    │  │  │ ⬡ │  100%             │ ████████████░░░░ 73% │···
    │  │  ╰───╯                   │ All models           │  └─ 舌状连接
    │  │  ╭───╮                   │ █░░░░░░░░░░░░░░░  7% │···   把卡片接回滑块
    │  │  │ ⬢ │  5%               └──────────────────────┘
    │  │  ╰───╯
    │  │  ╭───╮
    │  │  │ ⟳ │                   ← 刷新
    │  │  ╰───╯
    │  │
    ├──╯
    ├╌╌╌                          ← 收回到边缘的一丝
    │
```

### 上下过渡的几何

过渡由 `radial-gradient` 的椭圆在**盒外填色**实现。每个 scoop 是一个贴着屏幕边缘、
位于滑块正上方（或正下方）的盒子，渐变圆心取**同时远离屏幕边缘和远离滑块**的那个角，
半径等于盒子自身尺寸 —— 于是：

- 远端只填出一条正好落在屏幕边缘上的细线，**与边缘相切**（所以是"长出来"而不是"被切掉"）；
- 靠近滑块时单调张开；
- 到接缝处正好铺满盒子宽度。

盒子的宽度取**滑块宽度减去内侧圆角半径**，这一点是关键：滑块内侧在最顶端并不竖直（它有
`--dsh-pm-radius` 的圆角），所以接缝处它的轮廓是从圆角起点开始的。若 scoop 铺满整个滑块宽度
就会**多出正好一个圆角半径**，接缝处出现一道横向台阶。按半径收窄后，两条曲线的接缝点与切线
完全吻合（实测两者都在 `x=24.000`，切线同为 `-692.8`），于是从屏幕边缘 → scoop → 滑块圆角 →
滑块内侧边缘是一条连续曲线。`--dsh-pm-scoop`（默认 54px）是"过渡有多缓"的唯一旋钮。

### 展开卡片的连接

详情卡片与滑块之间不是一个空隙，而是一段**舌状连接**：用 `clip-path` 多边形描绘，两侧走
`smoothstep` 曲线（`3t²−2t³`），因此**两端都相切** —— 从卡片边缘平着出来、平着落到滑块上，
中间收成 68% 高度的颈部，没有折角。腰线刻意收浅、桥也略加长，避免短跨度上出现漏斗感。
卡片自身的阴影用 `box-shadow`（只描卡片本身），舌片画在卡片之上，因此阴影不会在滑块上抹出一道灰带。

- **环的颜色编码严重度**：< 75% 绿、≥ 75% 琥珀、≥ 90% 红。扫一眼就知道哪个快用完了。
- **余额型提供商**（DeepSeek 只有余额、没有订阅窗口）不画环，改在卡片里显示余额文本。
- 只在**有数据**时出现；没登录任何提供商时侧栏整体不渲染，不留空壳。

## 支持的提供商

| 提供商 | 数据源 | 计量口径 |
| --- | --- | --- |
| **DeepSeek** | 官方 `GET https://api.deepseek.com/user/balance`，密钥取自 credentials 的 `DEEPSEEK_API_KEY` | 余额（¥），无百分比 |
| **Codex** | `dsh-codex` 自己的回环路由 `/plugins/dsh-openai-codex/auth/status` 的 `usage` 块 | 会话窗口 + 周窗口 + credits 余额 |
| **WorkBuddy** | `dsh-workbuddy-connect` 的 `/plugins/dsh-workbuddy-connect/status` 的 `credits` 块 | 各计费包 `remain/size` 聚合百分比 |
| **Antigravity** | `dsh-antigravity` 的 `/antigravity/api/quota`（失败时直接用共享 OAuth 凭据打上游） | 每个模型组的周窗口 + 5 小时窗口 |
| **Grok** | 读 `~/.grok/auth.json` 并调 `https://cli-chat-proxy.grok.com/v1/billing?format=credits` | 周额度 |
| **Claude** | `~/.claude/.credentials.json` + `https://api.anthropic.com/api/oauth/usage` | 5 小时会话 + 7 天窗口 |

每个适配器都是**容错**的：某个厂商改字段或掉线，只会让那一行降级成带错误说明的条目，
不会拖垮整次采集，也不会让侧栏消失。

## 三个硬性要求的落地方式

### 1. 前端风格：默认只显示圆环 + 百分比，悬停/点击展开详情

- 圆环是 SVG `stroke-dasharray` 进度弧，44px，2.5px 描边，从 12 点方向顺时针增长。
- 静置时整条侧栏是半透明的（默认 82%，可在设置里调 20–100%），鼠标移入或键盘聚焦时升到 100%。
- 悬停展开（`expandOnHover`）默认开启；关掉后只能点击展开。
- 详情卡列出每个窗口的**进度条 + 已用百分比 + 相对重置时间**（"in 51 min"），
  绝对时间放在 `title` 里；余额行显示为文本。

### 2. 不影响 DSH 原有交互 + 跟随外观主题

这两点由扩展点的**选择**保证，而不是靠事后规避：

- **不占用任何既有 UI**。侧栏注册进 `shell.overlay` —— ui-layout 的 AppFrame 声明的
  全帧浮动层。它是一个 `list` 槽位，所以本插件是**并列添加**而不是替换任何东西；
  该层的 CSS 是 `pointer-events: none`，条目自己 opt-in 才接收指针事件。侧栏条
  （`.slab`）接收指针事件，但**画形状的那一层**（`.slabShape`）是 `pointer-events: none`，
  所以真正可点的只有圆环按钮和刷新按钮，侧栏**永远不会挡住**底下的应用。
- **避让左右侧栏**。`shell.overlay` 覆盖整个 frame，包括左右侧栏占用的列，
  所以「贴视口边缘」会压住打开的右侧栏。`src/client/frame.ts` 量测真实盒宽算出
  左/右 inset，再用 CSS 变量定位；右侧栏全屏时（文档阅读器、终端）侧栏直接隐藏让位。
- **让开 DSH 自己的轮次导航条**。对话视图右侧有一条「一轮一刻度」的导航轨
  （ui-chat 的 `TurnNavigator`），它的刻度是**右对齐**的，与贴着右边缘的滑块必然重叠。
  本插件不改别人的包（类名是 CSS Modules 哈希，改不动也不该改），而是**把导航轨向左让开**：
  `src/client/turnnav.ts` 按**结构**（零高度 sticky 槽位里的 absolute `nav`）找到它，
  用 `margin-right`（不动它自己的 `right` 值）推开恰好重叠的距离 + 10px 间隙。
  反向（把侧栏往内推）会毁掉"贴边"这个设计本身，所以让位的是导航轨。
- **主题零硬编码**。侧栏的**每一个颜色**都是 `--dsw-*` token，构建产物里
  「非 token 的颜色声明」为 0，由 `scripts/inspect-css.mjs` 每次构建时审计。
  滑块填充用 `--dsw-alias-bg-layer-3`（浅色 `#fff` / 深色 `#353638`），
  它自己随主题翻转，所以上面的文字和边框 token 在两套主题下都天然正确 ——
  侧栏样式里**一条深色模式覆盖规则都不需要**（审计输出 `dark-scheme selectors: 0`）。
- **不碰** LLM 路由、工具注册表、会话生命周期 —— `inject` 只声明 `settings` 与 `connection`。

#### 面板开合时的偏移：一个已修的坑

这里有一个必须说明的实现细节，因为它曾经是个真 bug。

**症状**：打开右侧栏再关闭后，侧栏停在屏幕中间，再也回不到边缘。

**根因**：AppFrame 自带 `transition: grid-template-columns`。早期实现监听 frame 的
style 变化后同步读 `getComputedStyle` —— 读到的是**过渡中间插值**；而过渡结束时
**不再产生任何 mutation 事件**，于是那个中间值被永久保留，inset 卡在面板打开时的宽度。

**修法**（两层，缺一不可）：

1. 改用 `ResizeObserver` 观测真实盒宽 —— 它在过渡的**每一帧**都触发，并在几何稳定时
   再触发一次，所以最后一次读取必然是终值；另加 `transitionend` 兜底。
2. **偏移由「面板是否打开」门控**，而不是由「量到的宽度是否非零」决定。关闭即 0。
   这让失效方向变安全：测量失败只会退到屏幕边缘，而不会把侧栏丢在屏幕中间。

**同时修掉的一个抖动**：偏移量取自**面板自身宽度**而非动画中的 grid 轨道。
ui-sidebar-right 的面板是 `position:absolute` + `translateX` 滑入的，其 rect 宽度恒定；
而轨道在打开瞬间是 0、随后才增长。若以轨道为准，偏移会在第一帧取到面板宽、
下一帧又跳回小值 —— 侧栏会向外一弹再缩回。以面板宽度为准则是**一次到位、全程不动**。

这两条都有针对性测试守着：
`scripts/test-frame.mjs`（几何算术，含"关闭后残留宽度不得变成偏移"）
与 `scripts/test-transition.mjs`（按真实事件顺序回放开合全过程并断言偏移不抖动）。

### 3. 设置页新增一个选项区

作为 `settings.section` 注册，即设置面板左侧导航里**独立的一行**（"额度监控"），
而不是挤在通用页的一行里。包含：

- **显示**：启用侧栏 / 显示百分比数字 / 悬停即展开 / 按名称排序
- **位置与外观**：贴靠边缘（左/右）/ 垂直位置（顶/居中/底）/ 静置透明度滑块 /
  **让开轮次导航条**（默认开：与 ui-chat 的轮次导航轨重叠时把导航轨向左推开，而不是遮住它）
- **数据**：刷新间隔滑块（15–600 秒）/ 立即刷新按钮
- **提供商**：勾选要显示的提供商，箭头调整顺序；每行显示**实时状态**
  （"28.6% 已用" / "未配置：Claude Code is not signed in"）

写入走**插件自己 entry 的配置**：DSH 0.1.7 起 `dsh-settings` 按 profile entry id 组织配置，
把该 entry 的 Config 里标了 `.volatile()` 的字段投影成设置页表单，写回 profile patch，
Loader 再把新值就地提交进同一批引用（`loader/volatile-update`），因此改设置不需要重启：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml（设置页写的就是这里）
- id: dsh-proxy-monitor
  config:
    anchor: right
    restingOpacity: 82
    providers:
      - deepseek
      - codex
      - workbuddy
      - antigravity
      - grok
    yieldToTurnNav: true
    # WorkBuddy 桌面端凭据路径与推理档位探测授权（同一 entry 内嵌）
    workbuddy:
      authFile: C:\Users\me\AppData\Roaming\WorkBuddy\auth.json
      probeConsent: false
```

## 架构

> 本节只讲**额度侧栏**这一半的数据流。合并后的全景（LLM 抢槽、活体模型目录、账户适配层、
> 设置页接管）以 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) 为准；下面是额度采集这一条的简化视图。

```
Host 侧 (src/index.ts)                      Browser 侧 (src/client/)
┌──────────────────────────────┐            ┌───────────────────────────┐
│ entry 配置（volatile Config） │            │ shell.overlay  ── QuotaRail│
│   dsh-proxy-monitor (live)   │            │   · 圆环 + 详情卡          │
│                              │            │   · frame.ts 读几何避让    │
│ QuotaCollector               │            │                           │
│   ├ deepseek.ts              │  POST      │ settings.section          │
│   ├ codex.ts                 │◄──────────►│   ── ProxyMonitorSettings │
│   ├ workbuddy.ts             │ /api/      │                           │
│   ├ antigravity.ts           │ proxy-     │ api.ts  ── fetch 调用      │
│   ├ grok.ts                  │ monitor/*  │                           │
│   └ claude.ts                │            │ 轮询：可见时按间隔拉取      │
│   （并发、隔离失败、带缓存）    │            │ 隐藏标签页不轮询            │
└──────────────────────────────┘            └───────────────────────────┘
```

- **凭据从不离开 Host**。浏览器侧只拿到数字，`reasonOf()` 还会把任何 token 形状的
  字符串从错误信息里剥掉，避免上游错误体把密钥泄进 UI、设置文档或日志。
- **并发采集 + 失败隔离**：每个 provider 独立 try/catch，一个挂掉只影响自己那一行。
- **缓存与合流**：宿主按 `refreshSeconds` 缓存快照，并发调用合流到同一次上游读取，
  避免多个标签页把限流的厂商用量端点打爆。
- **省电**：标签页隐藏时不轮询；可见性变化时立刻拉一次。

## 目录

> 下面是**额度侧栏**相关的文件。合并后的完整树（`src/accounts/`、`src/codex/`、`src/grok/`、
> `src/antigravity/`、`src/workbuddy/` 等）见 [`AGENTS.md`](./AGENTS.md) §4 与 [`docs/`](./docs/README.md)。

```
src/
  contract.ts              # Host↔Browser 的 JSON 契约（无密钥）
  geometry.ts              # 纯几何：面板宽度 → 侧栏偏移；轮次导航条的让位量（可真测）
  home.ts                  # DSH_HOME 解析
  collector.ts             # 并发采集 + 缓存 + 合流
  index.ts                 # Host：entry 配置（volatile）+ /api 路由 + collector
  providers/
    util.ts                # 有界 HTTP、形状探测、百分比/时间归一
    deepseek.ts codex.ts workbuddy.ts antigravity.ts grok.ts claude.ts
  client/
    index.tsx              # 注册 shell.overlay + settings.section
    QuotaRail.tsx/.module.css   # 侧栏本体（圆环 + 详情卡 + 边缘过渡形状）
    Settings.tsx/.module.css    # 设置页
    frame.ts               # DOM 量测：ResizeObserver + 结构变更 → geometry.ts
    turnnav.ts             # 找到 ui-chat 的轮次导航条并让它向左避让
    api.ts                 # /api/proxy-monitor/* 调用 + 错误解包
    icons.tsx              # 6 个提供商标记（currentColor）
scripts/
  build.mjs                # 一键构建：链接类型 → tsc → 三个测试 → tsdown → CSS 审计
  link-types.mjs           # 把 DSH 类型面 junction 进 node_modules
  test-frame.mjs           # 偏移与让位几何的算术测试（含两个回归）
  test-transition.mjs      # 按真实事件顺序回放开合，断言偏移不抖动
  preview-shape.mjs        # 把侧栏轮廓光栅化成 ASCII，免浏览器检查形状（含接缝相切断言）
  inspect-css.mjs          # 审计产物 CSS 是否全部走主题 token
  probe.mjs                # 直接跑一遍所有 provider，打印归一化快照
```

## 开发

```bash
npm install          # 一次性
npm run build        # 链接类型 → tsc → 三个测试 → tsdown → CSS 审计
npm test             # 只跑几何 + 过渡测试
npm run probe        # 不开浏览器，直接看各 provider 当前读到什么
npm run preview:shape # 把侧栏轮廓打印成 ASCII，检查边缘过渡形状
npm run typecheck    # 两半边的类型检查
```

构建产物：

- `lib/index.js` —— Host 半边（ESM，Node）
- `lib/client.js` —— 浏览器半边（`window.__ModuleLoader__.load` 包装的单个 CJS bundle，约 64 KB）
- `lib/types/**` —— 声明文件

改完 UI 后 `npm run build` 再热重载插件即可，宿主会把新的 bundle rev 推给浏览器。

`lib/` **已入库**（原因见 [`docs/INSTALL.md`](./docs/INSTALL.md) §10）：改完代码必须跑一次构建，
并把 `lib/` 的产物与源码一起提交，否则 git 源安装会拿到旧 bundle。

## 已知边界

- **Claude 在本机未登录**，所以默认显示为「未配置」的条目而不是隐藏它 —— 这样设置页能告诉用户
  「登录 Claude Code 就会出现这一行」。适配器已经写好，`~/.claude/.credentials.json` 一出现即生效。
- **Codex 当前 100% 已用**是真实读数（周额度耗尽），不是 bug。
- Anthropic 的用量端点有较严格的限流，这也是默认 60 秒轮询、隐藏标签页不轮询的原因；
  调低刷新间隔请自行斟酌。
- 侧栏在视口宽度 < 900px 时只显示圆环、不展开卡片（卡片没有地方放）。

## 设计取舍

- **复用而非重写**。Antigravity / WorkBuddy / Codex 的额度解析、项目 ID 解析、token 刷新都已经
  在各自插件里做过一遍，本插件的适配器优先消费它们的回环路由，只有在路由不可用时才直连上游。
  这样它们的字段解析改进会自动惠及这里，也不会产生第二套会漂移的实现。
- **Grok 走直读**。`dsh-grok-auth` 的用量接口挂在受浏览器鉴权保护的 Connection 通道上，
  服务端 fetch 拿不到，所以读同一份 auth 文档并调同一个只读端点。
  没有引入任何新的密钥存储位置。
- **WorkBuddy 的 `x0.79` 不当额度用**。那是**计费倍率**不是剩余量，
  拿它画环会给出错误结论；真正的额度是各计费包的 `remain/size`，倍率只作为细节展示。
- **百分比统一成「已用」**。各厂商有的报剩余、有的报已用；换算只发生在适配器边界，
  UI 永远只面对一个语义，避免某一行悄悄反向。
- **轮次导航条让位，而不是侧栏让位**。两者抢同一片像素。把侧栏往内推会直接毁掉"贴边"
  这个设计目标（那正是之前那张"浮在屏幕中间的卡片"的观感），而导航条左侧本来就有余量，
  推开的代价几乎为零 —— 所以移动的是它。用户也可以在设置里关掉这个行为。
