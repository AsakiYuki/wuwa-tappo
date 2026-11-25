//! Online mode: the app's only network access, a client for the Kuro Games Wuwa Tappo server.
//!
//! Off by default (`onlineMode` setting). While it is off, `request` refuses to touch the network, so
//! the offline app never talks to anyone. The pages never see the login token: it is stored here
//! (`online.json`, next to the save but not inside it, so exporting a save cannot leak it) and added
//! to requests by this side.
//!
//! Provenance: the host, the routes, the envelope (`{ code, message, data }`, success when `code` is
//! 0 or 200), the `Authorization: Bearer` header, `X-BLM-FRID`, `X-BLM-CID` (the `x-request-id` of the
//! first successful reply, sent on every later request, empty before that; the client's first request
//! is `api/common/activity-config`) and the logout on codes 10002/10003 are from the real client's
//! bundle (extracted-frontend `index-*.js`, build 1.0.5). The browser-style headers (`Origin`,
//! `Referer`, `User-Agent`, `Accept*`) are assumed; see `BROWSER_ORIGIN`. Reply bodies of
//! most routes are still unchecked against live traffic.
//!
//! To record real replies for checking the shapes the renderer expects, start the app with
//! `WUWA_TAPPO_ONLINE_SAMPLES=1`: each reply's raw JSON is then written to `online-samples/` in the
//! save folder (never the login replies, which carry the token). The samples hold account data;
//! look before sharing one.

mod login;
mod room;

use crate::{setting_bool, settings, Shared, STUDIO_LABEL};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// Where the original client sends every request (`ApiHost` in its bundle, build 1.0.5). This is the only place to change it.
pub(crate) const API_HOST: &str = "https://api-wutheringwaves-wuwatappo.kurogames-global.com";
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const SAMPLES_ENV: &str = "WUWA_TAPPO_ONLINE_SAMPLES";

#[derive(Clone, Copy, PartialEq)]
enum TokenEffect {
	None,
	/// The reply carries a new login token to keep.
	Store,
	/// The session ends whatever the reply says.
	Clear,
}

struct Route {
	method: &'static str,
	path: &'static str,
	token: TokenEffect,
	/// Whether the stored token is sent. The login routes start a session, so they send none.
	authenticated: bool,
}

const fn route(method: &'static str, path: &'static str, token: TokenEffect, authenticated: bool) -> Route {
	Route { method, path, token, authenticated }
}

/// Every route the pages may call, and nothing else. The passport login (`api/auth/login`,
/// `api/auth/player/query`) is not here: it needs the passport token, which only `login` (fed by the
/// browser callback) holds, so the pages cannot call it.
const ROUTES: &[Route] = &[
	route("POST", "api/auth/uid-send-code", TokenEffect::None, false),
	route("POST", "api/auth/uid-login", TokenEffect::Store, false),
	route("GET", "api/frontend/user/me", TokenEffect::None, true),
	route("GET", "api/frontend/user/renew-token", TokenEffect::Store, true),
	route("POST", "api/frontend/user/logout", TokenEffect::Clear, true),
	route("GET", CLIENT_ID_PATH, TokenEffect::None, false),
	route("GET", "api/common/atlas", TokenEffect::None, true),
	route("POST", "api/frontend/bags/list", TokenEffect::None, true),
	route("POST", "api/frontend/chests/open", TokenEffect::None, true),
	route("POST", "api/frontend/redeems/use", TokenEffect::None, true),
	route("POST", "api/frontend/rooms", TokenEffect::None, true),
	route("POST", "api/frontend/rooms/join", TokenEffect::None, true),
	route("POST", "api/frontend/rooms/random-join", TokenEffect::None, true),
	route("POST", "api/frontend/rooms/public", TokenEffect::None, true),
	// Appearance, presets, favorites and synthesis: wrappers `updateUserAppearance`, `getPresetList`,
	// `createPreset`, `deletePreset`, `favoriteAsset`, `unfavoriteAsset`, `synthesisAtlas`,
	// `synthesisAtlasSame` in the original bundle (build 1.0.5). Reply shapes are unchecked.
	route("PUT", "api/frontend/user/me/appearance", TokenEffect::None, true),
	route("GET", "api/frontend/presets", TokenEffect::None, true),
	route("POST", "api/frontend/presets", TokenEffect::None, true),
	route("DELETE", "api/frontend/presets", TokenEffect::None, true),
	route("POST", "api/frontend/assets/favorites", TokenEffect::None, true),
	route("POST", "api/frontend/assets/favorites/cancel", TokenEffect::None, true),
	route("POST", "api/frontend/assets/synthesis", TokenEffect::None, true),
	route("POST", "api/frontend/assets/synthesis/same-level", TokenEffect::None, true),
];

