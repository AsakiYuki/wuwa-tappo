//! The original client's overseas ("global") login: the Kuro passport page in the system browser.
//!
//! Provenance: all of it is from the original bundle (build 1.0.5, `startOverseasBrowserLogin`,
//! `parseOverseasAuthCallback`, `completeForeignBrowserLogin`, `handleForeignLogin`), read statically.
//! None of it has run against the live server or the real login page.
//!
//! Flow: `start` makes a random `state`, remembers it for 15 minutes and returns the login page URL
//! (`?state=&scheme=wuwa-buddy&lang=`), which the caller opens in the browser. The page ends by opening
//! `wuwa-buddy://auth/callback?state=&access_token=&cuid=&puid=&userId=&userName=`; the OS hands that
//! URL to this app, `handle_callback` checks the state, asks `api/auth/player/query` for the account's
//! roles (`is_domestic: 0`) and, with one role or none, logs in at once with `api/auth/login`; with
//! several the studio is asked to pick one (`choose`). The passport access token lives in memory only,
//! until the login finishes or fails; the page never sees it.

use super::{
	fail, payload, read_envelope, request_id, send, take_token, total_taps, valid_client_id, Reply, Route, TokenEffect,
};
use crate::{setting_bool, settings, studio, Shared, STUDIO_LABEL};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub(crate) const SCHEME: &str = "wuwa-buddy";
/// `getOverseasAuthPageUrl` (the build's `VITE_OVERSEAS_AUTH_PAGE_URL`).
const LOGIN_PAGE: &str = "https://login-wutheringwaves-wuwatappo.kurogames-global.com/login/";
const PENDING_TTL: Duration = Duration::from_secs(900);
const MAX_ROLES: usize = 64;
const MAX_FIELD: usize = 2048;
const LANGS: [&str; 12] = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "fr", "de", "es", "pt", "ru", "th", "id"];

const PLAYER_QUERY: Route = Route { method: "POST", path: "api/auth/player/query", token: TokenEffect::None, authenticated: false };
const SDK_LOGIN: Route = Route { method: "POST", path: "api/auth/login", token: TokenEffect::Store, authenticated: false };

/// The passport's identity from the callback URL.
#[derive(Clone, PartialEq, Debug)]
pub(super) struct Callback {
	pub state: String,
	pub access_token: String,
	pub cuid: String,
	pub puid: String,
	pub user_id: String,
	pub user_name: String,
}

#[derive(Clone, PartialEq, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Role {
	pub player_id: i64,
	pub server_id: String,
	pub name: String,
}

struct Ready {
	callback: Callback,
	channel_id: i64,
	roles: Vec<Role>,
}

#[derive(Default)]
pub(super) struct Flow {
	pending: Option<(String, Instant)>,
	ready: Option<Ready>,
	/// The passport identity of the last successful login, for switching character without the browser
	/// (`switchForeignCharacter`). The original kept it in localStorage; here it stays in memory, so an app
	/// restart asks for the browser login again. Forgotten on logout (`forget_passport`).
	passport: Option<(Callback, i64)>,
}

impl Flow {
	fn clear(&mut self) {
		self.pending = None;
		self.ready = None;
	}
}

/// `restartOverseasLoginOnAuthError`: the passport or login token is refused, so the login starts over.
const RESTART_CODES: [i64; 3] = [10002, 10003, 10024];

/// The server code in an error text built by `read_envelope` (`... (code N, HTTP M)` or `Error code: N (...)`).
fn error_code(message: &str) -> Option<i64> {
	let rest = message.rfind("(code ").map(|at| &message[at + 6..]).or_else(|| message.strip_prefix("Error code: "))?;
	let digits: String = rest.chars().take_while(|ch| ch.is_ascii_digit() || *ch == '-').collect();
	digits.parse().ok()
}

pub(super) fn forget_passport(shared: &Shared) {
	shared.online.flow.lock().unwrap().passport = None;
}

pub(super) type FlowState = Mutex<Flow>;

