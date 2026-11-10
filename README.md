# OTools 插件模板 · `otools-plugin-template`

从这份模板起步，开发新 OTools 插件或把别的软件移植成插件，都能复用同一套**已验证的结构**：
宿主桥、`plugin.json` 清单、打包/校验脚本、以及「打 tag 即发布」的 CI。照着做就不会踩
移植 figcraft 时踩过的那些坑（宿主 I/O 桥接、CJK 字体、补丁幂等、release/market 配置）。

> 这份模板本身就是一个能直接 `node scripts/build-web.mjs` 跑起来的最小插件：
> `web/` 是「用户开发新插件」的纯前端示例，`shell/` 是「移植 Rust+WASM+egui 软件」的骨架。

---

## 两种用法

| 你要做 | 起点 | 构建模式 | 需要 Rust 工具链？ |
| --- | --- | --- | --- |
| 开发新插件（网页/前端） | `web/` | web | 否 |
| 移植别的 Rust+WASM+egui 软件 | `shell/` | rust | 是 |

脚本 `scripts/build-web.mjs` 是**唯一构建入口**，自动判断模式：
- 没有 `shell/Cargo.toml` → **web 模式**：把 `web/` 直接拷贝到 `dist/`。
- 有 `shell/Cargo.toml` → **rust 模式**：按 `upstream.pin` 拉上游 → 按需拉中文字体 → `trunk` 编译到 `dist/`。

---

## 目录结构

```
otools-plugin-template/
├── plugin.json            # 插件清单（宿主只认这个 + logo + dist）
├── logo.svg               # 插件图标（市场要求根目录有 logo.svg）
├── upstream.pin           # （移植时）上游 commit SHA，按需浅拉，不入库
├── cjk-fonts.pin          # （可选）中文字体仓库 commit SHA，按需浅拉，不入库
├── upstream/              # 上游源码（git 浅拉，.gitignore 忽略，**不入库**）
├── cjk-fonts/             # 中文字体（兄弟目录，不入库）
├── web/                   # 【新插件】纯前端示例，拷贝到 dist/
├── shell/                 # 【移植】Rust+WASM+egui 外壳（Cargo.toml.example 改名即用）
│   ├── Cargo.toml.example # 改名 Cargo.toml 后即为 rust 模式；已含最小 egui 应用
│   ├── Trunk.toml
│   ├── index.html         # window.otoolsPlugin 宿主桥（唯一要写的 JS）
│   ├── src/
│   │   ├── main.rs        # 最小 egui App：默认暗黑主题、跟随宿主语言、宿主存盘
│   │   ├── otools.rs      # wasm-bindgen 桥：available/theme/language/save_text
│   │   └── download.rs    # 宿主不可用时的浏览器下载回退
│   └── patches/           # 对上游的本地裁剪补丁（随 upstream 重拉而重放）
│       └── README.md      # 补丁模式说明（含把同步 read/write 接到宿主桥的示例）
├── scripts/               # 构建 / 打包 / 发布 / 验证（本模板的核心，基本不用改）
│   ├── build-web.mjs          # 唯一构建入口（web / rust 双模式）
│   ├── fetch-upstream.mjs     # 按 upstream.pin 浅拉上游（幂等打补丁）
│   ├── fetch-cjk-fonts.mjs    # 按需拉中文字体
│   ├── pack-plugin.mjs        # 打包 .oplg（手写 ZIP，不引第三方库）
│   ├── verify-plugin.mjs      # 校验 .oplg（ZIP/CRC、SHA256、入口桥、wasm）
│   ├── publish-market.mjs     # 上架市场（pat/oidc/login/shared 四种认证）
│   ├── publish-market.test.mjs
│   ├── release-policy.mjs     # 核验 tag 与构建提交一致（防覆盖发布）
│   ├── release-policy.test.mjs
│   └── serve-dist.mjs         # 本地预览 dist/
├── scripts/deploy-to-otools.ps1  # 同步到 otools 主仓库本地试跑
└── .github/workflows/     # 独立发布 CI
    ├── build-plugin.yml    # push/PR 时构建 dist/ 并上传
    └── release-plugin.yml  # 打 tag v* 或手动触发：构建+打包 .oplg+上架
```

---

## 快速开始（新插件 / web 模式）

```bash
# 1) 改 plugin.json：packid、displayName、uuid、key、summary、developerName
# 2) 在 web/ 里写你的前端（原生 JS / Vite / React 都行），入口是 web/index.html
# 3) 构建
node scripts/build-web.mjs
# 4) 本地预览
node scripts/serve-dist.mjs
# 5) 同步到 otools 仓库本地试跑（指向你本地的 OTools 主仓库）
pwsh -File scripts/deploy-to-otools.ps1 -OtoolsRoot /path/to/OTools
```