/// The route the original client calls at startup; its reply is what first gives it an `X-BLM-CID`.
const CLIENT_ID_PATH: &str = "api/common/activity-config";
const LOGIN_PATH: &str = "api/auth/uid-login";
const LOGOUT_PATH: &str = "api/frontend/user/logout";

fn find_route(method: &str, path: &str) -> Option<&'static Route> {
	ROUTES.iter().find(|route| route.method == method && route.path == path)
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
	token: Option<String>,
	/// The tap total when this session started or its clicks were last reported. Taps since then are
	/// the clicks the server has not seen.
	baseline: u64,
	/// `X-BLM-CID`: the `x-request-id` of the first successful reply, kept for every later request.
	#[serde(default)]
	client_id: Option<String>,
}

pub(crate) struct Online {
	file: PathBuf,
	saved: Mutex<Saved>,
	/// The browser login in progress (see `login`). Memory only.
	flow: login::FlowState,
}

impl Online {
	pub(crate) fn new(directory: &Path) -> Self {
		let file = directory.join("online.json");
		let saved = std::fs::read_to_string(&file).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
		Online { file, saved: Mutex::new(saved), flow: Default::default() }
	}

	fn persist(&self, saved: &Saved) {
		let write = || -> std::io::Result<()> {
			use std::io::Write;
			let temp = self.file.with_extension("json.tmp");
			let mut options = std::fs::OpenOptions::new();
			options.write(true).create(true).truncate(true);
			#[cfg(unix)]
			std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
			options.open(&temp)?.write_all(serde_json::to_string(saved)?.as_bytes())?;
			std::fs::rename(temp, &self.file)
		};
		if let Err(error) = write() {
			eprintln!("online: could not save the session: {error}");
		}
	}

	fn token(&self) -> Option<String> {
		self.saved.lock().unwrap().token.clone()
	}

	fn client_id(&self) -> String {
		self.saved.lock().unwrap().client_id.clone().unwrap_or_default()
	}

	/// Keeps the first usable id only, as the original client does.
	fn remember_client_id(&self, id: &str) {
		let mut saved = self.saved.lock().unwrap();
		if saved.client_id.is_none() && valid_client_id(id) {
			saved.client_id = Some(id.to_string());
			self.persist(&saved);
		}
	}

	fn set_session(&self, token: Option<String>, total_taps: u64) {
		let mut saved = self.saved.lock().unwrap();
		saved.token = token;
		saved.baseline = total_taps;
		self.persist(&saved);
	}

	/// Taps since the session started. A save that went backwards (reset, import) pulls the baseline
	/// down with it, so new taps are not hidden behind a stale one.
	fn pending(&self, total_taps: u64) -> u64 {
		let mut saved = self.saved.lock().unwrap();
		if saved.token.is_none() {
			return 0;
		}
		if total_taps < saved.baseline {
			saved.baseline = total_taps;
			self.persist(&saved);
		}
		total_taps - saved.baseline
	}
}

fn total_taps(shared: &Shared) -> u64 {
	shared.state.lock().unwrap().counts.1.as_u64().unwrap_or(0)
}

fn fail(error: impl Into<String>) -> Value {
	json!({ "ok": false, "error": error.into() })
}

/// What a route's reply means: the data on success, else the server's message.
fn read_envelope(status: u16, body: &str) -> Result<Value, String> {
	let envelope: Value = serde_json::from_str(body).map_err(|_| format!("HTTP {status}"))?;
	let code = envelope["code"].as_i64().unwrap_or(i64::from(status));
	if code != 0 && code != 200 {
		let message = envelope["message"].as_str().or(envelope["msg"].as_str()).unwrap_or("");
		// The code and HTTP status go with the message, so "Access forbidden" can be traced to a request.
		let message: String = message.chars().take(200).collect();
		return Err(if message.is_empty() { format!("Error code: {code} (HTTP {status})") } else { format!("{message} (code {code}, HTTP {status})") });
	}
	Ok(envelope)
}

/// `data` of the envelope, or the whole envelope when there is none (as the original client did).
fn payload(envelope: &Value) -> Value {
	envelope.get("data").cloned().unwrap_or_else(|| envelope.clone())
}