fn bounded(value: &str) -> Option<String> {
	let value = value.trim();
	(value.len() <= MAX_FIELD && !value.chars().any(char::is_control)).then(|| value.to_string())
}

/// The login page URL for `state` and the page language (unknown languages fall back to English).
pub(super) fn login_url(state: &str, lang: &str) -> Result<String, String> {
	let mut url = url::Url::parse(LOGIN_PAGE).map_err(|error| error.to_string())?;
	let lang = if LANGS.contains(&lang) { lang } else { "en" };
	url.query_pairs_mut().append_pair("state", state).append_pair("scheme", SCHEME).append_pair("lang", lang);
	Ok(url.to_string())
}

/// `parseOverseasAuthCallback`: `wuwa-buddy://auth/callback?...` with a `state` and an access token.
/// A callback with only a `code` is refused: the original never implemented that exchange either.
pub(super) fn parse_callback(raw: &str) -> Option<Callback> {
	let url = url::Url::parse(raw).ok()?;
	if url.scheme() != SCHEME {
		return None;
	}
	let route = format!("{}{}", url.host_str().unwrap_or(""), url.path()).trim_end_matches('/').to_string();
	if route != "auth/callback" {
		return None;
	}
	let get = |names: &[&str]| -> String {
		names
			.iter()
			.find_map(|name| url.query_pairs().find(|(key, value)| key == name && !value.trim().is_empty()).map(|(_, value)| value.trim().to_string()))
			.unwrap_or_default()
	};
	let state = bounded(&get(&["state"]))?;
	let access_token = bounded(&get(&["access_token", "token"]))?;
	let cuid = bounded(&get(&["cuid"]))?;
	if state.is_empty() || access_token.is_empty() || cuid.is_empty() {
		return None;
	}
	let puid = bounded(&get(&["puid"])).filter(|value| !value.is_empty()).unwrap_or_else(|| cuid.clone());
	let user_name = bounded(&get(&["userName", "user_name"]))?;
	let user_id = bounded(&get(&["userId", "user_id"])).filter(|value| !value.is_empty()).unwrap_or_else(|| if user_name.is_empty() { cuid.clone() } else { user_name.clone() });
	Some(Callback { state, access_token, cuid, puid, user_id, user_name })
}

/// `player/query` data: `{ cuid, channelId, items: [{ playerId, serverId, playerName }] }`. Items
/// without a server id are skipped, as `buildForeignRoleSelectData` does. `None` if it is not that shape.
pub(super) fn parse_players(data: &Value) -> Option<(i64, Vec<Role>)> {
	let channel_id = data.get("channelId").and_then(Value::as_i64).unwrap_or(0);
	let items = match data.get("items") {
		None | Some(Value::Null) => return Some((channel_id, Vec::new())),
		Some(Value::Array(items)) if items.len() <= MAX_ROLES => items,
		_ => return None,
	};
	let mut roles = Vec::new();
	for item in items {
		let server_id = item.get("serverId").and_then(|value| value.as_str().map(String::from).or_else(|| value.as_i64().map(|number| number.to_string()))).unwrap_or_default();
		let server_id = server_id.trim().to_string();
		if server_id.is_empty() || server_id.len() > 64 {
			continue;
		}
		let player_id = match item.get("playerId") {
			Some(Value::Number(number)) => number.as_i64(),
			Some(Value::String(text)) => text.trim().parse().ok(),
			_ => None,
		}?;
		let name = item.get("playerName").and_then(Value::as_str).unwrap_or("").chars().take(64).collect();
		roles.push(Role { player_id, server_id, name });
	}
	Some((channel_id, roles))
}

/// The `api/auth/login` body of `handleForeignLogin`.
fn login_body(callback: &Callback, channel_id: i64, role: Option<&Role>) -> Value {
	json!({
		"cuid": callback.cuid,
		"puid": callback.puid,
		"channelId": channel_id,
		"userid": callback.user_id,
		"cname": callback.user_name,
		"accessToken": callback.access_token,
		"source": "sdk",
		// `pickLoginPlayerFields`: no role at all logs in with 0 and "0".
		"playerId": role.map_or(0, |role| role.player_id),
		"serverId": role.map_or("0", |role| role.server_id.as_str()),
		"is_domestic": 0,
	})
}

