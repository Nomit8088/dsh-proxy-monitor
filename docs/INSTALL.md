# 安装与升级

本插件是**标准 DSH bundle 插件**：`package.json` 里 `dsh.bundle.patch` 指向 `cordis.patch.yml`（Host 行），
`dsh.client` 声明浏览器半边。装它的本质是「让 profile 依赖到它 + 让它成为 profile 的一层」。

**构建产物 `lib/` 已入库**，所以下面每一种方式都**不需要**本地构建、不需要 pnpm 构建脚本授权、也不需要 DSH 源码 checkout。

## 0. 前置条件

- 已安装 DSH，且能启动 web profile（`dsh web`）。本插件面向 Web Shell（`dsh.client.platform: "web"`）。
- 运行期只需要 `undici`（唯一真实依赖，安装时由包管理器带入）。
- 与四个旧插件的关系见 §8 —— 迁移前先读它。

## 1. 四种方式对照

| 方式 | 命令要点 | 适用场景 |
| --- | --- | --- |
| **A. `dsh plugin` + GitHub 源** | `dsh plugin --profile web add github:Nomit8088/dsh-proxy-monitor` | 推荐：一条命令，跟随 main |
| **B. `dsh plugin` + Release tgz** | `... add https://github.com/Nomit8088/dsh-proxy-monitor/releases/download/v0.2.1/dsh-external-dsh-proxy-monitor-0.2.1.tgz` | 固定产物、git 网络不稳、内网分发 |
| **C. 本地目录 link** | `... add link:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor` | 开发调试 |
| **D. 手写 profile 清单** | 直接编辑 `~/.dsh/profiles/web/package.json` | 声明式管理 / CLI 不可用 |

`dsh plugin --profile <name> <args...>` 的实现是**profile 目录里的 pnpm 转发器**：先在 `$DSH_HOME/profiles/<name>`
（默认 `~/.dsh/profiles/web`）跑 pnpm，然后按**安装结果**回填 `dsh.profile.bundles` —— 解析出的包只要声明了
`dsh.bundle` 就自动成为一层，被移除的依赖自动从层列表摘掉。所以 A/B/C 三种方式都不用手改 `bundles`。

> 相对路径按**你执行命令时所在的目录**锚定，而不是 profile 目录。所以在本仓库目录里 `dsh plugin --profile web add .`
> 链接的是当前 checkout，不会在 profile 里自我链接。

## 2. 方式 A：`dsh plugin` + GitHub 源（推荐）

```sh
dsh plugin --profile web add github:Nomit8088/dsh-proxy-monitor

# 钉具体版本（tag / commit 都行）
dsh plugin --profile web add github:Nomit8088/dsh-proxy-monitor#v0.2.1
dsh plugin --profile web add github:Nomit8088/dsh-proxy-monitor#<commit-sha>

# 换个 profile
dsh plugin --profile tui add github:Nomit8088/dsh-proxy-monitor
```

`dsh plugin` 把参数原样转给 pnpm，因此 pnpm 支持的 spec 都能用：`github:owner/repo[#ref]`、
`git+https://host/repo.git[#ref]`、`link:<dir>`、`file:<dir>`、`./pkg.tgz`、registry 名。

国内网络可以走 gh-proxy：

```sh
dsh plugin --profile web add git+https://gh-proxy.com/https://github.com/Nomit8088/dsh-proxy-monitor.git
```

装完**重启 `dsh web`**（bundle 层列表在启动时读取），然后看 §6 的三层验证。

## 3. 方式 B：Release 预打包 tgz

每个 tag 都会在 Release 里挂一个预打包的 npm 包（仓库自带 `.github/workflows/release.yml`：校验产物在 → `npm pack` → 挂附件）。
直接装附件：

```sh
dsh plugin --profile web add https://github.com/Nomit8088/dsh-proxy-monitor/releases/download/v0.2.1/dsh-external-dsh-proxy-monitor-0.2.1.tgz
```

这是最"钝"的一种：不碰 git、不需要 registry、产物可校验（Release 页有 shasum）。