/// The login token of a reply, and the reply without it: pages never receive the token.
fn take_token(mut data: Value) -> (Option<String>, Value) {
	let token = data.get("token").and_then(Value::as_str).filter(|token| !token.is_empty()).map(String::from);
	if let Some(object) = data.as_object_mut() {
		object.remove("token");
	}
	(token, data)
}

/// A fresh 32-hex-digit id for the `X-BLM-FRID` header, which the official client sets to a random
/// UUID-like value on every request. Not a secret, so std's randomly seeded hasher is enough.
fn request_id() -> String {
	use std::hash::{BuildHasher, Hasher};
	let hex = |salt: u64| {
		let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
		hasher.write_u64(salt);
		format!("{:016x}", hasher.finish())
	};
	format!("{}{}", hex(1), hex(2))
}

/// A server-issued request id that is safe to store and send back as a header value.
fn valid_client_id(id: &str) -> bool {
	!id.is_empty() && id.len() <= 128 && id.bytes().all(|byte| byte.is_ascii_graphic())
}

struct Reply {
	status: u16,
	text: String,
	/// The reply's `x-request-id` header.
	request_id: Option<String>,
}

/// What the original client's requests look like to the server. Its requests are axios/XHR calls made
/// inside the Tauri WebView (no native HTTP plugin), so the server sees a browser's headers.
/// Provenance: the header set is how XHR behaves; the values are ASSUMED, not captured: Tauri 2's
/// Windows origin (`http://tauri.localhost`, `tauri.localhost` is in the app binary, the scheme is
/// not confirmed) and a WebView2 (Edge) user agent whose version is a guess. Replace them with a
/// captured request from the original client if the server turns out to check them.
const BROWSER_ORIGIN: &str = "http://tauri.localhost";
const BROWSER_USER_AGENT: &str =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const BROWSER_ACCEPT: &str = "application/json, text/plain, */*";
const BROWSER_ACCEPT_LANGUAGE: &str = "en-US,en;q=0.9";

/// Replies that mean the login token is no longer valid (the official client logs out on them).
const AUTH_LOST_CODES: [i64; 2] = [10002, 10003];

fn send(route: &Route, token: Option<&str>, client_id: &str, body: &str) -> Result<Reply, String> {
	let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).http_status_as_error(false).build().into();
	let url = format!("{API_HOST}/{}", route.path);
	let bearer = token.map(|token| format!("Bearer {token}"));
	let frid = request_id();
	let referer = format!("{BROWSER_ORIGIN}/");
	let mut headers: Vec<(&str, &str)> = vec![
		("Content-Type", "application/json"),
		("Accept", BROWSER_ACCEPT),
		("Accept-Language", BROWSER_ACCEPT_LANGUAGE),
		("User-Agent", BROWSER_USER_AGENT),
		("Origin", BROWSER_ORIGIN),
		("Referer", referer.as_str()),
		("X-BLM-CID", client_id),
		("X-BLM-FRID", frid.as_str()),
	];
	if let Some(bearer) = &bearer {
		headers.push(("Authorization", bearer.as_str()));
	}
	let mut response = match route.method {
		"GET" => {
			let mut request = agent.get(&url);
			for (name, value) in &headers {
				request = request.header(*name, *value);
			}
			request.call()
		}
		// The original client's axios `delete` sends its payload as the request body.
		"DELETE" => {
			let mut request = agent.delete(&url).force_send_body();
			for (name, value) in &headers {
				request = request.header(*name, *value);
			}
			request.send(body)
		}
		"PUT" => {
			let mut request = agent.put(&url);
			for (name, value) in &headers {
				request = request.header(*name, *value);
			}
			request.send(body)
		}
		_ => {
			let mut request = agent.post(&url);
			for (name, value) in &headers {
				request = request.header(*name, *value);
			}
			request.send(body)
		}
	}
	.map_err(|error| format!("Could not reach the server: {error}"))?;
	let status = response.status().as_u16();
	let request_id = response.headers().get("x-request-id").and_then(|value| value.to_str().ok()).map(String::from);
	let text = response
		.body_mut()
		.with_config()
		.limit(MAX_RESPONSE_BYTES)
		.read_to_string()
		.map_err(|error| format!("Could not read the server's reply: {error}"))?;
	Ok(Reply { status, text, request_id })
}

