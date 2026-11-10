//! OTools 宿主桥：把「文件从哪来、存到哪去」换成 OTools 宿主的对话框与磁盘读写。
//!
//! 宿主注入 `window.otools`/`window.utools`（包装 API）以及 `window.__TAURI_INTERNALS__`
//! （原生 IPC）。本模块是插件需要新写的 Rust 代码；JS 侧实现见 shell/index.html 的
//! `window.otoolsPlugin`。
//!
//! 移植真实 egui 软件时：若上游的同步 read/write 在 wasm 下报错，把补丁（shell/patches/）
//! 接到这里——`cache_opened` 喂给上游的同步 read，`write_host_file` 经宿主落盘。

use base64::Engine as _;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::js_sys;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = otoolsPlugin, js_name = "available")]
    fn host_available() -> bool;

    #[wasm_bindgen(js_namespace = otoolsPlugin, js_name = "theme")]
    fn host_theme() -> String;

    /// 宿主界面语言（BCP 47，如 `zh-CN`）：OTools 注入到插件 webview 的
    /// `window.__OTOOLS_LOCALE__.locale` / `document.documentElement.lang`。
    #[wasm_bindgen(js_namespace = otoolsPlugin, js_name = "language")]
    fn host_language_raw() -> String;

    /// 写宿主磁盘文件：`{path, dataBase64}`。
    #[wasm_bindgen(js_namespace = otoolsPlugin, js_name = "writeHostFile")]
    fn host_write_file(path: &str, data_base64: &str) -> js_sys::Promise;

    /// 弹另存对话框，返回选中的路径（`null` = 用户取消）。
    #[wasm_bindgen(js_namespace = otoolsPlugin, js_name = "pickSavePath")]
    fn host_pick_save_path(name: &str) -> js_sys::Promise;
}

/// 宿主是否可用（不在 OTools 里时退回浏览器下载）。
pub fn available() -> bool {
    host_available()
}

/// OTools 的界面主题，用于给 egui 一个初始主题（`""` = 跟随系统）。
pub fn theme() -> String {
    host_theme()
}

/// 宿主界面语言（BCP 47，如 `zh-CN`）：跟随 OTools 宿主语言切换。
pub fn language() -> String {
    host_language_raw()
}

/// 另存为：弹宿主对话框，返回选中的路径；取消返回 `None`。
pub async fn pick_save_path(name: &str) -> Option<String> {
    let value = JsFuture::from(host_pick_save_path(name)).await.ok()?;
    if value.is_null() || value.is_undefined() {
        return None;
    }
    value.as_string()
}

/// 写宿主磁盘文件（path 由 `pick_save_path` 拿到）。
pub async fn write_host_file(path: &str, bytes: &[u8]) -> bool {
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    JsFuture::from(host_write_file(path, &data_base64)).await.is_ok()
}

/// 导出/保存：在 OTools 里弹宿主另存对话框落盘；宿主不可用时退回浏览器下载。
pub async fn save_text(name: &str, text: &str) -> bool {
    if available() {
        let Some(path) = pick_save_path(name).await else {
            return false;
        };
        return write_host_file(&path, text.as_bytes()).await;
    }
    crate::download::download(name, text.as_bytes()).is_ok()
}
