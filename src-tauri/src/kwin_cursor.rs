//! The global cursor position on KDE Plasma (Wayland), for hover-fade and for dragging the pet.
//!
//! Wayland gives apps no global cursor position. KWin always knows it: while it is needed, a small
//! KWin script sends it to this app over D-Bus (`io.github.WuwaTappo`).
//!
//! - Hover-fade: it is forwarded to the pet page as the same `cursor` event the X11 build polls for
//!   (a click-through pet gets no pointer events, and WebKitGTK's `:hover` can stick).
//! - Dragging: the page only sees positions relative to the pet's own surface, which moves with the
//!   drag, so its deltas fall short and the pet trails the cursor. While dragging, the pet is put at
//!   its start position plus how far the cursor has moved since.
//!
//! Everything runs on Tauri's (Tokio) async runtime; nothing here blocks.

use crate::{Shared, PET_LABEL};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Monitor};
use zbus::Connection;

const SERVICE: &str = "io.github.WuwaTappo";
const PATH: &str = "/Cursor";
const INTERFACE: &str = "io.github.WuwaTappo.Cursor";
const SCRIPT_NAME: &str = "wuwa-tappo-cursor";

static CONNECTION: OnceLock<Connection> = OnceLock::new();
/// Whether the KWin script should be (and, once the call went out, is) loaded.
static ACTIVE: AtomicBool = AtomicBool::new(false);
static DRAG: Mutex<Option<Drag>> = Mutex::new(None);

struct Drag {
	monitor: Monitor,
	size: (f64, f64),
	/// The cursor and the pet's top-left when the first cursor position of the drag arrived.
	anchor: Option<((f64, f64), (f64, f64))>,
}

/// Sends the cursor at most once per frame (KWin reports every pointer motion). KWin only runs the
/// reply callback on success, so if the app was killed without unloading the script, the script
/// stops itself once a call has gone unanswered for a few seconds.
fn script() -> String {
	format!(
		r#"let waitingSince = 0
const timer = new QTimer()
timer.singleShot = true
timer.interval = 16
timer.timeout.connect(() => {{
	if (waitingSince && Date.now() - waitingSince > 3000) return workspace.cursorPosChanged.disconnect(moved)
	if (!waitingSince) waitingSince = Date.now()
	const cursor = workspace.cursorPos
	callDBus("{SERVICE}", "{PATH}", "{INTERFACE}", "Move", cursor.x + "," + cursor.y, () => {{ waitingSince = 0 }})
}})
function moved() {{
	if (!timer.active) timer.start()
}}
workspace.cursorPosChanged.connect(moved)
timer.start()
"#
	)
}

struct Cursor {
	app: AppHandle,
	shared: Shared,
}

#[zbus::interface(name = "io.github.WuwaTappo.Cursor")]
impl Cursor {
	/// The cursor in KWin's global logical coordinates, as "x,y".
	#[zbus(name = "Move")]
	fn moved(&self, position: &str) -> bool {
		if !ACTIVE.load(Ordering::Relaxed) {
			return true;
		}
		let Some((x, y)) = position.split_once(',').and_then(|(x, y)| Some((x.parse::<f64>().ok()?, y.parse::<f64>().ok()?)))
		else {
			return true;
		};
		if let Some(drag) = DRAG.lock().unwrap().as_mut() {
			match drag.anchor {
				None => drag.anchor = crate::wayland::origin().map(|origin| ((x, y), origin)),
				Some(((press_x, press_y), (left, top))) => {
					let target = (left + x - press_x, top + y - press_y);
					crate::wayland::move_to(&self.app, &drag.monitor, drag.size, target);
				}
			}
		}
		// The pet's top-left in the same logical coordinates, kept current while it is dragged.
		let Some((left, top)) = crate::wayland::origin() else { return true };
		self.shared.pet.lock().unwrap().tracking_cursor = true;
		let _ = self.app.emit_to(PET_LABEL, "cursor", json!({ "x": x - left, "y": y - top }));
		// The reply tells the script the app is still alive.
		true
	}
}

/// Whether this is a KDE Plasma session (where KWin scripting exists).
pub fn available() -> bool {
	std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|desktop| desktop.to_uppercase().contains("KDE"))
}

