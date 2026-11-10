# 补丁（patches）模式

移植真实上游软件时，最常见的改动是：**让上游「以为自己在浏览器里」的代码，去用 OTools 宿主的文件系统**。上游在浏览器里通常没有真正的文件 I/O——打开靠 `<input type=file>`，保存/导出靠浏览器下载。宿主则提供了真正的文件对话框与磁盘读写（见 `shell/src/otools.rs` 的 `window.otoolsPlugin` 桥）。

`scripts/fetch-upstream.mjs` 会把 `shell/patches/*.patch` **幂等**地打到 `upstream/` 上。补丁不入库（随 `upstream/` 重拉而重放），所以「重拉不丢本地改动」。

## 典型补丁：把同步 read/write 接到宿主桥

很多 Rust 引擎在 wasm 下的 `read`/`write` 会直接报错（`"no file system in the browser"`）。切入点通常是引擎的文件命令模块。以 figcraft 的 `crates/engine/src/cmd/file.rs` 为例（**仅示意，按你上游的实际路径改**）：

1. 在文件命令模块加一个 wasm-only 的子模块 `host_io`（`mod host_io;` 是**文件式声明**，新文件必须放在 `cmd/file/host_io.rs`，即父文件同名子目录——不是 `cmd/host_io.rs`）：

   ```rust
   // crates/engine/src/cmd/file.rs（wasm32 下）
   #[cfg(target_arch = "wasm32")]
   pub mod host_io;
   ```

2. `host_io.rs` 用 `thread_local` 缓存「打开过的路径 → 字节」，并暴露 `cache_opened` / `write`：

   ```rust
   thread_local! {
       static OPENED: std::collections::HashMap<String, Vec<u8>> = Default::default();
   }
   pub fn cache_opened(path: &str, bytes: Vec<u8>) { OPENED.with(|m| { m.borrow_mut().insert(path.to_string(), bytes); }); }
   pub fn cache_get(path: &str) -> Option<Vec<u8>> { OPENED.with(|m| m.borrow().get(path).cloned()) }
   pub fn write(path: &str, bytes: Vec<u8>) {
       // 调 wasm-bindgen 桥 window.otoolsPlugin.writeHostFile(...)
   }
   ```

3. 改引擎的 wasm 版 `read`：先查 `host_io::cache_get(path)`，命中就用缓存字节，否则报错。`write` 改成 `host_io::write(path, bytes)`。

4. 在 `shell/src/main.rs` 的打开流程里，把宿主读到的字节 `host_io::cache_opened(path, bytes)` 喂回去，随后引擎同步 `read` 才能命中。

## 应用补丁

```bash
# 改完用 git diff 生成补丁（在 upstream/ 里）
cd upstream && git diff > ../shell/patches/my-hostio.patch && cd ..

# 验证能干净应用（CI 也是这么干的）
git apply --check shell/patches/my-hostio.patch
```

补丁幂等由 `fetch-upstream.mjs` 保证：应用前先 `git checkout -- . && git clean -fd` 清掉上次残留的未跟踪文件，避免 `git apply` 建同名新文件时报「已存在」而整片失败。
