//! collection.json, shared with the Electron app and handled the same way (src/node/storage.ts):
//! the current save, else its backup, else a fresh collection; a corrupt save is copied aside and
//! never overwritten unseen. Writes go to a temp file, keep a .bak of the previous save, then rename.

use crate::backend::Backend;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Store {
	file: PathBuf,
	/// Serialises writes, so an older state can never land after a newer one.
	writing: Mutex<()>,
}

fn with_suffix(file: &Path, suffix: &str) -> PathBuf {
	let mut name = file.as_os_str().to_owned();
	name.push(suffix);
	PathBuf::from(name)
}

impl Store {
	/// Electron's `appData` is the OS config directory (~/.config, %APPDATA%, Application Support).
	pub fn new() -> Option<Self> {
		let directory = dirs::config_dir()?.join("wuwa-tappo");
		Some(Store { file: directory.join("collection.json"), writing: Mutex::new(()) })
	}

	pub fn directory(&self) -> &Path {
		self.file.parent().expect("save file has a folder")
	}

	/// Loads the profile into `backend` (which starts with a fresh collection) and returns a warning
	/// for the user, empty when everything was fine.
	pub fn load(&self, backend: &Backend) -> String {
		let _ = std::fs::create_dir_all(self.directory());
		let read = |file: &Path| std::fs::read_to_string(file).ok().filter(|text| backend.load(text));

		if read(&self.file).is_some() {
			return String::new();
		}
		if read(&with_suffix(&self.file, ".bak")).is_some() {
			return "Restored collection from backup".into();
		}
		if self.file.exists() {
			let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis()).unwrap_or(0);
			let _ = std::fs::copy(&self.file, with_suffix(&self.file, &format!(".damaged-{stamp}")));
			return "The save could not be read. The original file was kept; open the save folder in Settings to recover it."
				.into();
		}
		String::new()
	}

	pub fn save(&self, content: &str) -> std::io::Result<()> {
		let _guard = self.writing.lock().unwrap();
		let temp = with_suffix(&self.file, ".tmp");
		std::fs::create_dir_all(self.directory())?;
		std::fs::write(&temp, content)?;
		match std::fs::copy(&self.file, with_suffix(&self.file, ".bak")) {
			Ok(_) => {}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Err(error) => return Err(error),
		}
		std::fs::rename(&temp, &self.file)
	}
}