fn save_sample(directory: &Path, route: &Route, body: &str) {
	// A login reply that carries a token is never written down; its error replies are.
	if std::env::var_os(SAMPLES_ENV).is_none() || (route.token == TokenEffect::Store && body.contains("\"token\"")) {
		return;
	}
	let folder = directory.join("online-samples");
	let name = format!("{}.json", route.path.replace('/', "_"));
	if std::fs::create_dir_all(&folder).and_then(|_| std::fs::write(folder.join(name), body)).is_err() {
		eprintln!("online: could not write a sample");
	}
}

/// Runs one request for a page. Blocking: call it from a worker thread.
fn request(shared: &Shared, method: &str, path: &str, body: Value) -> Value {
	let online = &shared.online;
	let Some(route) = find_route(method, path) else { return fail("This request is not allowed") };
	let enabled = setting_bool(&settings(shared), "onlineMode", false);
	if !enabled {
		// Leaving a session needs no network when online mode is off: just forget the token.
		if path == LOGOUT_PATH {
			online.set_session(None, total_taps(shared));
			return json!({ "ok": true, "data": Value::Null });
		}
		return fail("Online mode is off");
	}
	let token = if route.authenticated { online.token() } else { None };
	if route.authenticated && token.is_none() {
		return fail("Not logged in");
	}

	let mut body = body;
	if path == LOGOUT_PATH {
		// The server is told how many clicks it has not seen; this side counts them, not the page.
		let pending = online.pending(total_taps(shared));
		body = json!({ "click_num": pending });
	}
	let text = if body.is_null() { "{}".to_string() } else { body.to_string() };
	if text.len() > MAX_REQUEST_BYTES {
		return fail("The request is too large");
	}

	if online.client_id().is_empty() && path != CLIENT_ID_PATH {
		// Like the original client, whose first call gives it its X-BLM-CID. Best effort: a failure here
		// must not block the call the page asked for.
		if let Some(first) = find_route("GET", CLIENT_ID_PATH) {
			if let Ok(reply) = send(first, None, "", "{}") {
				if (200..300).contains(&reply.status) {
					if let Some(id) = &reply.request_id {
						online.remember_client_id(id);
					}
				}
			}
		}
	}
	let result = send(route, token.as_deref(), &online.client_id(), &text);
	if route.token == TokenEffect::Clear {
		// The session ends here even if the server could not be told.
		online.set_session(None, total_taps(shared));
	}
	let Reply { status, text: reply, request_id } = match result {
		Ok(reply) => reply,
		Err(error) => return fail(error),
	};
	if (200..300).contains(&status) {
		if let Some(id) = &request_id {
			online.remember_client_id(id);
		}
	}
	save_sample(shared.store.directory(), route, &reply);
	let envelope = match read_envelope(status, &reply) {
		Ok(envelope) => envelope,
		Err(error) => {
			let code = serde_json::from_str::<Value>(&reply).ok().and_then(|reply| reply["code"].as_i64());
			if route.authenticated && code.is_some_and(|code| AUTH_LOST_CODES.contains(&code)) {
				online.set_session(None, total_taps(shared));
			}
			return fail(error);
		}
	};

	let (token, data) = take_token(payload(&envelope));
	if route.token == TokenEffect::Store {
		match token {
			Some(token) => online.set_session(Some(token), total_taps(shared)),
			// A login that returns no token is not a login; stay as before.
			None if path == LOGIN_PATH => return fail("The server did not return a login token"),
			None => {}
		}
	}
	json!({ "ok": true, "data": data })
}

/// Every online call from the studio: `petAPI.online.request(method, endpoint, body)`.
#[tauri::command]
pub(crate) async fn online_request(
	window: tauri::Window,
	app: tauri::AppHandle,
	shared: tauri::State<'_, Shared>,
	method: String,
	endpoint: String,
	body: Option<Value>,
) -> Result<Value, ()> {
	if window.label() != STUDIO_LABEL {
		return Ok(fail("Command not allowed from this window"));
	}
	let shared = shared.inner().clone();
	let body = body.unwrap_or(Value::Null);
	// A logout the page asks for also forgets the passport (the original's `logoutAccount`).
	if endpoint == LOGOUT_PATH {
		login::forget_passport(&shared);
		room::disconnect(&app, &shared);
	}
	Ok(tauri::async_runtime::spawn_blocking(move || request(&shared, &method, &endpoint, body))
		.await
		.unwrap_or_else(|_| fail("The request failed")))
}