#[derive(Serialize, Clone)]
#[serde(tag = "stage", rename_all = "camelCase")]
enum Event {
	Waiting,
	/// `switch`: the roles of an account that is already logged in (changing character).
	Choose { roles: Vec<Role>, switch: bool },
	Done,
	/// `restart`: the studio should open the browser login again (after a short pause).
	Failed { message: String, restart: bool },
}

fn emit(app: &AppHandle, event: &Event) {
	let _ = app.emit_to(STUDIO_LABEL, "online-login", event);
}

fn emit_failed(app: &AppHandle, shared: &Shared, message: String) {
	let restart = error_code(&message).is_some_and(|code| RESTART_CODES.contains(&code));
	if restart {
		forget_passport(shared);
	}
	emit(app, &Event::Failed { message, restart });
}

fn call(route: &Route, shared: &Shared, body: &Value) -> Result<Value, String> {
	let online = &shared.online;
	let text = body.to_string();
	let reply = send(route, None, &online.client_id(), &text)?;
	let Reply { status, text: reply, request_id } = reply;
	if (200..300).contains(&status) {
		if let Some(id) = request_id.filter(|id| valid_client_id(id)) {
			online.remember_client_id(&id);
		}
	}
	read_envelope(status, &reply).map(|envelope| payload(&envelope))
}

fn finish(app: &AppHandle, shared: &Shared, callback: &Callback, channel_id: i64, role: Option<&Role>) {
	// Changing character while logged in: the server is told the clicks it has not seen (the logout does
	// that) before the new session replaces the old one.
	if shared.online.token().is_some() {
		let _ = super::request(shared, "POST", super::LOGOUT_PATH, Value::Null);
	}
	let result = call(&SDK_LOGIN, shared, &login_body(callback, channel_id, role)).and_then(|data| {
		let (token, _) = take_token(data);
		token.ok_or_else(|| "The server did not return a login token".to_string())
	});
	match result {
		Ok(token) => {
			shared.online.set_session(Some(token), total_taps(shared));
			shared.online.flow.lock().unwrap().passport = Some((callback.clone(), channel_id));
			emit(app, &Event::Done);
		}
		Err(message) => emit_failed(app, shared, message),
	}
}

/// Asks for the account's roles and either logs in (no role) or lets the studio pick one.
/// `switch`: the account is already logged in and an empty list is an error, not a login.
fn present_roles(app: &AppHandle, shared: &Shared, callback: Callback, switch: bool) {
	let query = json!({ "cuid": callback.cuid, "is_domestic": 0, "accessToken": callback.access_token, "cname": callback.user_name });
	let players = call(&PLAYER_QUERY, shared, &query).and_then(|data| parse_players(&data).ok_or_else(|| "The server's role list was not in the expected format".to_string()));
	match players {
		Err(message) => emit_failed(app, shared, message),
		// The original lists the roles whenever there is at least one, even a single one.
		Ok((channel_id, roles)) if roles.is_empty() && !switch => finish(app, shared, &callback, channel_id, None),
		Ok((_, roles)) if roles.is_empty() => emit_failed(app, shared, "This account has no character to switch to".into()),
		Ok((channel_id, roles)) => {
			let listed = roles.clone();
			shared.online.flow.lock().unwrap().ready = Some(Ready { callback, channel_id, roles });
			emit(app, &Event::Choose { roles: listed, switch });
		}
	}
}

