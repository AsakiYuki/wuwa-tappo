//! The game logic (src/backend, bundled by vite.backend.mts) running in QuickJS: draws, synthesis,
//! equipping, presets and tap counting.
//!
//! Values cross the boundary as strings and numbers only; JSON is parsed on the Rust side.

use rquickjs::function::IntoArgs;
use rquickjs::{CatchResultExt, Context, FromJs, Function, Object, Runtime};
use serde_json::Value;

const SCRIPT: &str = include_str!("../frontend/backend.js");

pub struct Backend {
	// Declared before the runtime, so the context is dropped first.
	context: Context,
	_runtime: Runtime,
}

impl Backend {
	pub fn new(catalog_json: &str) -> Result<Self, String> {
		let runtime = Runtime::new().map_err(|error| error.to_string())?;
		let context = Context::full(&runtime).map_err(|error| error.to_string())?;
		context.with(|ctx| ctx.eval::<(), _>(SCRIPT).catch(&ctx).map(|_| ()).map_err(|error| error.to_string()))?;
		let backend = Backend { context, _runtime: runtime };
		backend.call::<()>("init", (catalog_json.to_string(),))?;
		Ok(backend)
	}

	fn call<R>(&self, name: &str, args: impl for<'js> IntoArgs<'js>) -> Result<R, String>
	where
		R: for<'js> FromJs<'js>,
	{
		self.context.with(|ctx| {
			let run = || -> rquickjs::Result<R> {
				let backend: Object = ctx.globals().get("WuwaBackend")?;
				let function: Function = backend.get(name)?;
				function.call(args)
			};
			run().catch(&ctx).map_err(|error| format!("backend.{name}: {error}"))
		})
	}

	/// Replaces the state with a save's text; false (state unchanged) if it is not a valid save.
	pub fn load(&self, text: &str) -> bool {
		self.call("load", (text.to_string(),)).unwrap_or(false)
	}

	/// The whole state as pretty JSON, exactly what is written to collection.json.
	pub fn state_json(&self) -> String {
		self.call("state", ()).expect("backend state")
	}

	pub fn state(&self) -> Value {
		serde_json::from_str(&self.state_json()).expect("backend state is JSON")
	}

	/// Runs a collection command; the reply is `{ ok, result?, error?, previousSettings? }`.
	pub fn command(&self, name: &str, argument: &Value) -> Value {
		let reply: Result<String, String> = self.call("command", (name.to_string(), argument.to_string()));
		match reply {
			Ok(text) => serde_json::from_str(&text).unwrap_or(Value::Null),
			Err(error) => serde_json::json!({ "ok": false, "error": error }),
		}
	}

	/// Counts one tap: `{ emote, count, totalCount, dailyCount }`.
	pub fn tap(&self) -> Value {
		let text: String = self.call("tap", ()).expect("backend tap");
		serde_json::from_str(&text).expect("tap reply is JSON")
	}

	pub fn can_play_emote(&self, id: &str) -> bool {
		self.call("canPlayEmote", (id.to_string(),)).unwrap_or(false)
	}

	pub fn set_pet_position(&self, x: f64, y: f64) {
		let _ = self.call::<()>("setPetPosition", (x, y));
	}
}
