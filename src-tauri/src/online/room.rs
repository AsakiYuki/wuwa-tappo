//! The room (multiplayer) socket: the other members of a room and what they look like, so their pets
//! can be shown on the desktop as the original client does.
//!
//! Provenance: the transport, the handshake query and every event below are from the original bundle
//! (build 1.0.5, room composable `qy`), read statically; see docs/room-protocol.md. None of it has run
//! against the live server. The value formats are read from the client's own parsers: a member is
//! `{ a: userId, n: nickname, b: characterAssetId, c: accessoryAssetId (0 or "" for none), d: "idle" |
//! "left" | "right" }`, a snapshot member `{ u, n, o, l }`.
//!
//! Socket.IO over Engine.IO 3 (what the original's socket.io-client 2.5.0 speaks; 4 is the fallback),
//! WebSocket only, spoken by hand (`0{...}` open, `40` connect, `42` event, `43` ack, `2`/`3` ping/pong)
//! on top of `tungstenite`, so the login token stays on this side.
//! The reconnect delays are the original's. Remote pets are drawn by the `room` window (`web/room.html`),
//! which follows the pet window; it exists only while there is someone to show.

use super::{API_HOST, BROWSER_ORIGIN, BROWSER_USER_AGENT};
use crate::{page_scripts, setting_bool, settings, window, Shared, PET_LABEL};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalSize, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tungstenite::client::IntoClientRequest;
use tungstenite::http::header::{ORIGIN, USER_AGENT};
use tungstenite::http::HeaderValue;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{client_tls_with_config, Error as SocketError, Message, WebSocket};

pub(crate) const ROOM_LABEL: &str = "room";
/// The overlay's size in CSS pixels: a row of pets to the left of the pet window, bottom-aligned with it.
const OVERLAY_SIZE: (f64, f64) = (720.0, 170.0);
/// Engine.IO and the handshake get this long before a connection counts as failed.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a read waits, so commands and a replaced connection are noticed.
const POLL: Duration = Duration::from_millis(250);
/// The original's reconnect delays (5 s, 10 s, 20 s, 40 s, 60 s, then 120 s again and again).
const RECONNECT_SECONDS: [u64; 6] = [5, 10, 20, 40, 60, 120];
/// A request's answer (`rm`, `rd`, `rl`) is waited for this long.
const ACK_TIMEOUT: Duration = Duration::from_secs(8);
/// How often the taps the server has not seen are reported (`cr`).
const CLICK_REPORT_EVERY: Duration = Duration::from_secs(30);
/// Taps closer together than this are one `rc` for the room: nobody can tell them apart on screen.
const TAP_SPACING: Duration = Duration::from_millis(40);
const MAX_MEMBERS: usize = 64;
const DEFAULT_NICKNAME: &str = "Rover";

/* --------------------------------- members --------------------------------- */

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub(super) struct Member {
	pub id: i64,
	pub nickname: String,
	pub owner: bool,
	pub online: bool,
	pub character_asset_id: i64,
	pub part_asset_id: i64,
	pub state: &'static str,
	/// This user chose not to see this member's pet (the eye in the member list). Local only.
	pub hidden: bool,
	/// Counts the taps this member made (the rc event with a, from the server); the overlay moves a hand on each.
	pub tap: u32,
}

impl Member {
	fn new(id: i64) -> Self {
		Member { id, nickname: DEFAULT_NICKNAME.into(), owner: false, online: true, character_asset_id: 0, part_asset_id: 0, state: "idle", hidden: false, tap: 0 }
	}
}

/// `vn`: a positive id as a number or as its canonical decimal text; 0 for anything else.
fn id_of(value: &Value) -> i64 {
	match value {
		Value::Number(number) => number.as_i64().filter(|id| *id > 0).unwrap_or(0),
		Value::String(text) => {
			let text = text.trim();
			text.parse::<i64>().ok().filter(|id| *id > 0 && id.to_string() == text).unwrap_or(0)
		}
		_ => 0,
	}
}

fn flag(value: &Value) -> bool {
	value.as_i64() == Some(1) || value.as_bool() == Some(true)
}

fn state_of(value: &Value) -> Option<&'static str> {
	match value.as_str()?.trim() {
		"idle" => Some("idle"),
		"left" => Some("left"),
		"right" => Some("right"),
		_ => None,
	}
}

/// Every `{ a, b/c, ... }` desktop entry inside an `rd` answer or event: a list, `{ d: list }`, `{ l: list }`
/// or one entry (`Oy`, `Fy` in the original).
fn desktop_entries<'a>(value: &'a Value, out: &mut Vec<&'a Value>, depth: u8) {
	if depth > 4 {
		return;
	}
	match value {
		Value::Array(items) => items.iter().for_each(|item| desktop_entries(item, out, depth + 1)),
		Value::Object(map) => {
			if let Some(Value::Array(list)) = map.get("l") {
				out.extend(list.iter().filter(|item| item.is_object()));
			} else if map.contains_key("a") && (map.contains_key("b") || map.contains_key("c")) {
				out.push(value);
			} else if let Some(inner) = map.get("d") {
				desktop_entries(inner, out, depth + 1);
			}
		}
		_ => {}
	}
}

#[derive(Default)]
pub(super) struct Roster {
	pub members: Vec<Member>,
	/// The room's public flag (the rm answer's p), once known.
	pub public: Option<bool>,
}

impl Roster {
	fn upsert(&mut self, id: i64) -> Option<&mut Member> {
		if let Some(at) = self.members.iter().position(|member| member.id == id) {
			return self.members.get_mut(at);
		}
		if self.members.len() >= MAX_MEMBERS {
			return None;
		}
		self.members.push(Member::new(id));
		self.members.last_mut()
	}