/// Starts a login: the URL to open in the browser, or `None` when a role choice is still waiting (it is
/// shown again, as `tryResumeOverseasRoleSelect` does). Refused while online mode is off.
pub(super) fn start(app: &AppHandle, shared: &Shared, lang: &str) -> Result<Option<String>, String> {
	if !setting_bool(&settings(shared), "onlineMode", false) {
		return Err("Online mode is off".into());
	}
	{
		let flow = shared.online.flow.lock().unwrap();
		if let Some(ready) = &flow.ready {
			emit(app, &Event::Choose { roles: ready.roles.clone(), switch: shared.online.token().is_some() });
			return Ok(None);
		}
	}
	let state = request_id();
	let url = login_url(&state, lang)?;
	let mut flow = shared.online.flow.lock().unwrap();
	flow.clear();
	flow.pending = Some((state, Instant::now()));
	Ok(Some(url))
}

/// `switchForeignCharacter`: lists the roles again with the passport token of the last login.
pub(super) fn switch(app: &AppHandle, shared: &Shared) -> Result<(), String> {
	if !setting_bool(&settings(shared), "onlineMode", false) {
		return Err("Online mode is off".into());
	}
	if shared.online.token().is_none() {
		return Err("Not logged in".into());
	}
	let Some((callback, _)) = shared.online.flow.lock().unwrap().passport.clone() else {
		return Err("Log in with your Kuro account again to switch characters".into());
	};
	emit(app, &Event::Waiting);
	let (app, shared) = (app.clone(), shared.clone());
	std::thread::spawn(move || present_roles(&app, &shared, callback, true));
	Ok(())
}

/// A URL the OS handed to the app. Anything that is not a callback for the pending login is ignored.
pub(crate) fn handle_url(app: &AppHandle, shared: &Shared, raw: &str) {
	let Some(callback) = parse_callback(raw) else { return };
	if !setting_bool(&settings(shared), "onlineMode", false) {
		return;
	}
	{
		let mut flow = shared.online.flow.lock().unwrap();
		match flow.pending.take() {
			Some((state, started)) if state == callback.state && started.elapsed() <= PENDING_TTL => {}
			_ => {
				drop(flow);
				emit(app, &Event::Failed { message: "The login link is invalid or has expired; start the login again".into(), restart: false });
				return;
			}
		}
	}
	studio::show(app, shared, Some("online".into()));
	emit(app, &Event::Waiting);
	let (app, shared) = (app.clone(), shared.clone());
	std::thread::spawn(move || present_roles(&app, &shared, callback, false));
}

/// The studio's pick among the roles `Event::Choose` listed.
pub(super) fn choose(app: &AppHandle, shared: &Shared, index: usize) -> Result<(), String> {
	let ready = {
		let mut flow = shared.online.flow.lock().unwrap();
		let Some(ready) = flow.ready.take() else { return Err("No login is waiting for a role".into()) };
		if index >= ready.roles.len() {
			flow.ready = Some(ready);
			return Err("Unknown role".into());
		}
		ready
	};
	let (app, shared) = (app.clone(), shared.clone());
	std::thread::spawn(move || finish(&app, &shared, &ready.callback, ready.channel_id, ready.roles.get(index)));
	Ok(())
}

pub(super) fn cancel(shared: &Shared) {
	shared.online.flow.lock().unwrap().clear();
}