/// Publishes the D-Bus service the script talks to. A no-op outside KDE.
pub fn start(app: &AppHandle, shared: &Shared) {
	if !available() {
		return;
	}
	let cursor = Cursor { app: app.clone(), shared: shared.clone() };
	tauri::async_runtime::spawn(async move {
		let built = async {
			zbus::connection::Builder::session()?.name(SERVICE)?.serve_at(PATH, cursor)?.build().await
		}
		.await;
		match built {
			Ok(connection) => {
				let _ = CONNECTION.set(connection.clone());
				// A crash may have left the script loaded by a previous run.
				let _ = unload_script(&connection).await;
				if ACTIVE.load(Ordering::Relaxed) {
					let _ = load_script(&connection).await;
				}
			}
			Err(error) => eprintln!("hover-fade: D-Bus service unavailable ({error})"),
		}
	});
}

async fn kwin(connection: &Connection, path: &str, interface: &str, method: &str, body: &(impl serde::Serialize + zbus::zvariant::DynamicType)) -> zbus::Result<zbus::Message> {
	connection.call_method(Some("org.kde.KWin"), path, Some(interface), method, body).await
}

async fn load_script(connection: &Connection) -> zbus::Result<()> {
	// KWin reads the file itself, so it lives somewhere both can see (not a sandboxed TMPDIR) and
	// stays there: KWin may only read it when the script starts.
	let directory = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("wuwa-tappo");
	let file = directory.join(format!("{SCRIPT_NAME}.js"));
	std::fs::create_dir_all(&directory)
		.and_then(|()| std::fs::write(&file, script()))
		.map_err(|error| zbus::Error::Failure(error.to_string()))?;
	unload_script(connection).await?;
	let reply = kwin(connection, "/Scripting", "org.kde.kwin.Scripting", "loadScript", &(file.to_string_lossy().as_ref(), SCRIPT_NAME)).await?;
	let id: i32 = reply.body().deserialize()?;
	if id < 0 {
		return Err(zbus::Error::Failure("KWin refused the script".into()));
	}
	kwin(connection, &format!("/Scripting/Script{id}"), "org.kde.kwin.Script", "run", &()).await?;
	Ok(())
}

async fn unload_script(connection: &Connection) -> zbus::Result<()> {
	kwin(connection, "/Scripting", "org.kde.kwin.Scripting", "unloadScript", &(SCRIPT_NAME,)).await?;
	Ok(())
}

/// Starts following the cursor for a drag; until its first position arrives, the caller moves the
/// pet itself. Returns true once the cursor drives the drag (the caller then ignores its deltas).
pub fn drag(monitor: Monitor, size: (f64, f64)) -> bool {
	if CONNECTION.get().is_none() {
		return false;
	}
	let mut drag = DRAG.lock().unwrap();
	if let Some(drag) = drag.as_ref() {
		return drag.anchor.is_some();
	}
	*drag = Some(Drag { monitor, size, anchor: None });
	drop(drag);
	set_active(true);
	false
}

/// Ends a drag; true if one was running.
pub fn end_drag() -> bool {
	DRAG.lock().unwrap().take().is_some()
}

pub fn dragging() -> bool {
	DRAG.lock().unwrap().is_some()
}

/// Loads or unloads the script when it starts or stops being needed. Cheap to call often.
pub fn set_active(active: bool) {
	if ACTIVE.swap(active, Ordering::Relaxed) == active {
		return;
	}
	let Some(connection) = CONNECTION.get().cloned() else { return };
	tauri::async_runtime::spawn(async move {
		let result = if active { load_script(&connection).await } else { unload_script(&connection).await };
		if let Err(error) = result {
			eprintln!("hover-fade: KWin script {} failed ({error})", if active { "load" } else { "unload" });
		}
	});
}

/// Removes the script on quit; KWin would otherwise keep it until it restarts.
pub fn stop() {
	if !ACTIVE.swap(false, Ordering::Relaxed) {
		return;
	}
	if let Some(connection) = CONNECTION.get().cloned() {
		let _ = tauri::async_runtime::block_on(unload_script(&connection));
	}
}