不用 CI 也能发同样的产物（本地等价命令）：

```sh
npm pack
gh release create v0.2.1 ./dsh-external-dsh-proxy-monitor-0.2.1.tgz --title v0.2.1 --generate-notes
```

> tgz 文件名由 npm 生成：`@scope/name` → `scope-name-<version>.tgz`（去掉 `@`、`/` 换成 `-`）。
> 本包即 `dsh-external-dsh-proxy-monitor-<version>.tgz`。

也可以把 tgz 下载到本地再装：

```sh
dsh plugin --profile web add ./dsh-external-dsh-proxy-monitor-0.2.1.tgz
```

## 4. 方式 C：本地目录 link（开发）

```sh
dsh plugin --profile web add link:D:\dev\toolPrograms\dsh-plugin\dsh-proxy-monitor
# POSIX
dsh plugin --profile web add link:/root/dsh-proxy-monitor
```

`link:` 是软链，改完代码 `node scripts/build.mjs` 后重启（或在 DSH 会话里热重载 `dev_reload_package(packageName: "dsh-proxy-monitor")`）即生效。

想**完全不落盘**到 profile（纯运行时注入、卸载即净），用 dsh-super-injector 的工具链：
`dev_install_package`（写 profile 清单 + 建 junction + 动态加载）或 `dev_inject_plugin`（只动态加载）。

## 5. 方式 D：手写 profile 清单

`~/.dsh/profiles/web/package.json`：

```jsonc
{
  "dependencies": {
    "@dsh-external/dsh-proxy-monitor": "git+https://github.com/Nomit8088/dsh-proxy-monitor.git"
  },
  "dsh": {
    "profile": {
      // 追加到末尾：本插件依赖前面的 base / web-app 层
      "bundles": ["@dsh-external/dsh-proxy-monitor"]
    }
  }
}
```

然后在 profile 目录安装：

```sh
cd ~/.dsh/profiles/web && pnpm install
```

**两处缺一不可**：`dependencies` 决定包能否被解析到，`dsh.profile.bundles` 决定它是否成为 profile 的一层。
只加 `dependencies` 会装成一个"普通依赖"，插件的 Host 行不会被装上。

## 6. 安装后验证（三层，从里到外）

```sh
# 1) 合成树里有这一层（entry id 是 dsh-proxy-monitor）
dsh --profile web --dump-config | grep -i proxy-monitor
#    PowerShell: dsh --profile web --dump-config | Select-String proxy-monitor

# 2) profile 清单两处都在
#    ~/.dsh/profiles/web/package.json -> dependencies 与 dsh.profile.bundles

# 3) GUI
#    重启 dsh web，刷新页面：设置页出现「订阅反代」与「额度监控」；
#    有额度数据时侧栏出现圆环。
```

## 7. 升级、钉版本、卸载

```sh
# 升级到该分支最新
dsh plugin --profile web add github:Nomit8088/dsh-proxy-monitor

# 钉住某个版本 / 提交
dsh plugin --profile web add github:Nomit8088/dsh-proxy-monitor#v0.2.1

# 卸载（reconcile 会同时把它从 dsh.profile.bundles 摘掉）
dsh plugin --profile web remove @dsh-external/dsh-proxy-monitor

# 查当前装的是哪个版本 / 为什么在树里
dsh plugin --profile web why @dsh-external/dsh-proxy-monitor
```

同一个 git ref 再次 `add` 可能命中解析缓存；要强制取到新提交就 `#<commit-sha>`。
回滚 = `add` 一个旧的 tag 或 sha；回滚后同样要重启 `dsh web`。

## 8. 与四个旧插件的关系（迁移必读）

本插件**吸收并替代**了四个独立反代插件的能力（LLM Adapter 路由、生图、活体模型目录、账户/额度、专属设置页）：

`dsh-codex`、`dsh-grok-auth`、`dsh-antigravity`、`dsh-workbuddy-connect`

