//! 浏览器下载回退（宿主不可用时）：把字节通过 Blob + 临时 `<a download>` 交给用户。
//!
//! 移植上游软件时，把上游的浏览器下载逻辑原样放这里即可；宿主可用时不会走到这条。
use wasm_bindgen::JsCast as _;
use web_sys::js_sys;

/// 对象 URL 在点击后保持有效的时间；浏览器异步读取它。
const REVOKE_DOWNLOAD_MS: i32 = 40_000;

/// 触发一次浏览器下载，把 `bytes` 存为名为 `name` 的文件。
///
/// `Ok` 表示下载已被触发；最终落到哪（或用户是否取消浏览器「另存为」）由浏览器决定，
/// 页面侧无法观测。
pub fn download(name: &str, bytes: &[u8]) -> Result<(), wasm_bindgen::JsValue> {
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;
    let body = document.body().ok_or("no body")?;
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &{
        let o = web_sys::BlobPropertyBag::new();
        o.set_type("application/octet-stream");
        o
    })?;
    let url = web_sys::Url::create_object_url_with_blob(&blob)?;
    let a: web_sys::HtmlAnchorElement = document.create_element("a")?.dyn_into()?;
    a.set_href(&url);
    a.set_download(name);
    body.append_child(&a)?;
    a.click();
    a.remove();
    // 延后吊销：有些浏览器在下载真正开始前就把 URL 吊销会取消下载。
    let revoke = wasm_bindgen::closure::Closure::once_into_js(move || {
        let _ = web_sys::Url::revoke_object_url(&url);
    });
    let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(revoke.unchecked_ref(), REVOKE_DOWNLOAD_MS);
    Ok(())
}