pub(super) fn reply(result: Result<(), String>) -> Value {
	match result {
		Ok(()) => json!({ "ok": true }),
		Err(error) => fail(error),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_login_url_carries_state_scheme_and_a_known_language() {
		let url = url::Url::parse(&login_url("abc123", "ja").unwrap()).unwrap();
		assert_eq!(url.host_str(), Some("login-wutheringwaves-wuwatappo.kurogames-global.com"));
		let pairs: Vec<_> = url.query_pairs().map(|(key, value)| (key.to_string(), value.to_string())).collect();
		assert_eq!(pairs, [("state".into(), "abc123".into()), ("scheme".into(), "wuwa-buddy".into()), ("lang".into(), "ja".into())]);
		assert!(login_url("s", "evil&x=1").unwrap().ends_with("lang=en"), "an unknown language falls back to English");
	}

	#[test]
	fn only_a_wellformed_callback_with_state_token_and_cuid_is_accepted() {
		let ok = parse_callback("wuwa-buddy://auth/callback?state=S&access_token=T&cuid=C&userName=Rover%20X").unwrap();
		assert_eq!(ok, Callback { state: "S".into(), access_token: "T".into(), cuid: "C".into(), puid: "C".into(), user_id: "Rover X".into(), user_name: "Rover X".into() });
		let alt = parse_callback("wuwa-buddy://auth/callback/?state=S&token=T&cuid=C&puid=P&user_id=U").unwrap();
		assert_eq!((alt.puid.as_str(), alt.user_id.as_str(), alt.user_name.as_str()), ("P", "U", ""));
		for bad in [
			"wuwa-buddy://auth/callback?state=S&cuid=C",
			"wuwa-buddy://auth/callback?state=S&code=X&cuid=C",
			"wuwa-buddy://auth/callback?access_token=T&cuid=C",
			"wuwa-buddy://auth/callback?state=S&access_token=T",
			"wuwa-buddy://other/callback?state=S&access_token=T&cuid=C",
			"https://auth/callback?state=S&access_token=T&cuid=C",
			"not a url",
		] {
			assert_eq!(parse_callback(bad), None, "{bad}");
		}
		let long = format!("wuwa-buddy://auth/callback?state=S&access_token={}&cuid=C", "x".repeat(MAX_FIELD + 1));
		assert_eq!(parse_callback(&long), None);
	}

	#[test]
	fn players_are_read_like_the_original_and_bad_shapes_are_refused() {
		let data = json!({ "channelId": 7, "items": [
			{ "playerId": 101, "serverId": "os_asia", "playerName": "A" },
			{ "playerId": "102", "serverId": 3 },
			{ "playerId": 103, "serverId": "" },
		]});
		let (channel, roles) = parse_players(&data).unwrap();
		assert_eq!(channel, 7);
		assert_eq!(roles, [Role { player_id: 101, server_id: "os_asia".into(), name: "A".into() }, Role { player_id: 102, server_id: "3".into(), name: String::new() }]);
		assert_eq!(parse_players(&json!({})), Some((0, Vec::new())));
		assert_eq!(parse_players(&json!({ "items": "x" })), None);
		assert_eq!(parse_players(&json!({ "items": [{ "playerId": "no", "serverId": "s" }] })), None);
		assert_eq!(parse_players(&json!({ "items": vec![json!({}); MAX_ROLES + 1] })), None);
	}

	#[test]
	fn the_login_body_matches_the_original_and_no_role_means_zero() {
		let callback = parse_callback("wuwa-buddy://auth/callback?state=S&access_token=T&cuid=C&userName=N").unwrap();
		let role = Role { player_id: 5, server_id: "s1".into(), name: String::new() };
		let body = login_body(&callback, 2, Some(&role));
		assert_eq!((body["playerId"].clone(), body["serverId"].clone(), body["channelId"].clone()), (json!(5), json!("s1"), json!(2)));
		assert_eq!((body["source"].clone(), body["is_domestic"].clone(), body["userid"].clone(), body["cname"].clone()), (json!("sdk"), json!(0), json!("N"), json!("N")));
		let none = login_body(&callback, 0, None);
		assert_eq!((none["playerId"].clone(), none["serverId"].clone()), (json!(0), json!("0")));
	}

	#[test]
	fn the_server_code_is_read_from_the_error_text_and_only_auth_codes_restart_the_login() {
		assert_eq!(error_code("Login failed (code 10024, HTTP 200)"), Some(10024));
		assert_eq!(error_code("Error code: 10003 (HTTP 200)"), Some(10003));
		assert_eq!(error_code("Could not reach the server: timeout"), None);
		assert_eq!(error_code("HTTP 500"), None);
		assert!(RESTART_CODES.contains(&10002) && RESTART_CODES.contains(&10003) && RESTART_CODES.contains(&10024));
		assert!(!RESTART_CODES.contains(&10031));
	}

	#[test]
	fn the_login_flow_forgets_everything_when_cleared() {
		let mut flow = Flow::default();
		flow.pending = Some(("s".into(), Instant::now()));
		flow.clear();
		assert!(flow.pending.is_none() && flow.ready.is_none());
	}
}
