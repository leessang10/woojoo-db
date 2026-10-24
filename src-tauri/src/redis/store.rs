use super::types::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[derive(Default, Serialize, Deserialize)]
struct Disk {
    version: u32,
    profiles: Vec<Profile>,
    views: Vec<SavedView>,
}
pub struct Store {
    path: PathBuf,
    data: Disk,
}
impl Store {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let data = if path.exists() {
            let meta = std::fs::metadata(&path).map_err(|_| "STORE: Cannot inspect workspace")?;
            if meta.len() > 2 * 1024 * 1024 {
                return Err("STORE: Workspace exceeds budget".into());
            }
            let data: Disk = serde_json::from_slice(
                &std::fs::read(&path).map_err(|_| "STORE: Cannot read workspace")?,
            )
            .map_err(|_| "STORE: Invalid workspace file")?;
            if data.version != 1 {
                return Err("STORE: Unsupported workspace version".into());
            }
            for p in &data.profiles {
                p.validate()?
            }
            for v in &data.views {
                v.validate()?
            }
            data
        } else {
            Disk {
                version: 1,
                ..Default::default()
            }
        };
        Ok(Self { path, data })
    }
    pub fn workspace(&self) -> Workspace {
        Workspace {
            profiles: self.data.profiles.clone(),
            views: self.data.views.clone(),
            credential_supported: cfg!(windows),
        }
    }
    fn persist(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec(&self.data).map_err(|_| "STORE: Cannot encode workspace")?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("TOO_LARGE: Workspace exceeds budget".into());
        }
        let temp = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|_| "STORE: Cannot create workspace file")?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "STORE: Cannot save workspace")?;
            drop(file);
            replace(&temp, &self.path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temp);
        }
        result
    }
    pub fn save_profile(&mut self, p: Profile) -> Result<(), String> {
        p.validate()?;
        let old = self.data.profiles.clone();
        if let Some(existing) = self.data.profiles.iter_mut().find(|v| v.id == p.id) {
            *existing = p
        } else {
            if self.data.profiles.len() >= 500 {
                return Err("TOO_LARGE: Too many profiles".into());
            }
            self.data.profiles.push(p)
        }
        if let Err(e) = self.persist() {
            self.data.profiles = old;
            return Err(e);
        }
        Ok(())
    }
    pub fn delete_profile(&mut self, id: &str) -> Result<(), String> {
        let oldp = self.data.profiles.clone();
        let oldv = self.data.views.clone();
        self.data.profiles.retain(|p| p.id != id);
        self.data.views.retain(|v| v.profile_id != id);
        if let Err(e) = self.persist() {
            self.data.profiles = oldp;
            self.data.views = oldv;
            return Err(e);
        }
        Ok(())
    }
    pub fn save_view(&mut self, v: SavedView) -> Result<(), String> {
        v.validate()?;
        if !self.data.profiles.iter().any(|p| p.id == v.profile_id) {
            return Err("INVALID_VIEW: Profile does not exist".into());
        }
        let old = self.data.views.clone();
        if let Some(existing) = self.data.views.iter_mut().find(|item| item.id == v.id) {
            *existing = v
        } else {
            if self.data.views.len() >= 1000 {
                return Err("TOO_LARGE: Too many views".into());
            }
            self.data.views.push(v)
        }
        if let Err(e) = self.persist() {
            self.data.views = old;
            return Err(e);
        }
        Ok(())
    }
    pub fn delete_view(&mut self, id: &str) -> Result<(), String> {
        let old = self.data.views.clone();
        self.data.views.retain(|v| v.id != id);
        if let Err(e) = self.persist() {
            self.data.views = old;
            return Err(e);
        }
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    std::fs::rename(from, to).map_err(|_| "STORE: Cannot replace workspace".into())
}
#[cfg(windows)]
fn replace(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        MoveFileExW(
            a.as_ptr(),
            b.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err("STORE: Cannot replace workspace".into())
    } else {
        Ok(())
    }
}