**不要与它们同时安装。** 两边都会注册同一批 provider 的 adapter 与设置区：本插件会走"抢槽"路径接管
（`installOrTakeOverAdapter` / `wrapAdapterCatalog`），最终归属取决于加载顺序 —— 症状是设置页出现重复条目、
模型目录在两套目录间来回跳、额度行重复。

迁移顺序：先卸旧的，再装本插件。

```sh
dsh plugin --profile web remove dsh-codex dsh-grok-auth dsh-antigravity dsh-workbuddy-connect
```

（包名以各自仓库为准；不存在的包会报错，但不影响其余参数，也可以一条条来。）

## 9. 故障排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 装完刷新页面没变化 | bundle 层列表在启动时读取 | 重启 `dsh web` |
| pnpm 提示 blocked build scripts | 本包**不需要**任何构建脚本（`lib/` 已入库，且没有 `prepare`） | 提示若来自别的插件，按 pnpm 输出的 key 加到 profile 的 `pnpm-workspace.yaml` → `allowBuilds`，或 `pnpm approve-builds`；本包请确认装的是仓库 / Release 产物 |
| `dsh: pnpm not found on PATH` | `dsh plugin` 是 pnpm 转发器 | 先装 pnpm |
| `lib/` 里只有几个文件 / 启动报模块找不到 | 装到了没有产物的源码快照（例如自己 fork 后清了 `lib/`） | 用本仓库或 Release 产物；自建见 §11 |
| 设置页有 provider 但没有账号行 | 该 provider 未登录/未配置 | 看设置页「订阅反代」每行的实时状态；WorkBuddy 依赖本地桌面端（必要时设 `WORKBUDDY_ELECTRON_BIN`） |
| 模型选择器里没有新模型 | 目录未刷新，或目录被其它插件接管 | 设置页刷新模型目录；确认 §8 的旧插件已卸载 |
| 侧栏圆环不出现 | 没有任何 provider 有数据 | 未登录任何 provider 时侧栏整体不渲染，这是设计行为 |

## 10. 为什么把 `lib/` 提交进仓库

这不是偷懒，是被环境逼出来的唯一可靠解：

1. **Host 半边编译需要 ~29 个 `@deepseek-ai/*` 类型面**，它们只存在于一台**已安装 DSH** 的机器上
   （`scripts/link-types.mjs` 按 `DSH_CHECKOUT` → `%APPDATA%\npm\node_modules\@deepseek-ai\dsh` → profile `node_modules`
   的顺序探测并建 junction）。把用户机器当成构建机不可靠。
2. **pnpm 默认拦截 git 依赖的构建脚本**（包括 `prepare`）。所以「装完自动构建」在用户侧要么被拦、要么静默不构建 —— 
   两种结果都很难诊断（插件装上了却没产物）。
3. 于是本包**不声明 `prepare`**，仓库里直接带一份可加载的产物。

维护者纪律：**每次发版前跑 `node scripts/build.mjs` 并提交 `lib/`**。发布流程只做"校验产物在 → 打包 → 挂 Release 附件"
（`.github/workflows/release.yml`，或在本地跑 §3 的两条命令），**任何地方都不重新构建** —— CI runner 上没有 DSH 类型面。

> 推送凭据需要 `workflow` scope 才能提交 `.github/workflows/*`。若被 GitHub 拒绝（`refusing to allow an OAuth App to create or update workflow`），
> 先 `gh auth refresh -h github.com -s workflow`，或在 GitHub 网页上直接创建该文件。

## 11. 自己构建（改代码 / 自建 fork）

```sh
npm install     # 一次性：devDeps = typescript / tsdown / react / lightningcss / @types/*
npm run build   # 链接 DSH 类型面 → tsc host → 类型检查 → 几何/过渡/账户测试 → tsdown client → CSS 审计
```

`npm test` 只跑测试；`npm run typecheck` 只做两半边的类型检查；`npm run preview:shape` 把侧栏轮廓打成 ASCII。
需要本机已安装 DSH（或设 `DSH_CHECKOUT` 指向 `@deepseek-ai/dsh` 包目录）。
