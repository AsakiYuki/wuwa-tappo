//! Online mode: the app's only network access, a client for the Kuro Games Wuwa Tappo server.
//!
//! Off by default (`onlineMode` setting). While it is off, `request` refuses to touch the network, so
//! the offline app never talks to anyone. The pages never see the login token: it is stored here
//! (`online.json`, next to the save but not inside it, so exporting a save cannot leak it) and added
//! to requests by this side.
//!
//! Provenance: the host, the routes and the envelope (`{ code, msg | message, data }`, success when
//! `code` is 0 or 200) come from the decompiled frontend (wuwa-tappo-frontend, build 1.0.5,
//! `api/kuro.ts`). None of it has been confirmed against live traffic.
//!
//! To record real replies for checking the shapes the renderer expects, start the app with
//! `WUWA_TAPPO_ONLINE_SAMPLES=1`: each reply's raw JSON is then written to `online-samples/` in the
//! save folder (never the login replies, which carry the token). The samples hold account data;
//! look before sharing one.

use crate::{setting_bool, settings, Shared, STUDIO_LABEL};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// Where the decompiled frontend sends every request. Unconfirmed; this is the only place to change it.
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

/// Every route the pages may call, and nothing else. The passport/SDK login (`api/auth/login`,
/// `api/auth/player/query`) is not here: it needs tokens only the original app's login page produces.
const ROUTES: &[Route] = &[
	route("POST", "api/auth/uid-send-code", TokenEffect::None, false),
	route("POST", "api/auth/uid-login", TokenEffect::Store, false),
	route("GET", "api/frontend/user/me", TokenEffect::None, true),
	route("GET", "api/frontend/user/renew-token", TokenEffect::Store, true),
	route("POST", "api/frontend/user/logout", TokenEffect::Clear, true),
	route("GET", "api/common/atlas", TokenEffect::None, true),
	route("POST", "api/frontend/bags/list", TokenEffect::None, true),
	route("POST", "api/frontend/chests/open", TokenEffect::None, true),
	route("POST", "api/frontend/redeems/use", TokenEffect::None, true),
	route("POST", "api/frontend/rooms", TokenEffect::None, true),
	route("POST", "api/frontend/rooms/join", TokenEffect::None, true),
	route("POST", "api/frontend/rooms/random-join", TokenEffect::None, true),
	route("POST", "api/frontend/rooms/public", TokenEffect::None, true),
];

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
}

pub(crate) struct Online {
	file: PathBuf,
	saved: Mutex<Saved>,
}

impl Online {
	pub(crate) fn new(directory: &Path) -> Self {
		let file = directory.join("online.json");
		let saved = std::fs::read_to_string(&file).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
		Online { file, saved: Mutex::new(saved) }
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

fn send(route: &Route, token: Option<&str>, body: &str) -> Result<(u16, String), String> {
	let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).http_status_as_error(false).build().into();
	let url = format!("{API_HOST}/{}", route.path);
	let bearer = token.map(|token| format!("Bearer {token}"));
	let mut response = if route.method == "GET" {
		let mut request = agent.get(&url).header("Content-Type", "application/json");
		if let (Some(token), Some(bearer)) = (token, &bearer) {
			request = request.header("token", token).header("Authorization", bearer.as_str());
		}
		request.call()
	} else {
		let mut request = agent.post(&url).header("Content-Type", "application/json");
		if let (Some(token), Some(bearer)) = (token, &bearer) {
			request = request.header("token", token).header("Authorization", bearer.as_str());
		}
		request.send(body)
	}
	.map_err(|error| format!("Could not reach the server: {error}"))?;
	let status = response.status().as_u16();
	let text = response
		.body_mut()
		.with_config()
		.limit(MAX_RESPONSE_BYTES)
		.read_to_string()
		.map_err(|error| format!("Could not read the server's reply: {error}"))?;
	Ok((status, text))
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

	let result = send(route, token.as_deref(), &text);
	if route.token == TokenEffect::Clear {
		// The session ends here even if the server could not be told.
		online.set_session(None, total_taps(shared));
	}
	let (status, reply) = match result {
		Ok(reply) => reply,
		Err(error) => return fail(error),
	};
	save_sample(shared.store.directory(), route, &reply);
	let envelope = match read_envelope(status, &reply) {
		Ok(envelope) => envelope,
		Err(error) => return fail(error),
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
	Ok(tauri::async_runtime::spawn_blocking(move || request(&shared, &method, &endpoint, body))
		.await
		.unwrap_or_else(|_| fail("The request failed")))
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
		assert!(find_route("POST", "api/auth/login").is_none(), "the SDK login is not merged");
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