`web/index.html` 已经演示了怎么用宿主桥 `window.otoolsPlugin`：弹宿主文件对话框、读、写真实磁盘文件。
把那一段 UI 换成你自己的应用即可，无需任何打包步骤。

## 快速开始（移植 Rust+WASM 软件 / rust 模式）

```bash
# 1) 把 shell/Cargo.toml.example 改名为 Cargo.toml
#    （按需加 path 依赖指向 ../upstream/...，见文件内注释）
# 2) 准备上游 pin
echo '{"upstream":"owner/repo","ssh":"git@github.com:owner/repo.git",
       "https":"https://github.com/owner/repo.git","commit":"<40位SHA>"}' > upstream.pin
# 3) 若需要中文 UI，准备字体 pin（ArtCraft 家族用 storytold/craft-fonts）
echo '{"upstream":"storytold/craft-fonts","ssh":"git@github.com:storytold/craft-fonts.git",
       "https":"https://github.com/storytold/craft-fonts.git","commit":"<40位SHA>"}' > cjk-fonts.pin
# 4) 构建（会拉上游→拉字体→trunk 编译）
node scripts/build-web.mjs
# 5) 把 src/main.rs 里的 PluginApp::update 换成你上游 App 的 UI
```

工具链要求：rustc ≥ 1.95（egui 0.36；旧上游可调低 `MIN_RUSTC_MINOR`）、
wasm32-unknown-unknown 目标、trunk。

---

## 宿主桥（必须理解）

OTools 宿主给插件 webview 注入两条能力通道，**任一条通就算「在 OTools 里」**：

1. `window.otools` / `window.utools`：宿主包装 API
   - `dialog.open({filters})` / `dialog.save({defaultPath, filters})`
   - `readHostFile(path)` → `{ name, path, dataBase64 }`
   - `writeHostFile({ path, dataBase64 })`
2. `window.__TAURI_INTERNALS__.invoke`：Tauri 原生 IPC
   - `tools_webview_pick_files` / `tools_webview_read_file` / `tools_webview_pick_save_path` / `tools_webview_write_file`

本模板的 JS 桥统一暴露在 `window.otoolsPlugin`（web/index.html 与 shell/index.html），
Rust 侧通过 wasm-bindgen 调它（shell/src/otools.rs，`js_namespace = otoolsPlugin`）。
**两条通道都不通**（把 dist 拖进普通浏览器）就退回浏览器原生行为——所以插件在浏览器里也能跑，只是没有宿主文件能力。

> 踩坑提示：Tauri 的 `tools_webview_write_file` 收的是**名为 `request` 的结构体**，
> 平铺 `{path, dataBase64}` 会被拒（`missing required key request`）。模板里的 `writeHostFile`
> 已经处理好了，照抄即可。

---

## `plugin.json` 字段速查

| 字段 | 说明 |
| --- | --- |
| `packid` | 唯一 ID，字母数字加 `. _ -`，建议 `otools-xxx` |
| `uuid` | 与 packid 相同或独立 UUID，卸载/更新靠它 |
| `displayName` / `displayNameCN` | 中英文显示名 |
| `version` | 语义版本 `x.y.z`；**打 tag 必须与 `v<version>` 一致** |
| `entry` | 包内相对路径，通常是 `dist/index.html`（不能带 `/`、`.`、`..`） |
| `wasm` | 可选；设为 `true` 时校验会强制包内含 `.wasm`（纯前端插件不设置） |
| `icon` | emoji 或图标 |
| `key` | 搜索关键词（含中文，方便市场检索） |
| `summary` | 一句话简介，展示在市场卡片 |
| `devUrl` / `quickDev` | **仅本地调试用**；打包 .oplg 时会自动去掉（正式包不能启用开发模式，否则校验拒收） |
| `developerName` | 作者名 |

> 踩坑提示：`entry` 指向的文件必须真的在包里，且入口 HTML 必须包含宿主桥（verify 会查 `otools`）。

---

## 发布（打 tag 即上架）

CI 在 `.github/workflows/`：
- `build-plugin.yml`：push/PR 时构建 `dist/` 并上传产物。
- `release-plugin.yml`：
  - **push tag `v*`** → 自动构建 + 打包 `.oplg` + 创建 GitHub Release。
    - 市场是否上架取决于仓库变量 `vars.OTOOLS_PUBLISH_MARKET`：设 `true` 则连市场上架；
      不设则**只建 GitHub Release**（与 cadcraft 等现有插件默认一致）。
  - **手动 `workflow_dispatch`** → 可选 `publish_market: true` + `dry_run: false` 立即上架市场。

