//! collection.json: the current save, else its backup, else a fresh collection; a corrupt save is copied aside and
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
	/// In the OS config directory (~/.config, %APPDATA%, Application Support).
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

#[cfg(test)]
mod tests {
	use super::*;

	/// A store in an empty folder of its own, with a fresh collection.
	fn store(name: &str) -> (Store, Backend) {
		let directory = std::env::temp_dir().join(format!("wuwa-tappo-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&directory);
		let store = Store { file: directory.join("collection.json"), writing: Mutex::new(()) };
		(store, Backend::new(crate::CATALOG_JSON).unwrap())
	}

	#[test]
	fn saving_keeps_the_previous_save_which_replaces_an_unreadable_one() {
		let (store, backend) = store("backup");
		assert_eq!(store.load(&backend), "", "a fresh profile is no warning");
		backend.set_pet_position(12.0, 34.0);
		store.save(&backend.state_json()).unwrap();
		backend.set_pet_position(56.0, 78.0);
		store.save(&backend.state_json()).unwrap();
		assert!(!with_suffix(&store.file, ".tmp").exists());

		let position = || backend.state()["settings"]["petPosition"]["x"].as_f64();
		assert_eq!(store.load(&backend), "");
		assert_eq!(position(), Some(56.0));
		std::fs::write(&store.file, "{").unwrap();
		assert_eq!(store.load(&backend), "Restored collection from backup");
		assert_eq!(position(), Some(12.0));
		std::fs::remove_dir_all(store.directory()).unwrap();
	}

	#[test]
	fn an_unreadable_save_without_a_backup_is_kept_aside() {
		let (store, backend) = store("damaged");
		std::fs::create_dir_all(store.directory()).unwrap();
		std::fs::write(&store.file, "not a save").unwrap();
		assert!(store.load(&backend).contains("could not be read"));
		let copies = std::fs::read_dir(store.directory()).unwrap().flatten();
		let kept = copies.filter(|entry| entry.file_name().to_string_lossy().contains(".damaged-")).count();
		assert_eq!(kept, 1);
		std::fs::remove_dir_all(store.directory()).unwrap();
	}
}
