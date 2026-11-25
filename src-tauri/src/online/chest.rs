//! The two desktop chests beside the pet (left and right), as the original's main window shows them:
//! a countdown bubble for each chest until it is ready, then a chest bubble that opens it.
//!
//! Provenance (original build 1.0.5, main window composable, read statically; not run against the
//! server): `user/me` carries `left_treasure_chest` and `right_treasure_chest`, each the server time in
//! milliseconds at which that chest is ready (null or 0: ready now); `api/common/activity-config` carries
//! `server_time` (ms), the clock those values are compared against. Opening is
//! `POST api/frontend/chests/open { place: "left" | "right", click_num }` where `click_num` is the
//! server's click total plus the clicks it has not seen; the reply holds `click_consume`, `asset_id`,
//! `asset_name`, `asset_type` and `rarity_type`. A chest can be opened with at least 1000 clicks, and is
//! locked for 30 minutes afterwards. The pet page counts down on its own; this side only says how long
//! each chest has left when it knows (login, every few minutes, after an open).

use super::{request, total_taps, CLIENT_ID_PATH};
use crate::{setting_bool, settings, Shared, PET_LABEL};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const SIDES: [&str; 2] = ["left", "right"];
/// Clicks an open needs (the original's `$s`).
const MIN_CLICKS: u64 = 1000;
/// How long a chest stays locked after it was opened (the original's `Sr`).
const LOCK_MS: u64 = 30 * 60 * 1000;
const REFRESH_EVERY: Duration = Duration::from_secs(5 * 60);
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(30);
const TICK: Duration = Duration::from_secs(2);
const USER_PATH: &str = "api/frontend/user/me";
const OPEN_PATH: &str = "api/frontend/chests/open";

#[derive(Default)]
struct Clock {
	/// The token the numbers below belong to; another login starts over.
	for_token: Option<String>,
	next_refresh: Option<Instant>,
	/// When each chest is ready, on this machine's clock. None: not known (no valid server time).
	ready_at: [Option<Instant>; 2],
	credited: u64,
	consumed: u64,
	eligible: bool,
}

static CLOCK: Mutex<Clock> = Mutex::new(Clock {
	for_token: None,
	next_refresh: None,
	ready_at: [None, None],
	credited: 0,
	consumed: 0,
	eligible: false,
});

/// Milliseconds until a chest is ready: `ready` is the server's timestamp, `server_now` the server's clock.
/// A missing, null or non-positive timestamp means ready now (the original's `er`).
fn remaining_ms(ready: &Value, server_now: f64) -> u64 {
	match ready.as_f64() {
		Some(at) if at.is_finite() && at > server_now => (at - server_now).min(LOCK_MS as f64 * 4.0) as u64,
		_ => 0,
	}
}

/// `server_time` of the activity config, when it is a usable clock.
fn server_time(config: &Value) -> Option<f64> {
	config["data"]["server_time"].as_f64().filter(|time| time.is_finite() && *time > 0.0)
}

fn count(value: &Value) -> u64 {
	value.as_f64().filter(|number| number.is_finite() && *number > 0.0).map_or(0, |number| number.min(9.0e15) as u64)
}

fn balance(credited: u64, consumed: u64, pending: u64) -> u64 {
	credited.saturating_sub(consumed).saturating_add(pending)
}

fn state_of(clock: &Clock, logged_in: bool) -> Value {
	let now = Instant::now();
	let left = |index: usize| clock.ready_at[index].map(|at| at.saturating_duration_since(now).as_millis() as u64);
	json!({ "loggedIn": logged_in, "eligible": clock.eligible, "left": left(0), "right": left(1) })
}

fn emit(app: &AppHandle, state: &Value) {
	let _ = app.emit_to(PET_LABEL, "chest-clock", state);
}

/// What the pet page asks for when it opens.
pub(crate) fn snapshot(shared: &Shared) -> Value {
	let logged_in = online_on(shared) && shared.online.token().is_some();
	let clock = CLOCK.lock().unwrap();
	state_of(&clock, logged_in && clock.for_token.is_some())
}

fn online_on(shared: &Shared) -> bool {
	setting_bool(&settings(shared), "onlineMode", false)
}