pub(crate) use login::{handle_url as handle_login_url, SCHEME as LOGIN_SCHEME};
pub(crate) use room::{apply_settings as apply_room_settings, follow_pet as follow_room_pet};

/// Connects the room socket for the room the server just created or let this user into.
#[tauri::command]
pub(crate) fn online_room_connect(window: tauri::Window, app: tauri::AppHandle, shared: tauri::State<Shared>, room_no: String, self_id: i64) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	login::reply(room::connect(&app, &shared, &room_no, self_id))
}

/// Leaves the room on the socket and closes it.
#[tauri::command]
pub(crate) fn online_room_leave(window: tauri::Window) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	room::leave();
	json!({ "ok": true })
}

/// The eye in the member list: show or hide one member's pet on the desktop.
#[tauri::command]
pub(crate) fn online_room_show_member(window: tauri::Window, app: tauri::AppHandle, shared: tauri::State<Shared>, user_id: i64, shown: bool) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	room::set_hidden(&app, &shared, user_id, !shown);
	json!({ "ok": true })
}

/// An owner's action on another member: `kick` or `transfer` (host). The server decides if it is allowed.
#[tauri::command]
pub(crate) fn online_room_member(window: tauri::Window, action: String, user_id: i64) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	login::reply(room::member_action(&action, user_id))
}

/// Tells the room this user's outfit changed (the server reads it from the account).
#[tauri::command]
pub(crate) fn online_room_changed(window: tauri::Window) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	room::looks_changed();
	json!({ "ok": true })
}

fn open_in_browser(url: &str) -> Result<(), String> {
	// Only the https login page built by `login::login_url` is ever passed here.
	if !url.starts_with("https://") {
		return Err("Refusing to open a non-https address".into());
	}
	let mut command = if cfg!(windows) {
		let mut command = std::process::Command::new("rundll32");
		command.arg("url.dll,FileProtocolHandler");
		command
	} else if cfg!(target_os = "macos") {
		std::process::Command::new("open")
	} else {
		std::process::Command::new("xdg-open")
	};
	command.arg(url).spawn().map(|_| ()).map_err(|error| format!("Could not open the browser: {error}"))
}

/// Starts the browser login: opens the Kuro login page. The result arrives as `online-login` events.
#[tauri::command]
pub(crate) fn online_login_start(window: tauri::Window, app: tauri::AppHandle, shared: tauri::State<Shared>, lang: Option<String>) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	// `None`: a role choice was still waiting and has been shown again; no browser is opened.
	login::reply(login::start(&app, &shared, lang.as_deref().unwrap_or("en")).and_then(|url| url.map_or(Ok(()), |url| open_in_browser(&url))))
}

/// Changes character without the browser: lists the roles again with the passport of the last login.
#[tauri::command]
pub(crate) fn online_login_switch(window: tauri::Window, app: tauri::AppHandle, shared: tauri::State<Shared>) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	login::reply(login::switch(&app, &shared))
}

/// Picks one of the roles an `online-login` `choose` event listed.
#[tauri::command]
pub(crate) fn online_login_choose(window: tauri::Window, app: tauri::AppHandle, shared: tauri::State<Shared>, index: usize) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	login::reply(login::choose(&app, &shared, index))
}

#[tauri::command]
pub(crate) fn online_login_cancel(window: tauri::Window, shared: tauri::State<Shared>) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	login::cancel(&shared);
	json!({ "ok": true })
}