	/// The `rm` answer's `m`: who is in the room, who owns it and who is online. Looks are kept.
	pub(super) fn snapshot(&mut self, list: &Value) {
		let Some(list) = list.as_array() else { return };
		let previous = std::mem::take(&mut self.members);
		for entry in list.iter().take(MAX_MEMBERS) {
			let id = id_of(&entry["u"]);
			if id == 0 {
				continue;
			}
			let mut member = previous.iter().find(|member| member.id == id).cloned().unwrap_or_else(|| Member::new(id));
			member.owner = flag(&entry["o"]);
			member.online = flag(&entry["l"]);
			if let Some(name) = entry["n"].as_str().map(str::trim).filter(|name| !name.is_empty()) {
				member.nickname = name.chars().take(64).collect();
			}
			self.members.push(member);
		}
	}

	/// A member's looks and hand (`rj`, `rc`, and the entries of `rd`). The member is online by it.
	pub(super) fn appearance(&mut self, entry: &Value) {
		let id = id_of(&entry["a"]);
		if id == 0 {
			return;
		}
		let Some(member) = self.upsert(id) else { return };
		member.online = true;
		if let Some(name) = entry["n"].as_str().map(str::trim).filter(|name| !name.is_empty()) {
			member.nickname = name.chars().take(64).collect();
		}
		let character = id_of(&entry["b"]);
		if character > 0 {
			member.character_asset_id = character;
		}
		// No `c`, or an empty or zero one, means no accessory (`co`).
		if entry.get("c").is_some() {
			member.part_asset_id = id_of(&entry["c"]);
		}
		if let Some(state) = state_of(&entry["d"]) {
			member.state = state;
		}
	}

	pub(super) fn desktop(&mut self, data: &Value) {
		let mut entries = Vec::new();
		desktop_entries(data, &mut entries, 0);
		for entry in entries {
			self.appearance(entry);
		}
	}

	/// Members tapped: ids is the server's id|id|....
	pub(super) fn tapped(&mut self, ids: &str) {
		for id in ids.split('|').map(|id| id_of(&Value::String(id.trim().to_string()))).filter(|id| *id > 0) {
			if let Some(member) = self.members.iter_mut().find(|member| member.id == id) {
				member.tap = member.tap.wrapping_add(1);
			}
		}
	}

	pub(super) fn leave(&mut self, id: i64) {
		self.members.retain(|member| member.id != id);
	}

	pub(super) fn offline(&mut self, id: i64) {
		if let Some(member) = self.members.iter_mut().find(|member| member.id == id) {
			member.online = false;
			member.state = "idle";
		}
	}

	pub(super) fn set_owner(&mut self, owner: i64) {
		for member in &mut self.members {
			member.owner = member.id == owner;
		}
	}
}

/* --------------------------------- packets --------------------------------- */

#[derive(PartialEq, Debug)]
pub(super) enum Packet {
	/// Engine.IO open: the server's ping interval and timeout in milliseconds.
	Open { ping_interval: u64, ping_timeout: u64 },
	Ping,
	Connected,
	Disconnected,
	ConnectError(String),
	Event { name: String, data: Value },
	Ack { id: u64, data: Value },
	Other,
}

pub(super) fn parse_packet(text: &str) -> Packet {
	let mut chars = text.chars();
	match chars.next() {
		Some('0') => {
			let info: Value = serde_json::from_str(chars.as_str()).unwrap_or(Value::Null);
			Packet::Open { ping_interval: info["pingInterval"].as_u64().unwrap_or(25_000), ping_timeout: info["pingTimeout"].as_u64().unwrap_or(20_000) }
		}
		Some('1') => Packet::Disconnected,
		Some('2') => Packet::Ping,
		Some('4') => {
			let rest = chars.as_str();
			match rest.chars().next() {
				Some('0') => Packet::Connected,
				Some('1') => Packet::Disconnected,
				Some('4') => Packet::ConnectError(rest[1..].chars().take(200).collect()),
				Some(kind @ ('2' | '3')) => {
					let body = &rest[1..];
					let json_at = body.find(['[', '{']).unwrap_or(body.len());
					let id = body[..json_at].rsplit(',').next().unwrap_or("").parse::<u64>().ok();
					let Ok(Value::Array(mut items)) = serde_json::from_str::<Value>(&body[json_at..]) else { return Packet::Other };
					if items.is_empty() {
						return Packet::Other;
					}
					if kind == '3' {
						return match id {
							Some(id) => Packet::Ack { id, data: items.swap_remove(0) },
							None => Packet::Other,
						};
					}
					let name = items.remove(0);
					match name.as_str() {
						Some(name) => Packet::Event { name: name.to_string(), data: items.into_iter().next().unwrap_or(Value::Null) },
						None => Packet::Other,
					}
				}
				_ => Packet::Other,
			}
		}
		_ => Packet::Other,
	}
}

/// An ack's `{ c, d }`: the data on success (`c` 0 or 200), else the code.
fn ack_result(ack: &Value) -> Result<&Value, i64> {
	match ack["c"].as_i64() {
		Some(0) | Some(200) => Ok(&ack["d"]),
		Some(code) => Err(code),
		None => Err(-1),
	}
}

/* ---------------------------------- socket ---------------------------------- */