struct Fetched {
	credited: u64,
	consumed: u64,
	ready_in: [Option<u64>; 2],
}

/// The account's clicks and chest timers, read now. `ready_in` is None for both when the server gave no usable clock.
fn fetch(shared: &Shared) -> Result<Fetched, String> {
	let config = request(shared, "GET", CLIENT_ID_PATH, Value::Null);
	let user = request(shared, "GET", USER_PATH, Value::Null);
	if user["ok"] != json!(true) {
		return Err(user["error"].as_str().unwrap_or("Could not read the account").to_string());
	}
	let data = &user["data"];
	let now = if config["ok"] == json!(true) { server_time(&config) } else { None };
	let ready_in = match now {
		Some(now) => [Some(remaining_ms(&data["left_treasure_chest"], now)), Some(remaining_ms(&data["right_treasure_chest"], now))],
		None => [None, None],
	};
	Ok(Fetched { credited: count(&data["total_click_count"]), consumed: count(&data["total_click_consume"]), ready_in })
}

fn store(clock: &mut Clock, fetched: &Fetched, token: &str) {
	let now = Instant::now();
	clock.for_token = Some(token.to_string());
	clock.next_refresh = Some(now + REFRESH_EVERY);
	clock.credited = fetched.credited;
	clock.consumed = fetched.consumed;
	for (slot, left) in clock.ready_at.iter_mut().zip(fetched.ready_in) {
		*slot = left.map(|ms| now + Duration::from_millis(ms));
	}
}

fn tick(app: &AppHandle, shared: &Shared) {
	let token = if online_on(shared) { shared.online.token() } else { None };
	let Some(token) = token else {
		let mut clock = CLOCK.lock().unwrap();
		if clock.for_token.is_some() {
			*clock = Clock::default();
			emit(app, &state_of(&clock, false));
		}
		return;
	};
	let due = {
		let clock = CLOCK.lock().unwrap();
		clock.for_token.as_deref() != Some(token.as_str()) || clock.next_refresh.map_or(true, |at| Instant::now() >= at)
	};
	let fetched = if due { Some(fetch(shared)) } else { None };
	let pending = shared.online.pending(total_taps(shared));
	let mut clock = CLOCK.lock().unwrap();
	let mut changed = false;
	match fetched {
		Some(Ok(fetched)) => {
			store(&mut clock, &fetched, &token);
			changed = true;
		}
		Some(Err(message)) => {
			eprintln!("chest: could not read the chest timers: {message}");
			clock.next_refresh = Some(Instant::now() + RETRY_AFTER_FAILURE);
		}
		None => {}
	}
	if clock.for_token.is_none() {
		return;
	}
	let eligible = balance(clock.credited, clock.consumed, pending) >= MIN_CLICKS;
	if eligible != clock.eligible {
		clock.eligible = eligible;
		changed = true;
	}
	if changed {
		emit(app, &state_of(&clock, true));
	}
}

/// Watches the account's chests while online mode is on and someone is logged in.
pub(crate) fn start(app: &AppHandle, shared: &Shared) {
	let (app, shared) = (app.clone(), shared.clone());
	std::thread::spawn(move || loop {
		std::thread::sleep(TICK);
		tick(&app, &shared);
	});
}

