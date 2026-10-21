//! Passwords stay in the native process and, only with consent, Windows' vault.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use zeroize::Zeroize;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Identity {
    pub engine: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub tls: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct Credential {
    identity: Identity,
    password: String,
}
impl Drop for Credential {
    fn drop(&mut self) { self.password.zeroize(); }
}

#[derive(Serialize)]
pub struct Status {
    pub supported: bool,
    pub saved: bool,
    pub available: bool,
}

#[derive(Default)]
pub(crate) struct Store {
    memory: HashMap<String, Credential>,
    revisions: HashMap<String, u64>,
}

fn target(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("Invalid credential profile ID".into());
    }
    Ok(format!("Woojoo/Database/{id}"))
}

impl Store {
    pub fn revision(&self, id: &str) -> u64 { *self.revisions.get(id).unwrap_or(&0) }

    pub fn status(&self, id: &str, identity: &Identity) -> Result<Status, String> {
        let saved = vault::read(&target(id)?)?.is_some_and(|c| c.identity == *identity);
        let cached = self.memory.get(id).is_some_and(|c| c.identity == *identity);
        Ok(Status { supported: cfg!(windows), saved, available: saved || cached })
    }

    pub fn resolve(&self, id: &str, identity: &Identity) -> Result<Option<String>, String> {
        if let Some(c) = self.memory.get(id).filter(|c| c.identity == *identity) {
            return Ok(Some(c.password.clone()));
        }
        Ok(vault::read(&target(id)?)?.filter(|c| c.identity == *identity).map(|c| c.password.clone()))
    }

    // Call only after authentication succeeds. A concurrent forget wins over an
    // in-flight connection, so deleted credentials cannot be silently recreated.
    pub fn remember(&mut self, id: &str, identity: Identity, password: &str, persist: bool, revision: u64) -> Result<(), String> {
        if self.revision(id) != revision { return Ok(()); }
        let target = target(id)?;
        let credential = Credential { identity, password: password.into() };
        if persist { vault::write(&target, &credential)?; }
        else { vault::delete(&target)?; }
        self.memory.insert(id.into(), credential);
        Ok(())
    }

    pub fn forget(&mut self, id: &str) -> Result<(), String> {
        let target = target(id)?;
        self.memory.remove(id);
        *self.revisions.entry(id.into()).or_default() += 1;
        vault::delete(&target)
    }
}

#[cfg(windows)]
mod vault {
    use super::*;
    use windows_sys::Win32::{Foundation::{GetLastError, ERROR_NOT_FOUND}, Security::Credentials::*};

    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }
    fn failure(code: u32) -> String { format!("Windows Credential Manager error ({code})") }

    pub(super) fn read(target: &str) -> Result<Option<Credential>, String> {
        let target = wide(target);
        let mut raw = std::ptr::null_mut();
        // The pointer is allocated by CredReadW, remains valid until CredFree,
        // and its credential blob is copied into an owned, zeroized-on-drop value.
        unsafe {
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) == 0 {
                let code = GetLastError();
                return if code == ERROR_NOT_FOUND { Ok(None) } else { Err(failure(code)) };
            }
            let size = (*raw).CredentialBlobSize as usize;
            let blob = (*raw).CredentialBlob;
            let result = if blob.is_null() || size == 0 || size > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
                Err("Invalid stored credential; delete it and enter the password again".into())
            } else {
                serde_json::from_slice(std::slice::from_raw_parts(blob, size))
                    .map(Some).map_err(|_| "Invalid stored credential; delete it and enter the password again".into())
            };
            if !blob.is_null() && size <= CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
                std::slice::from_raw_parts_mut(blob, size).zeroize();
            }
            CredFree(raw.cast());
            result
        }
    }

    pub(super) fn write(target: &str, credential: &Credential) -> Result<(), String> {
        let mut target = wide(target);
        let mut username = wide(&credential.identity.username);
        let mut blob = serde_json::to_vec(credential).map_err(|_| "Could not encode credential".to_string())?;
        if blob.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
            blob.zeroize();
            return Err("Credential exceeds Windows Credential Manager size limit".into());
        }
        let raw = CREDENTIALW {
            Type: CRED_TYPE_GENERIC, TargetName: target.as_mut_ptr(),
            UserName: username.as_mut_ptr(), CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(), Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        // CredWriteW copies the blob; buffers above outlive the synchronous call.
        let result = unsafe {
            if CredWriteW(&raw, 0) == 0 { Err(failure(GetLastError())) } else { Ok(()) }
        };
        blob.zeroize();
        result
    }

    pub(super) fn delete(target: &str) -> Result<(), String> {
        let target = wide(target);
        unsafe {
            if CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) != 0 { return Ok(()); }
            let code = GetLastError();
            if code == ERROR_NOT_FOUND { Ok(()) } else { Err(failure(code)) }
        }
    }
}

#[cfg(not(windows))]
mod vault {
    use super::*;
    pub(super) fn read(_: &str) -> Result<Option<Credential>, String> { Ok(None) }
    pub(super) fn delete(_: &str) -> Result<(), String> { Ok(()) }
    pub(super) fn write(_: &str, _: &Credential) -> Result<(), String> {
        Err("Remembering passwords requires Windows Credential Manager".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity() -> Identity {
        Identity { engine:"mysql".into(),host:"db.example".into(),port:3306,database:"app".into(),username:"user".into(),tls:true }
    }
    struct Cleanup(String);
    impl Drop for Cleanup { fn drop(&mut self) { let _ = Store::default().forget(&self.0); } }

    #[test]
    fn session_passwords_are_bound_to_target_and_forgotten() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        let _cleanup = Cleanup(id.clone());
        let mut store = Store::default();
        store.remember(&id, identity(), "test-secret", false, 0).unwrap();
        assert!(store.status(&id, &identity()).unwrap().available);
        assert!(!store.status(&id, &identity()).unwrap().saved);
        assert!(Store::default().resolve(&id, &identity()).unwrap().is_none());
        let mut changed = identity(); changed.host = "other.example".into();
        assert!(store.resolve(&id, &changed).unwrap().is_none());
        changed = identity(); changed.port = 3307;
        assert!(store.resolve(&id, &changed).unwrap().is_none());
        changed = identity(); changed.username = "other".into();
        assert!(store.resolve(&id, &changed).unwrap().is_none());
        changed = identity(); changed.tls = false;
        assert!(store.resolve(&id, &changed).unwrap().is_none());
        store.forget(&id).unwrap();
        store.remember(&id, identity(), "in-flight-secret", false, 0).unwrap();
        assert!(store.resolve(&id, &identity()).unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn windows_vault_survives_new_store_and_supports_deletion() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        let _cleanup = Cleanup(id.clone());
        Store::default().remember(&id, identity(), "test-vault-secret", true, 0).unwrap();
        let mut restarted = Store::default();
        assert!(restarted.status(&id, &identity()).unwrap().saved);
        assert_eq!(restarted.resolve(&id, &identity()).unwrap().as_deref(), Some("test-vault-secret"));
        let mut changed = identity(); changed.tls = false;
        assert!(restarted.resolve(&id, &changed).unwrap().is_none());
        restarted.forget(&id).unwrap();
        assert!(!restarted.status(&id, &identity()).unwrap().available);
    }
}
