# UI_STYLE.md — 页面风格规范

设置页、侧栏圆环、模型目录必须看起来像**同一个产品**，而不是四家旧插件拼在一起。
新增订阅只许往现有壳里填内容，不许另起一套视觉。

---

## 1. 两条铁律

### 1.1 能力即数据

登录 / 重新登录 / 退出 **严禁** 按 provider id 写死。

按钮显隐只看 `AccountAdapter.account()` 带回的：

| 字段 | 含义 | 例 |
| --- | --- | --- |
| `canLogout` | 本插件能否结束会话 | WorkBuddy = `false` |
| `canReauth` | 已登录是否仍允许再走登录 | Codex / Grok / Antigravity = `true` |
| `login.kind` | 用户要做的事 | `none` / `browser` / `device` / `device-request` / `cli` |

`AccountBlock` 是唯一登录控件。侧栏详情卡和设置页必须共用它。

### 1.2 只使用 `--dsw-*` 色板

CSS Modules 里的颜色、边框、阴影、字色全部走 DSH alias token（`--dsw-alias-*`、`--dsw-elevation-*`、`--dsw-shadow-*`）。

- 禁止 hex / rgb 当主题色（阴影 alpha 除外，见圆环）。
- 禁止 `body[data-ds-dark-theme]` 覆盖来「修暗色」——填色用 `bg-layer-*` 后，字色 token 会自己翻转。
- 构建脚本会审计 client 包里的非 token 颜色；新文件必须过这道门。

字号习惯：标题 13px / 600，说明 12px，meta / note 11px。圆角 6–8px（面板），圆环详情卡 14px。

---

## 2. 信息架构

设置里只有 **一个** `settings.section`（「订阅反代」）。内部是 Tab，不是四个导航项。

```
SectionShell
├── Tab 条（Codex / Antigravity / WorkBuddy / Grok）
├── AccountBlock          ← 登录态，所有 Tab 共用组件
├── QuotaPanel            ← 该家额度窗口，数据来自 collector
└── tabs.tsx 的 render()  ← 只放这家专属字段（模型目录、Codex 代理等）
```

新增订阅：

1. `src/client/accounts/tabs.tsx` 加一项。
2. `src/client/<id>/<Id>SettingsPanel.tsx` 主要渲染 `ModelCatalogPanel`，不要自绘勾选列表。
3. 登录 UI 不要写在 Tab 里——壳已经画了 `AccountBlock`。

侧栏 `QuotaRail` 展开卡同样嵌 `AccountBlock`，文案和按钮与设置页一致。

---

## 3. 必须复用的组件

| 组件 | 用途 | 不要做的事 |
| --- | --- | --- |
| `AccountBlock` | 登录/登出/设备码/浏览器等待 | 按 id 分支；展示 token |
| `QuotaPanel` | 设置页额度条 | 前端另打上游；失败显示 0% |
| `ModelCatalogPanel` | 启用 + 「支持图像」 | 每家自己做一套 checkbox 表 |
| `catalogRequest` | `{ ok, value }` 目录信封 | 直接 `fetch` 旧包 path |
| `QuotaRail` | 圆环 + 舌状连接 + 详情卡 | 再做一个悬浮球 |

`ModelCatalogPanel` 的默认说明已经写明：

- 列表从账号动态拉，不写死。
- 勾选后出现在 DSH 模型选择器。
- 勾选「支持图像」后 DSH 不会把图片拦截成文本。
- 勾选即保存；须**重新打开**模型选择器才看得到。

各家只覆盖 `note` / `empty`，不改交互。

---

## 4. 模型目录行

一行三个控件，顺序固定：

1. 启用 checkbox（进对话选择器）
2. 名称 + 一行 meta（id · ctx · credits / thinking）
3. 「支持图像」checkbox

禁用行 `opacity: 0.62`，不要从 DOM 删掉——用户要能再勾回来。

忙碌时两个 checkbox 和「刷新模型」一起 `disabled`。错误用 `--dsw-alias-state-error-primary` 写在面板底部，不要 toast 一套新样式。

---

## 5. 侧栏圆环

几何与过渡的唯一实现是 `QuotaRail.module.css`，断言在 `scripts/preview-shape.mjs`。改形状先改 CSS 变量再改脚本里的常量，两边必须一致。

| 旋钮 | 作用 |
| --- | --- |
| `--dsh-pm-radius` | 滑块内侧圆角 |
| `--dsh-pm-scoop` | 上下凹形收进屏幕边缘的垂直跨度（越长越缓） |
| `--dsh-pm-card-gap` | 详情卡与滑块的可见间隙，也是舌片水平跨度 |
| `--dsh-pm-tongue-height` / clip-path 的 `C` | 舌片高度与腰线。腰越浅、桥越长，过渡越柔和 |

约束：

- 外侧贴边、直角；内侧才圆。外侧圆角会在屏幕边缘留一道应用背景缺口。
- 舌片用 `clip-path` + smoothstep，两端相切；阴影只打在 `.card` 上，不要 `filter: drop-shadow` 包住舌片。
- 圆环颜色按消耗：&lt;75% 绿、≥75% 琥珀、≥90% 红；无数据 `idle`。
- overlay 层默认 click-through，只有滑块自己 `pointer-events: auto`。

---

## 6. Client 纯洁度

`src/client/**` 里：

- 只 `import` React 和已写入 `dsh.client.inject` 的平台包。
- 不要 `import` `src/codex/adapter.ts` 这类 Host 模块。
- CSS 文件名 `*.module.css`，class 经 `import css from './X.module.css'`。

新增平台包必须先改 `package.json` 的 inject 表，否则 tsdown 门禁失败。

---

## 7. 文案

- 用户可见中文；协议字段、路由、模型 id 保持原样。
- 不提供做不到的按钮。`login.kind === 'none'` 只显示 `reason`。
- 刷新失败保留上一份目录并展示 error，不要清空列表装成「暂无模型」。