/// Opens one chest (`"left"` or `"right"`). Blocking. The reward is what the server says it is.
pub(crate) fn open(app: &AppHandle, shared: &Shared, side: &str) -> Result<Value, String> {
	let Some(index) = SIDES.iter().position(|name| *name == side) else { return Err("Unknown chest".into()) };
	if !online_on(shared) {
		return Err("Online mode is off".into());
	}
	let Some(token) = shared.online.token() else { return Err("Not logged in".into()) };
	let fetched = fetch(shared)?;
	match fetched.ready_in[index] {
		Some(0) => {}
		Some(_) => return Err("The chest is not ready yet".into()),
		None => return Err("The server's clock could not be read".into()),
	}
	let pending = shared.online.pending(total_taps(shared));
	if balance(fetched.credited, fetched.consumed, pending) < MIN_CLICKS {
		return Err(format!("Not enough clicks: a chest needs {MIN_CLICKS}"));
	}
	let reply = request(shared, "POST", OPEN_PATH, json!({ "place": side, "click_num": fetched.credited.saturating_add(pending) }));
	if reply["ok"] != json!(true) {
		return Err(reply["error"].as_str().unwrap_or("The chest could not be opened").to_string());
	}
	let data = &reply["data"];
	let consume = count(&data["click_consume"]);
	if consume == 0 {
		return Err("The server's chest reply was not in the expected format".into());
	}
	let name = data["asset_name"].as_str().unwrap_or("").trim().chars().take(64).collect::<String>();
	let kind = data["asset_type"].as_str().unwrap_or("").trim().chars().take(32).collect::<String>();
	if name.is_empty() || kind.is_empty() {
		return Err("The chest opened, but its reward was not in the expected format".into());
	}
	// The server counted every click that was sent with the open: they are no longer this side's to report.
	shared.online.claimed(pending);
	{
		let mut clock = CLOCK.lock().unwrap();
		clock.for_token = Some(token);
		clock.credited = fetched.credited.saturating_add(pending);
		clock.consumed = fetched.consumed.saturating_add(consume);
		let now = Instant::now();
		clock.next_refresh = Some(now + REFRESH_EVERY);
		// The other chest keeps the time the server just gave.
		for (slot, left) in clock.ready_at.iter_mut().zip(fetched.ready_in) {
			*slot = left.map(|ms| now + Duration::from_millis(ms));
		}
		clock.ready_at[index] = Some(now + Duration::from_millis(LOCK_MS));
		clock.eligible = balance(clock.credited, clock.consumed, 0) >= MIN_CLICKS;
		emit(app, &state_of(&clock, true));
	}
	let reward = json!({
		"assetId": data["asset_id"].as_i64().unwrap_or(0),
		"name": name,
		"type": kind,
		"rarity": data["rarity_type"],
		"side": side,
	});
	let _ = app.emit("chest-opened", &reward);
	Ok(reward)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_chest_counts_down_from_the_server_clock() {
		assert_eq!(remaining_ms(&json!(1_000_072_000u64), 1_000_000_000.0), 72_000);
		assert_eq!(remaining_ms(&json!(1_000_000_000u64), 1_000_000_000.0), 0);
		assert_eq!(remaining_ms(&json!(999_000_000u64), 1_000_000_000.0), 0);
	}

	#[test]
	fn no_timestamp_means_ready() {
		assert_eq!(remaining_ms(&Value::Null, 5.0), 0);
		assert_eq!(remaining_ms(&json!("soon"), 5.0), 0);
		assert_eq!(remaining_ms(&json!(0), 5.0), 0);
	}

	#[test]
	fn a_timer_far_in_the_future_is_capped() {
		assert_eq!(remaining_ms(&json!(9.0e15), 1.0), LOCK_MS * 4);
	}

	#[test]
	fn the_server_clock_must_be_a_positive_number() {
		assert_eq!(server_time(&json!({ "data": { "server_time": 1_700_000_000_000u64 } })), Some(1.7e12));
		assert_eq!(server_time(&json!({ "data": { "server_time": 0 } })), None);
		assert_eq!(server_time(&json!({ "data": { "server_time": "x" } })), None);
		assert_eq!(server_time(&json!({ "data": {} })), None);
	}

	#[test]
	fn the_balance_is_credited_minus_consumed_plus_unseen_clicks() {
		assert_eq!(balance(1500, 400, 30), 1130);
		assert_eq!(balance(100, 400, 30), 30);
		assert_eq!(count(&json!(-3)), 0);
		assert_eq!(count(&json!(12.9)), 12);
	}

	#[test]
	fn the_state_has_a_time_per_known_chest() {
		let mut clock = Clock::default();
		clock.ready_at[0] = Some(Instant::now() + Duration::from_secs(90));
		let state = state_of(&clock, true);
		assert!(state["left"].as_u64().unwrap() <= 90_000);
		assert!(state["left"].as_u64().unwrap() > 80_000);
		assert!(state["right"].is_null());
		assert_eq!(state["loggedIn"], json!(true));
	}
}