/// `petAPI.online.status()`: whether a session exists and how many clicks the server has not seen.
#[tauri::command]
pub(crate) fn online_status(window: tauri::Window, shared: tauri::State<Shared>) -> Value {
	if window.label() != STUDIO_LABEL {
		return fail("Command not allowed from this window");
	}
	let pending = shared.online.pending(total_taps(&shared));
	let logged_in = shared.online.token().is_some();
	let mut reply = Map::new();
	reply.insert("ok".into(), json!(true));
	reply.insert("loggedIn".into(), json!(logged_in));
	reply.insert("pendingClicks".into(), json!(pending));
	Value::Object(reply)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn online(name: &str) -> (Online, PathBuf) {
		let directory = std::env::temp_dir().join(format!("wuwa-tappo-online-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&directory);
		std::fs::create_dir_all(&directory).unwrap();
		(Online::new(&directory), directory)
	}

	#[test]
	fn only_listed_routes_with_their_method_are_allowed() {
		assert!(find_route("POST", "api/frontend/chests/open").is_some());
		assert!(find_route("GET", "api/frontend/chests/open").is_none(), "wrong method");
		assert!(find_route("PUT", "api/frontend/user/me/appearance").is_some());
		assert!(find_route("DELETE", "api/frontend/presets").is_some());
		assert!(find_route("POST", "api/frontend/user/me/appearance").is_none(), "wrong method");
		assert!(find_route("POST", "api/auth/login").is_none(), "the passport login is only reachable through login.rs");
		assert!(find_route("POST", "api/frontend/chests/open/../../admin").is_none());
		assert!(find_route("POST", "https://example.com/api/frontend/chests/open").is_none());
		let mut seen = std::collections::HashSet::new();
		assert!(ROUTES.iter().all(|route| seen.insert((route.method, route.path))), "no duplicate routes");
	}

	#[test]
	fn the_envelope_is_read_like_the_original_client_did() {
		assert_eq!(read_envelope(200, r#"{"code":0,"data":{"a":1}}"#).unwrap()["data"]["a"], 1);
		assert!(read_envelope(200, r#"{"code":200}"#).is_ok());
		assert_eq!(read_envelope(200, r#"{"code":1001,"message":"bad code"}"#).unwrap_err(), "bad code (code 1001, HTTP 200)");
		assert_eq!(read_envelope(403, r#"{"code":403,"msg":"old field"}"#).unwrap_err(), "old field (code 403, HTTP 403)");
		assert_eq!(read_envelope(200, r#"{"code":7}"#).unwrap_err(), "Error code: 7 (HTTP 200)");
		assert_eq!(read_envelope(502, "<html>").unwrap_err(), "HTTP 502");
		let long = format!(r#"{{"code":1,"message":"{}"}}"#, "x".repeat(500));
		assert!(read_envelope(200, &long).unwrap_err().len() < 240, "a hostile message is bounded");
		let envelope = json!({ "code": 0, "token": "t" });
		assert_eq!(payload(&envelope), envelope, "no data: the whole reply, as the original client did");
	}

	#[test]
	fn request_ids_are_32_hex_digits_and_differ() {
		let (first, second) = (request_id(), request_id());
		assert_eq!(first.len(), 32);
		assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
		assert_ne!(first, second);
	}

	#[test]
	fn the_client_id_is_the_first_usable_request_id_and_survives_a_restart() {
		assert!(valid_client_id("00100016fd2f8856599fd8caa74d932a"));
		assert!(!valid_client_id("") && !valid_client_id("has space") && !valid_client_id("line\nbreak") && !valid_client_id(&"x".repeat(129)));
		let (online, directory) = online("client-id");
		assert_eq!(online.client_id(), "", "empty before the first reply, as the original client sends it");
		online.remember_client_id("bad id");
		assert_eq!(online.client_id(), "");
		online.remember_client_id("first");
		online.remember_client_id("second");
		assert_eq!(online.client_id(), "first");
		online.set_session(Some("t".into()), 0);
		online.set_session(None, 0);
		assert_eq!(Online::new(&directory).client_id(), "first", "kept across login, logout and restart");
		std::fs::remove_dir_all(directory).unwrap();
	}

	#[test]
	fn the_token_never_reaches_the_page() {
		let (token, data) = take_token(json!({ "token": "secret", "user": { "user_id": "1" } }));
		assert_eq!(token.as_deref(), Some("secret"));
		assert!(data.get("token").is_none());
		assert_eq!(data["user"]["user_id"], "1");
		assert_eq!(take_token(json!({ "token": "" })).0, None);
	}

	#[test]
	fn pending_clicks_are_the_taps_since_login_and_survive_a_save_going_backwards() {
		let (online, directory) = online("pending");
		assert_eq!(online.pending(500), 0, "no session, no pending clicks");
		online.set_session(Some("t".into()), 500);
		assert_eq!(online.pending(512), 12);
		assert_eq!(online.pending(100), 0, "a reset save lowers the baseline");
		assert_eq!(online.pending(103), 3);
		// The session outlives a restart; the token file is private.
		let reopened = Online::new(&directory);
		assert_eq!(reopened.token().as_deref(), Some("t"));
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			assert_eq!(std::fs::metadata(directory.join("online.json")).unwrap().permissions().mode() & 0o077, 0);
		}
		reopened.set_session(None, 103);
		assert_eq!(Online::new(&directory).token(), None);
		std::fs::remove_dir_all(directory).unwrap();
	}
}