### 一次性配置（每个新插件仓库都要做）

```bash
# 1) 建仓库（公开，镜像 cadcraft 等）
gh repo create ootools/otools-<你的插件> --public \
  --description "..."

# 2) 配市场凭证（pat 模式）：先去 https://otools-api.lingyun.net 登录并生成 PAT，
#    复制到本地环境变量 XYCLOUD_PAT 后执行：
echo "$XYCLOUD_PAT" | gh secret set XYCLOUD_PAT --repo ootools/otools-<你的插件>

# 3) 建 release 环境（publish 作业需要；无保护规则即可）
echo '{}' | gh api -X PUT repos/ootools/otools-<你的插件>/environments/release --input -

# 4) （可选）让打 tag 自动上架市场
gh variable set OTOOLS_PUBLISH_MARKET --repo ootools/otools-<你的插件> --body true
```

> 踩坑提示：tag 必须与 `plugin.json` 的 `version` 一致（`v0.6.0` ↔ `0.6.0`），
> 否则 `release-plugin.yml` 的 meta 步直接报错。版本号是**唯一来源**，改它就要同步打新 tag。

### 本地手动上架（不重跑 CI）

如果只想把已发布的 `vX.Y.Z` Release 提交到市场，可用脚本直接跑（`XYCLOUD_PAT`
先在 https://otools-api.lingyun.net 生成）：

```bash
XYCLOUD_PAT=$XYCLOUD_PAT AUTH_MODE=pat \
OTOOLS_MARKET_API=https://otools-api.lingyun.net/api/v1/otools/plugin/publish \
GITHUB_REPOSITORY=ootools/otools-<你的插件> RELEASE_TAG=vX.Y.Z RELEASE_VERSION=X.Y.Z \
PLUGIN_MANIFEST=plugin.json node scripts/publish-market.mjs
```

---

## 多语言完整性（中文 UI）

- **宿主语言**：`window.otoolsPlugin.language()` 取 OTools 注入的 locale；切换语言时派发
  `otools-locale-changed` 事件。模板的 `main.rs` / `web/index.html` 都已经接好，照抄即可。
- **中文字体**：Rust+WASM 的 UI 库（egui 等）默认只带拉丁字形，不嵌中文字体会让浏览器里的
  中文显示为方框。构建期把 `CRAFT_FONTS_DIR` 指向 `../cjk-fonts` 并设 `FIGCRAFT_EMBED_CJK=1`
  即可嵌入（字体来自 `cjk-fonts.pin` 浅拉）。`build-web.mjs` 已处理；如果你的上游用别的
  环境变量控制字体嵌入，改 `build-web.mjs` 里对应两行。

---

## 移植时的补丁模式

上游在浏览器里通常没有真正的文件系统。把上游「以为自己在浏览器」的文件 I/O 接到宿主桥，
是移植最关键的改动。做法见 `shell/patches/README.md`：

- `scripts/fetch-upstream.mjs` 把 `shell/patches/*.patch` **幂等**地打到 `upstream/`。
- 补丁不入库（随 `upstream/` 重拉而重放），「重拉不丢本地改动」。

> **两个最容易错的坑（已经帮你踩平了）：**
> 1. Rust 文件式模块 `mod host_io;` 解析为 `cmd/file/host_io.rs`（父文件同名子目录），
>    不是 `cmd/host_io.rs`。补丁里新文件放错目录会导致「找不到模块」。
> 2. `git apply` 在「上游残留未跟踪新文件」时会整片失败（建同名文件报已存在），导致
>    补丁看似打了实则没改。模板的 `fetch-upstream.mjs` 应用前先
>    `git checkout -- . && git clean -fd` 清场，已规避。

---

## 本地开发 & 试跑

```bash
node scripts/build-web.mjs            # release
node scripts/build-web.mjs --debug    # 带调试符号
node scripts/serve-dist.mjs           # 本地预览 dist/
pwsh -File scripts/deploy-to-otools.ps1 -OtoolsRoot /path/to/OTools   # 同步到 otools 主仓库本地试跑
```

也可以本地打包校验一遍，确认能发布：

```bash
node scripts/pack-plugin.mjs --out dist-pack --version 0.1.0
node scripts/verify-plugin.mjs dist-pack
```

---

## 做成 GitHub 模板仓库

本仓库建议标记为 **Template repository**（在仓库 Settings 里开启，或 `gh api -X PATCH
repos/ootools/otools-plugin-template -f is_template=true`）。以后「Use this template」即可
一键得到一份干净的起点，不会带上你某个具体插件的提交历史。