enum Command {
	/// An event for the server, with or without a payload (`rc` takes none).
	Emit { name: &'static str, payload: Option<Value> },
	/// An owner's action on a member (`rk` kick, `rt` transfer host); the answer is checked.
	Request { name: &'static str, payload: Value },
	Leave,
	Close,
}

struct Handle {
	generation: u64,
	commands: Option<Sender<Command>>,
}

static ROOM: Mutex<Handle> = Mutex::new(Handle { generation: 0, commands: None });

fn is_current(generation: u64) -> bool {
	ROOM.lock().unwrap().generation == generation
}

fn would_block(error: &std::io::Error) -> bool {
	matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut)
}

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

fn set_read_timeout(socket: &mut Socket, timeout: Duration) {
	let tcp = match socket.get_mut() {
		MaybeTlsStream::Plain(stream) => Some(&*stream),
		MaybeTlsStream::Rustls(stream) => Some(&stream.sock),
		_ => None,
	};
	if let Some(tcp) = tcp {
		let _ = tcp.set_read_timeout(Some(timeout));
	}
}

/// The Engine.IO version the next connection speaks. The original bundles socket.io-client 2.5.0, which is
/// Engine.IO 3 (the client pings, the server connects the namespace itself); 4 is the fallback should the
/// server turn out to speak only that. A connection that dies before the room answered switches it.
static EIO: AtomicU8 = AtomicU8::new(3);

fn socket_url(token: &str, room_no: &str, eio: u8) -> Result<url::Url, String> {
	let host = API_HOST.replacen("https://", "wss://", 1);
	let mut url = url::Url::parse(&format!("{host}/socket.io/")).map_err(|error| error.to_string())?;
	url.query_pairs_mut().append_pair("EIO", &eio.to_string()).append_pair("transport", "websocket").append_pair("token", token).append_pair("rm", room_no);
	Ok(url)
}

fn open(url: &url::Url) -> Result<Socket, String> {
	let host = url.host_str().ok_or("The server address has no host")?;
	let port = url.port_or_known_default().unwrap_or(443);
	let address = (host, port).to_socket_addrs().map_err(|error| format!("Could not resolve the server: {error}"))?.next().ok_or("The server did not resolve")?;
	let stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(|error| format!("Could not reach the server: {error}"))?;
	let _ = stream.set_read_timeout(Some(CONNECT_TIMEOUT));
	let _ = stream.set_write_timeout(Some(CONNECT_TIMEOUT));
	let mut request = url.as_str().into_client_request().map_err(|error| error.to_string())?;
	request.headers_mut().insert(ORIGIN, HeaderValue::from_static(BROWSER_ORIGIN));
	request.headers_mut().insert(USER_AGENT, HeaderValue::from_static(BROWSER_USER_AGENT));
	let (mut socket, _) = client_tls_with_config(request, stream, None, None).map_err(|error| format!("The room connection failed: {error}"))?;
	set_read_timeout(&mut socket, POLL);
	Ok(socket)
}

fn send(socket: &mut Socket, text: String) -> Result<(), String> {
	match socket.send(Message::text(text)) {
		Ok(()) => Ok(()),
		Err(SocketError::Io(error)) if would_block(&error) => Ok(()),
		Err(error) => Err(error.to_string()),
	}
}

#[derive(Serialize, Clone)]
#[serde(tag = "state", rename_all = "camelCase")]
enum Status {
	Connecting,
	Connected,
	/// `message`: why the last attempt failed.
	Reconnecting { message: String },
	Ended { reason: &'static str, message: String },
}

fn emit_status(app: &AppHandle, status: &Status) {
	let _ = app.emit("room-status", status);
}

/// The members last reported, this user's id and the room's public flag, to publish them again when a
/// setting or a "hide this pet" choice changes.
static LAST: Mutex<(Vec<Member>, i64, Option<bool>)> = Mutex::new((Vec::new(), 0, None));
/// Members whose pets this user hid. Kept for the run of the app, across rooms.
static HIDDEN: Mutex<Vec<i64>> = Mutex::new(Vec::new());

fn publish(app: &AppHandle, shared: &Shared, members: &[Member], self_id: i64, public: Option<bool>) {
	let hidden = HIDDEN.lock().unwrap().clone();
	let marked: Vec<Member> = members.iter().cloned().map(|member| Member { hidden: hidden.contains(&member.id), ..member }).collect();
	*LAST.lock().unwrap() = (marked.clone(), self_id, public);
	let _ = app.emit("room-members", json!({ "members": marked, "selfId": self_id, "isPublic": public }));
	sync_window(app, shared, &marked, self_id);
}

fn emit_roster(app: &AppHandle, shared: &Shared, roster: &Roster, self_id: i64) {
	publish(app, shared, &roster.members, self_id, roster.public);
}

/// What a connection ended with.
enum Outcome {
	/// Another connection took over, or the app closed this one.
	Replaced,
	/// The room is over for this user.
	Ended { reason: &'static str, message: String },
	/// The connection dropped; try again after the usual wait.
	Dropped { message: String, was_ready: bool },
}

/// What an ack id was asked for.
#[derive(Clone, Copy, PartialEq)]
enum Pending {
	Snapshot,
	Desktop,
	Leave,
	Action,
	/// A click report (`cr`) of this many taps.
	Clicks(u64),
}

struct Connection<'a> {
	app: &'a AppHandle,
	shared: &'a Shared,
	generation: u64,
	room_no: &'a str,
	self_id: i64,
	roster: Roster,
}

fn session(connection: &mut Connection, commands: &Receiver<Command>) -> Outcome {
	let eio = EIO.load(Ordering::Relaxed);
	let outcome = session_with(connection, commands, eio);
	if let Outcome::Dropped { was_ready: false, message } = &outcome {
		let other = if eio == 3 { 4 } else { 3 };
		EIO.store(other, Ordering::Relaxed);
		eprintln!("room: Engine.IO {eio} failed before the room answered ({message}); next try uses {other}");
	}
	outcome
}

fn session_with(connection: &mut Connection, commands: &Receiver<Command>, eio: u8) -> Outcome {
	let Some(token) = connection.shared.online.token() else {
		return Outcome::Ended { reason: "failed", message: "Not logged in".into() };
	};
	let url = match socket_url(&token, connection.room_no, eio) {
		Ok(url) => url,
		Err(message) => return Outcome::Ended { reason: "failed", message },
	};
	let mut socket = match open(&url) {
		Ok(socket) => socket,
		Err(message) => return Outcome::Dropped { message, was_ready: false },
	};
	let mut next_id = 0u64;
	let mut pending: Vec<(u64, Pending, Instant)> = Vec::new();
	let mut was_ready = false;
	let mut leaving_since: Option<Instant> = None;
	let mut quiet_limit = Duration::from_secs(45);
	let mut opened = false;
	let mut ping_every = Duration::from_secs(25);
	let mut next_ping = Instant::now() + ping_every;
	let mut last_heard = Instant::now();
	let mut next_report = Instant::now();
	let (app, shared) = (connection.app, connection.shared);

	macro_rules! emit_event {
		($kind:expr, $name:expr, $payload:expr) => {{
			next_id += 1;
			pending.push((next_id, $kind, Instant::now()));
			let text = format!("42{}{}", next_id, json!([$name, $payload]));
			if let Err(message) = send(&mut socket, text) {
				return Outcome::Dropped { message, was_ready };
			}
		}};
	}

	loop {
		if !is_current(connection.generation) {
			let _ = socket.close(None);
			return Outcome::Replaced;
		}
		loop {
			match commands.try_recv() {
				Ok(Command::Emit { name, payload }) if was_ready => {
					let text = match payload {
						Some(payload) => format!("42{}", json!([name, payload])),
						None => format!("42{}", json!([name])),
					};
					if let Err(message) = send(&mut socket, text) {
						return Outcome::Dropped { message, was_ready };
					}
				}
				Ok(Command::Emit { .. }) => {}
				Ok(Command::Request { name, payload }) if was_ready => emit_event!(Pending::Action, name, payload),
				Ok(Command::Request { .. }) => {}
				Ok(Command::Leave) if was_ready => {
					leaving_since = Some(Instant::now());
					emit_event!(Pending::Leave, "rl", json!({ "r": connection.room_no }));
				}
				Ok(Command::Leave) | Ok(Command::Close) | Err(TryRecvError::Disconnected) => {
					let _ = socket.close(None);
					return if leaving_since.is_some() || !was_ready { Outcome::Ended { reason: "left", message: String::new() } } else { Outcome::Replaced };
				}
				Err(TryRecvError::Empty) => break,
			}
		}
		// A goodbye the server never answers still ends the room for this user.
		if pending.iter().any(|(_, kind, asked)| *kind == Pending::Leave && asked.elapsed() > ACK_TIMEOUT) {
			let _ = socket.close(None);
			return Outcome::Ended { reason: "left", message: String::new() };
		}
		pending.retain(|(_, _, asked)| asked.elapsed() <= ACK_TIMEOUT);
		// The original reports the taps the server has not seen every 30 s (`cr`).
		if was_ready && Instant::now() >= next_report {
			next_report = Instant::now() + CLICK_REPORT_EVERY;
			let taps = shared.online.pending(super::total_taps(shared));
			if taps > 0 {
				emit_event!(Pending::Clicks(taps), "cr", json!({ "num": taps }));
			}
		}
		// Engine.IO 3: the client pings and the server answers `3`.
		if eio < 4 && opened && Instant::now() >= next_ping {
			next_ping = Instant::now() + ping_every;
			if let Err(message) = send(&mut socket, "2".into()) {
				return Outcome::Dropped { message, was_ready };
			}
		}
		if last_heard.elapsed() > quiet_limit {
			return Outcome::Dropped { message: "The room connection went quiet".into(), was_ready };
		}

		let text = match socket.read() {
			Ok(Message::Text(text)) => text,
			Ok(Message::Close(_)) => return Outcome::Dropped { message: "The server closed the connection".into(), was_ready },
			Ok(_) => continue,
			Err(SocketError::Io(error)) if would_block(&error) => continue,
			Err(error) => return Outcome::Dropped { message: error.to_string(), was_ready },
		};
		last_heard = Instant::now();
		match parse_packet(text.as_str()) {
			Packet::Open { ping_interval, ping_timeout } => {
				quiet_limit = Duration::from_millis(ping_interval.saturating_add(ping_timeout).saturating_add(5_000));
				ping_every = Duration::from_millis(ping_interval.clamp(1_000, 120_000));
				next_ping = Instant::now() + ping_every;
				opened = true;
				// Engine.IO 4 clients connect the namespace; with 3 the server does it on its own.
				if eio >= 4 {
					if let Err(message) = send(&mut socket, "40".into()) {
						return Outcome::Dropped { message, was_ready };
					}
				}
			}
			Packet::Ping => {
				if let Err(message) = send(&mut socket, "3".into()) {
					return Outcome::Dropped { message, was_ready };
				}
			}
			Packet::Connected => emit_event!(Pending::Snapshot, "rm", json!({ "r": connection.room_no })),
			Packet::ConnectError(message) => return Outcome::Dropped { message: format!("The server refused the room connection: {message}"), was_ready },
			Packet::Disconnected => return Outcome::Dropped { message: "The server ended the room connection".into(), was_ready },
			Packet::Ack { id, data } => {
				let Some(at) = pending.iter().position(|(pending_id, _, _)| *pending_id == id) else { continue };
				let (_, kind, _) = pending.remove(at);
				match kind {
					Pending::Leave => {
						let _ = socket.close(None);
						return Outcome::Ended { reason: "left", message: String::new() };
					}
					Pending::Snapshot => match ack_result(&data) {
						Ok(snapshot) => {
							if snapshot["r"].as_str().is_none() && snapshot["r"].as_i64().is_none() || !snapshot["m"].is_array() {
								return Outcome::Ended { reason: "failed", message: "The server's room snapshot was not in the expected format".into() };
							}
							connection.roster.snapshot(&snapshot["m"]);
							connection.roster.public = match snapshot["p"].as_i64() {
								Some(0) => Some(false),
								Some(1) => Some(true),
								_ => None,
							};
							was_ready = true;
							emit_status(app, &Status::Connected);
							emit_roster(app, shared, &connection.roster, connection.self_id);
							emit_event!(Pending::Desktop, "rd", json!({ "r": connection.room_no }));
							// Tells the room how this user looks (`rc { b, c }`, as `za` does in the original) and
							// reports the taps made so far.
							if let Err(message) = send(&mut socket, looks_event()) {
								return Outcome::Dropped { message, was_ready };
							}
							next_report = Instant::now();
						}
						// 80007: the room no longer exists.
						Err(80007) => return Outcome::Ended { reason: "dismissed", message: "The room no longer exists".into() },
						Err(code) => return Outcome::Dropped { message: format!("The room snapshot failed (code {code})"), was_ready },
					},
					Pending::Clicks(num) => {
						// The server has counted them; only now are they no longer this side's to report.
						if ack_result(&data).is_ok() {
							shared.online.claimed(num);
						}
					}
					Pending::Action => {
						if let Err(code) = ack_result(&data) {
							let _ = app.emit("room-error", json!({ "message": format!("The server refused the request (code {code})") }));
						}
					}
					Pending::Desktop => {
						if let Ok(desktop) = ack_result(&data) {
							connection.roster.desktop(desktop);
							emit_roster(app, shared, &connection.roster, connection.self_id);
						}
					}
				}
			}
			Packet::Event { name, data } => {
				if let Some(outcome) = handle_event(connection, &name, &data) {
					let _ = socket.close(None);
					return outcome;
				}
			}
			Packet::Other => {}
		}
	}
}

/// One server event. `Some` when it ends the room for this user.
fn handle_event(connection: &mut Connection, name: &str, data: &Value) -> Option<Outcome> {
	let self_id = connection.self_id;
	match name {
		"rj" | "rd" => {
			if name == "rj" {
				connection.roster.appearance(data);
			} else {
				connection.roster.desktop(data);
			}
		}
		"rc" => {
			// `{ a: "id|id" }` is somebody tapping, `{ o, a }` only a nudge; anything else carries looks.
			let object = data.as_object()?;
			if let Some(ids) = object.get("a").and_then(Value::as_str) {
				// Everyone but this user: their own tap already moved their own pet.
				let own = self_id.to_string();
				let others: Vec<&str> = ids.split('|').filter(|id| id.trim() != own).collect();
				connection.roster.tapped(&others.join("|"));
			} else if !is_nudge(object) {
				connection.roster.appearance(data);
			}
		}
		"rl" => {
			let id = id_of(&data["a"]);
			if id == 0 {
				return None;
			}
			if id == self_id {
				return Some(Outcome::Ended { reason: "left", message: "You are no longer in the room".into() });
			}
			connection.roster.leave(id);
		}
		"ro" => connection.roster.offline(id_of(&data["a"])),
		"rk" => {
			let ids: Vec<i64> = data["u"].as_array()?.iter().map(id_of).filter(|id| *id > 0).collect();
			if ids.contains(&self_id) {
				return Some(Outcome::Ended { reason: "kicked", message: "You were removed from the room".into() });
			}
			for id in ids {
				connection.roster.leave(id);
			}
		}
		"rt" => {
			let owner = id_of(&data["o"]);
			if owner > 0 {
				connection.roster.set_owner(owner);
			}
		}
		"rs" => return Some(Outcome::Ended { reason: "dismissed", message: "The room was dismissed".into() }),
		"ru" => {
			let member = id_of(&data["u"]);
			let emote = match &data["e"] {
				Value::Number(number) => number.as_i64().filter(|id| *id > 0).map(Value::from),
				Value::String(text) => Some(text.trim().trim_end_matches(".png").to_string()).filter(|text| !text.is_empty()).map(Value::from),
				_ => None,
			};
			if let (true, Some(emote)) = (member > 0 && member != self_id, emote) {
				let _ = connection.app.emit("room-emote", json!({ "memberId": member, "emote": emote }));
			}
			return None;
		}
		"fd" => {
			let code = data["c"].as_i64().unwrap_or(0);
			return Some(Outcome::Ended { reason: "forced", message: format!("The server closed your room connection (code {code})") });
		}
		_ => return None,
	}
	emit_roster(connection.app, connection.shared, &connection.roster, self_id);
	None
}

fn is_nudge(object: &Map<String, Value>) -> bool {
	object.len() == 2 && object.contains_key("o") && object.contains_key("a")
}

fn run(app: AppHandle, shared: Shared, generation: u64, room_no: String, self_id: i64, commands: Receiver<Command>) {
	let mut connection = Connection { app: &app, shared: &shared, generation, room_no: &room_no, self_id, roster: Roster::default() };
	let mut attempt = 0usize;
	emit_status(&app, &Status::Connecting);
	let outcome = loop {
		match session(&mut connection, &commands) {
			Outcome::Dropped { message, was_ready } => {
				if !is_current(generation) {
					break Outcome::Replaced;
				}
				if was_ready {
					attempt = 0;
				}
				eprintln!("room: {message}");
				emit_status(&app, &Status::Reconnecting { message });
				let wait = Duration::from_secs(RECONNECT_SECONDS[attempt.min(RECONNECT_SECONDS.len() - 1)]);
				attempt += 1;
				let until = Instant::now() + wait;
				let mut stop = None;
				while stop.is_none() && Instant::now() < until {
					std::thread::sleep(POLL);
					if !is_current(generation) {
						stop = Some(Outcome::Replaced);
					}
					match commands.try_recv() {
						Ok(Command::Close) | Ok(Command::Leave) | Err(TryRecvError::Disconnected) => stop = Some(Outcome::Replaced),
						_ => {}
					}
				}
				if let Some(outcome) = stop {
					break outcome;
				}
				emit_status(&app, &Status::Connecting);
			}
			other => break other,
		}
	};
	if let Outcome::Ended { reason, message } = outcome {
		if is_current(generation) {
			emit_status(&app, &Status::Ended { reason, message });
			emit_roster(&app, &shared, &Roster::default(), self_id);
		}
	}
}

/* --------------------------------- commands --------------------------------- */

fn online_enabled(shared: &Shared) -> bool {
	setting_bool(&settings(shared), "onlineMode", false)
}

/// Connects the room socket for the room the server just put this user in. Replaces any earlier connection.
pub(super) fn connect(app: &AppHandle, shared: &Shared, room_no: &str, self_id: i64) -> Result<(), String> {
	if !online_enabled(shared) {
		return Err("Online mode is off".into());
	}
	if shared.online.token().is_none() {
		return Err("Not logged in".into());
	}
	let room_no = room_no.trim();
	if room_no.is_empty() || room_no.len() > 32 || !room_no.chars().all(|ch| ch.is_ascii_alphanumeric()) {
		return Err("Unknown room number".into());
	}
	// 0 is allowed: the room still works, only this user's own pet cannot be told apart from the others'.
	if self_id < 0 {
		return Err("The account id is not valid".into());
	}
	let (sender, receiver) = channel();
	let generation = {
		let mut handle = ROOM.lock().unwrap();
		if let Some(old) = handle.commands.take() {
			let _ = old.send(Command::Close);
		}
		handle.generation += 1;
		handle.commands = Some(sender);
		handle.generation
	};
	let (app, shared, room_no) = (app.clone(), shared.clone(), room_no.to_string());
	std::thread::spawn(move || run(app, shared, generation, room_no, self_id, receiver));
	Ok(())
}

/// Leaves the room on the socket (`rl`) and closes it.
pub(super) fn leave() {
	if let Some(commands) = ROOM.lock().unwrap().commands.as_ref() {
		let _ = commands.send(Command::Leave);
	}
}

/// Tells the room this user's looks changed (`rc` without a payload: the server reads them from the account).
pub(super) fn looks_changed() {
	if let Some(commands) = ROOM.lock().unwrap().commands.as_ref() {
		let _ = commands.send(Command::Emit { name: "rc", payload: None });
	}
}

/// Drops the connection without a goodbye (logout, online mode turned off). Hides the pets.
pub(crate) fn disconnect(app: &AppHandle, shared: &Shared) {
	{
		let mut handle = ROOM.lock().unwrap();
		if let Some(old) = handle.commands.take() {
			let _ = old.send(Command::Close);
		}
		handle.generation += 1;
	}
	emit_roster(app, shared, &Roster::default(), 0);
}

/// Settings changed: online mode off ends the room; "only show my pet" hides or shows the others.
pub(crate) fn apply_settings(app: &AppHandle, shared: &Shared) {
	if !online_enabled(shared) {
		disconnect(app, shared);
		return;
	}
	let (members, self_id, _) = LAST.lock().unwrap().clone();
	sync_window(app, shared, &members, self_id);
}

/// The eye in the member list: show or hide one member's pet on the desktop.
pub(super) fn set_hidden(app: &AppHandle, shared: &Shared, member: i64, hidden: bool) {
	{
		let mut list = HIDDEN.lock().unwrap();
		list.retain(|id| *id != member);
		if hidden && list.len() < MAX_MEMBERS * 4 {
			list.push(member);
		}
	}
	let (members, self_id, public) = LAST.lock().unwrap().clone();
	publish(app, shared, &members, self_id, public);
}

/// An owner's action on another member: `kick` or `transfer` (host).
pub(super) fn member_action(action: &str, member: i64) -> Result<(), String> {
	let name = match action {
		"kick" => "rk",
		"transfer" => "rt",
		_ => return Err("Unknown room action".into()),
	};
	if member <= 0 {
		return Err("Unknown member".into());
	}
	match ROOM.lock().unwrap().commands.as_ref() {
		Some(commands) => commands.send(Command::Request { name, payload: json!({ "u": member }) }).map_err(|_| "The room connection is closed".to_string()),
		None => Err("Not in a room".into()),
	}
}

/* ------------------------- what this user tells the room ------------------------- */

/// The catalog asset ids of this user's skin and accessory (0 for none), as the studio last reported them.
static LOOKS: Mutex<(i64, i64)> = Mutex::new((0, 0));

/// `rc { b, c }`: the skin and accessory (`c` left out for none); a bare `rc` while the skin is not known.
fn looks_event() -> String {
	let (character, accessory) = *LOOKS.lock().unwrap();
	match (character > 0, accessory > 0) {
		(true, true) => format!("42{}", json!(["rc", { "b": character, "c": accessory }])),
		(true, false) => format!("42{}", json!(["rc", { "b": character }])),
		_ => format!("42{}", json!(["rc"])),
	}
}

/// The studio's outfit changed (or it joined a room): remembers it and, in a room, tells the others.
pub(super) fn looks(character: i64, accessory: i64) {
	*LOOKS.lock().unwrap() = (character.max(0), accessory.max(0));
	if let Some(commands) = ROOM.lock().unwrap().commands.as_ref() {
		let payload = match (character > 0, accessory > 0) {
			(true, true) => Some(json!({ "b": character, "c": accessory })),
			(true, false) => Some(json!({ "b": character })),
			_ => None,
		};
		let _ = commands.send(Command::Emit { name: "rc", payload });
	}
}

static LAST_TAP: Mutex<Option<Instant>> = Mutex::new(None);

/// A tap of this pet: the room sees its hand move (a bare `rc`, as `syncAction` sends in the original).
pub(crate) fn tap(shared: &Shared) {
	if !online_enabled(shared) {
		return;
	}
	{
		let mut last = LAST_TAP.lock().unwrap();
		if last.is_some_and(|at| at.elapsed() < TAP_SPACING) {
			return;
		}
		*last = Some(Instant::now());
	}
	if let Some(commands) = ROOM.lock().unwrap().commands.as_ref() {
		let _ = commands.send(Command::Emit { name: "rc", payload: None });
	}
}

/// The catalog's asset id for an item id (`emote:1615` -> 1615), from the same catalog the pages use.
fn asset_of(item_id: &str) -> Option<i64> {
	static ASSETS: OnceLock<HashMap<String, i64>> = OnceLock::new();
	ASSETS
		.get_or_init(|| {
			let catalog: Value = serde_json::from_str(crate::CATALOG_JSON).unwrap_or(Value::Null);
			catalog["items"]
				.as_array()
				.map(|items| items.iter().filter_map(|item| Some((item["id"].as_str()?.to_string(), item["assetId"].as_i64()?))).collect::<HashMap<String, i64>>())
				.unwrap_or_default()
		})
		.get(item_id)
		.copied()
}

/// This pet played an emote: the room sees it (`re { e }`). The value is the emote's catalog asset id; the
/// original sends the emote's own id string, which this app's catalog does not carry (unconfirmed).
pub(crate) fn emote(shared: &Shared, item_id: &str) {
	if !online_enabled(shared) {
		return;
	}
	let Some(asset) = asset_of(item_id) else { return };
	if let Some(commands) = ROOM.lock().unwrap().commands.as_ref() {
		let _ = commands.send(Command::Emit { name: "re", payload: Some(json!({ "e": asset })) });
	}
}

/// The members last published, for a page that opened after the event (the overlay window).
pub(super) fn snapshot() -> Value {
	let (members, self_id, public) = LAST.lock().unwrap().clone();
	json!({ "members": members, "selfId": self_id, "isPublic": public })
}

/* ---------------------------------- window ---------------------------------- */

/// Whether the overlay has someone to show, kept for `apply_settings` and moves of the pet window.
static VISIBLE: Mutex<bool> = Mutex::new(false);

fn should_show(shared: &Shared, members: &[Member], self_id: i64) -> bool {
	let settings = settings(shared);
	online_enabled(shared)
		&& !setting_bool(&settings, "onlyShowMyPet", false)
		&& members.iter().any(|member| member.id != self_id && member.online && !member.hidden && member.character_asset_id > 0)
}

fn build_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
	let window = WebviewWindowBuilder::new(app, ROOM_LABEL, WebviewUrl::App("web/room.html".into()))
		.title("Wuwa Tappo Room")
		.inner_size(OVERLAY_SIZE.0, OVERLAY_SIZE.1)
		.transparent(true)
		.decorations(false)
		.shadow(false)
		.resizable(false)
		.skip_taskbar(true)
		.always_on_top(true)
		.visible_on_all_workspaces(true)
		.focused(false)
		.visible(false)
		.initialization_script(page_scripts())
		.build()?;
	#[cfg(target_os = "linux")]
	if let Ok(gtk_window) = window.gtk_window() {
		gtk::prelude::WidgetExt::realize(&gtk_window);
	}
	// The pets are only to look at: every click goes through to what is behind them.
	window.set_ignore_cursor_events(true)?;
	Ok(window)
}

/// Shows or hides the overlay for the current members. On a Wayland layer-shell session there is no
/// way to place a window beside the pet, so the overlay is not used there.
fn sync_window(app: &AppHandle, shared: &Shared, members: &[Member], self_id: i64) {
	if crate::layer_pet() {
		return;
	}
	let show = should_show(shared, members, self_id);
	*VISIBLE.lock().unwrap() = show;
	let handle = app.clone();
	let _ = app.run_on_main_thread(move || {
		let existing = window(&handle, ROOM_LABEL);
		if !show {
			if let Some(window) = existing {
				let _ = window.hide();
			}
			return;
		}
		let Some(window) = existing.or_else(|| build_window(&handle).map_err(|error| eprintln!("room: could not create the overlay: {error}")).ok()) else { return };
		follow_pet(&handle);
		let _ = window.show();
	});
}

/// Puts the overlay directly left of the pet window, bottom-aligned with it.
pub(crate) fn follow_pet(app: &AppHandle) {
	if !*VISIBLE.lock().unwrap() {
		return;
	}
	let (Some(pet), Some(room)) = (window(app, PET_LABEL), window(app, ROOM_LABEL)) else { return };
	let (Ok(position), Ok(size), Ok(scale)) = (pet.outer_position(), pet.outer_size(), pet.scale_factor()) else { return };
	let overlay = LogicalSize::new(OVERLAY_SIZE.0, OVERLAY_SIZE.1).to_physical::<u32>(scale);
	let left = pet.current_monitor().ok().flatten().map_or(i32::MIN, |monitor| monitor.position().x);
	let x = position.x.saturating_sub(overlay.width as i32).max(left);
	let y = position.y.saturating_add(size.height as i32).saturating_sub(overlay.height as i32);
	let _ = room.set_size(LogicalSize::new(OVERLAY_SIZE.0, OVERLAY_SIZE.1));
	let _ = room.set_position(PhysicalPosition::new(x, y));
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn engine_and_socket_io_packets_are_told_apart() {
		assert_eq!(parse_packet(r#"0{"sid":"x","pingInterval":25000,"pingTimeout":20000}"#), Packet::Open { ping_interval: 25_000, ping_timeout: 20_000 });
		assert_eq!(parse_packet("2"), Packet::Ping);
		assert_eq!(parse_packet(r#"40{"sid":"abc"}"#), Packet::Connected);
		assert_eq!(parse_packet("41"), Packet::Disconnected);
		assert_eq!(parse_packet(r#"44{"message":"no"}"#), Packet::ConnectError(r#"{"message":"no"}"#.into()));
		assert_eq!(parse_packet(r#"42["rj",{"a":7,"n":"N","b":3}]"#), Packet::Event { name: "rj".into(), data: json!({ "a": 7, "n": "N", "b": 3 }) });
		assert_eq!(parse_packet(r#"42["rs"]"#), Packet::Event { name: "rs".into(), data: Value::Null });
		assert_eq!(parse_packet(r#"431[{"c":0,"d":{"r":"R1"}}]"#), Packet::Ack { id: 1, data: json!({ "c": 0, "d": { "r": "R1" } }) });
		assert_eq!(parse_packet(r#"4312[{"c":0}]"#), Packet::Ack { id: 12, data: json!({ "c": 0 }) });
		assert_eq!(parse_packet("42not json"), Packet::Other);
		assert_eq!(parse_packet("3"), Packet::Other);
		assert_eq!(parse_packet(""), Packet::Other);
	}

	#[test]
	fn an_ack_is_a_success_only_for_code_0_or_200() {
		assert!(ack_result(&json!({ "c": 0, "d": 1 })).is_ok());
		assert!(ack_result(&json!({ "c": 200 })).is_ok());
		assert_eq!(ack_result(&json!({ "c": 80007 })), Err(80007));
		assert_eq!(ack_result(&json!({})), Err(-1));
	}

	#[test]
	fn ids_are_positive_numbers_or_their_canonical_text() {
		assert_eq!(id_of(&json!(42)), 42);
		assert_eq!(id_of(&json!(" 42 ")), 42);
		assert_eq!(id_of(&json!("042")), 0);
		assert_eq!(id_of(&json!(-1)), 0);
		assert_eq!(id_of(&json!("")), 0);
		assert_eq!(id_of(&json!(null)), 0);
	}

	#[test]
	fn a_snapshot_lists_the_room_and_keeps_known_looks() {
		let mut roster = Roster::default();
		roster.appearance(&json!({ "a": 2, "n": "B", "b": 11, "c": 22, "d": "left" }));
		roster.snapshot(&json!([{ "u": 1, "n": "A", "o": 1, "l": 1 }, { "u": 2, "n": "B", "o": 0, "l": 0 }, { "u": 0 }]));
		assert_eq!(roster.members.len(), 2);
		assert!(roster.members[0].owner && roster.members[0].online);
		let two = &roster.members[1];
		assert!(!two.online && !two.owner);
		assert_eq!((two.character_asset_id, two.part_asset_id, two.state), (11, 22, "left"));
	}

	#[test]
	fn looks_come_from_lists_wrappers_and_single_entries() {
		let mut roster = Roster::default();
		roster.desktop(&json!({ "c": 0, "d": [{ "a": 5, "b": 1, "c": 2, "d": "idle" }, { "a": 6, "b": "3", "c": "", "d": "right" }] }));
		assert_eq!(roster.members.iter().map(|member| (member.id, member.character_asset_id, member.part_asset_id, member.state)).collect::<Vec<_>>(), [(5, 1, 2, "idle"), (6, 3, 0, "right")]);
		roster.desktop(&json!({ "l": [{ "a": 5, "b": 9 }] }));
		assert_eq!(roster.members[0].character_asset_id, 9);
		assert_eq!(roster.members[0].part_asset_id, 2, "a missing `c` leaves the accessory alone");
		roster.appearance(&json!({ "a": 5, "c": 0, "d": "sideways" }));
		assert_eq!((roster.members[0].part_asset_id, roster.members[0].state), (0, "idle"), "`c` 0 takes it off, an unknown hand is ignored");
		roster.desktop(&json!("nothing"));
		assert_eq!(roster.members.len(), 2);
	}

	#[test]
	fn members_leave_go_offline_and_pass_ownership() {
		let mut roster = Roster::default();
		roster.snapshot(&json!([{ "u": 1, "o": 1, "l": 1 }, { "u": 2, "o": 0, "l": 1 }]));
		roster.appearance(&json!({ "a": 2, "b": 4, "d": "left" }));
		roster.set_owner(2);
		assert_eq!((roster.members[0].owner, roster.members[1].owner), (false, true));
		roster.offline(2);
		assert_eq!((roster.members[1].online, roster.members[1].state), (false, "idle"));
		roster.leave(1);
		assert_eq!(roster.members.len(), 1);
	}

	#[test]
	fn taps_count_for_the_members_named_and_for_nobody_else() {
		let mut roster = Roster::default();
		roster.snapshot(&json!([{ "u": 1 }, { "u": 2 }]));
		roster.tapped("2|2| 1 |9|x||");
		assert_eq!((roster.members[0].tap, roster.members[1].tap), (1, 2));
	}

	#[test]
	fn the_socket_url_carries_the_token_and_the_room() {
		let url = socket_url("t&k", "R1", 3).unwrap();
		assert_eq!(url.scheme(), "wss");
		assert_eq!(url.path(), "/socket.io/");
		let pairs: Vec<_> = url.query_pairs().map(|(key, value)| (key.to_string(), value.to_string())).collect();
		assert_eq!(pairs, [("EIO".into(), "3".into()), ("transport".into(), "websocket".into()), ("token".into(), "t&k".into()), ("rm".into(), "R1".into())]);
	}
}
