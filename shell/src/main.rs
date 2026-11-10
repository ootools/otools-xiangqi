//! OTools 插件外壳模板（Rust+WASM+egui）。
//!
//! 这是「移植别的软件」的最小可编译骨架：一个 egui 应用，通过 `mod otools` 桥接 OTools
//! 宿主的文件对话框与磁盘读写，默认暗黑主题、跟随宿主语言。
//!
//! 移植真实 egui 软件时：
//!   1. 在 Cargo.toml 加 path 依赖指向 ../upstream/...（见 shell/Cargo.toml.example 注释）。
//!   2. 把下面 `PluginApp::update` 换成你上游 App 的 `ui`（或 new 一个你的 App 类型）。
//!   3. 若上游的同步文件 read/write 在 wasm 下不可用，按 shell/patches/README.md 打补丁
//!      把 I/O 接到 `otools::` 桥。

#[cfg(target_arch = "wasm32")]
mod download;
#[cfg(target_arch = "wasm32")]
mod otools;

#[cfg(target_arch = "wasm32")]
mod web {
    use eframe::egui;
    use wasm_bindgen::JsCast as _;
    use wasm_bindgen::closure::Closure;

    const CANVAS_ID: &str = "otools_canvas";
    const LOADING_ID: &str = "otools_loading";

    thread_local! {
        /// 宿主语言切换后下一帧重渲染。
        static NEEDS_LANG_SYNC: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
        /// 缓存 egui Context，供语言切换事件触发重绘。
        static APP_CTX: std::cell::RefCell<Option<egui::Context>> = std::cell::RefCell::new(None);
    }

    /// 最小示例 App：编辑一段文本，用宿主对话框存盘。把这段换成你的上游 App 即可。
    pub struct PluginApp {
        text: String,
    }

    impl Default for PluginApp {
        fn default() -> Self {
            Self { text: "在 OTools 插件里编辑，用宿主对话框存盘。".into() }
        }
    }

    impl eframe::App for PluginApp {
        fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
            APP_CTX.with(|c| *c.borrow_mut() = Some(ctx.clone()));
            if NEEDS_LANG_SYNC.with(|f| f.replace(false)) {
                let host = crate::otools::language();
                if !host.is_empty() {
                    ctx.request_repaint();
                }
            }
            egui::CentralPanel::default().show(ctx, |ui| {
                ui.heading("My OTools Plugin");
                ui.label("这是 Rust+WASM+egui 插件模板。把 PluginApp::update 换成你的上游 App 即可。");
                ui.text_edit_multiline(&mut self.text);
                if ui.button("保存到宿主…").clicked() {
                    let name = "hello.txt".to_string();
                    let text = self.text.clone();
                    let ctx2 = ctx.clone();
                    wasm_bindgen_futures::spawn_local(async move {
                        if crate::otools::save_text(&name, &text).await {
                            ctx2.request_repaint();
                        }
                    });
                }
            });
        }
    }

    fn query_param(key: &str) -> Option<String> {
        web_sys::window()
            .and_then(|w| w.location().search().ok())
            .and_then(|q| web_sys::UrlSearchParams::new_with_str(&q).ok())
            .and_then(|p| p.get(key))
    }

    fn apply_theme(ctx: &egui::Context, theme: &str) {
        match theme {
            "light" => ctx.set_visuals(egui::Visuals::light()),
            _ => ctx.set_visuals(egui::Visuals::dark()),
        }
    }

    pub fn start() {
        eframe::WebLogger::init(log::LevelFilter::Info).ok();
        wasm_bindgen_futures::spawn_local(async {
            let Some(document) = web_sys::window().and_then(|w| w.document()) else {
                log::error!("no document");
                return;
            };
            let Some(canvas) = document.get_element_by_id(CANVAS_ID).and_then(|e| e.dyn_into::<web_sys::HtmlCanvasElement>().ok()) else {
                log::error!("missing <canvas id=\"{CANVAS_ID}\">");
                return;
            };
            let mut options = eframe::WebOptions::default();
            if web_sys::window()
                .and_then(|w| w.location().search().ok())
                .map(|q| q.contains("webgl"))
                .unwrap_or(false)
                && let eframe::egui_wgpu::WgpuSetup::CreateNew(create) = &mut options.wgpu_options.wgpu_setup
            {
                create.instance_descriptor.backends = eframe::wgpu::Backends::GL;
            }
            let result = eframe::WebRunner::new()
                .start(
                    canvas,
                    options,
                    Box::new(|cc| {
                        let mut app = PluginApp::default();
                        // 默认暗黑主题：跟随 OTools 宿主主题，否则 ?theme= 覆盖，再否则暗黑。
                        let theme = match crate::otools::theme() {
                            t if !t.is_empty() => t,
                            _ => query_param("theme").unwrap_or_else(|| "dark".into()),
                        };
                        apply_theme(&cc.egui_ctx, &theme);
                        Ok(Box::new(app))
                    }),
                )
                .await;
            if let Some(el) = document.get_element_by_id(LOADING_ID) {
                match result {
                    Ok(()) => el.remove(),
                    Err(e) => el.set_inner_html(&format!("<p>启动失败：{e:?}</p><p>需要支持 WebGPU 或 WebGL2 的浏览器。</p>")),
                }
            }
            install_locale_listener();
        });
    }

    /// 监听宿主语言切换（OTools 注入的 `otools-locale-changed` 事件），置位标志并请求重绘。
    fn install_locale_listener() {
        let Some(window) = web_sys::window() else { return };
        let closure = Closure::wrap(Box::new(|| {
            NEEDS_LANG_SYNC.with(|f| f.set(true));
            if let Some(ctx) = APP_CTX.with(|c| c.borrow().clone()) {
                ctx.request_repaint();
            }
        }) as Box<dyn FnMut()>);
        let _ = window.add_event_listener_with_callback(
            "otools-locale-changed",
            closure.as_ref().unchecked_ref::<js_sys::Function>(),
        );
        closure.forget();
    }
}

#[cfg(target_arch = "wasm32")]
fn main() {
    web::start();
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    eprintln!("本插件只在浏览器里运行：在 shell/ 目录用 `trunk build --release` 构建");
}
