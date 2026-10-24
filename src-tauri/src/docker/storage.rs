use super::{cli, engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock, Mutex,
    },
};

#[derive(Default)]
struct MaintenanceGate {
    busy: AtomicBool,
    operations: tokio::sync::RwLock<()>,
}
static GATE: LazyLock<MaintenanceGate> = LazyLock::new(Default::default);
static DISKS: LazyLock<Mutex<HashMap<String, Disk>>> = LazyLock::new(Default::default);
pub fn busy() -> bool {
    GATE.busy.load(Ordering::SeqCst)
}
pub(super) async fn operation() -> Result<tokio::sync::RwLockReadGuard<'static, ()>, String> {
    GATE.operation().await
}
struct Maintenance<'a> {
    gate: &'a MaintenanceGate,
    permit: Option<tokio::sync::RwLockWriteGuard<'a, ()>>,
}
impl MaintenanceGate {
    async fn operation(&self) -> Result<tokio::sync::RwLockReadGuard<'_, ()>, String> {
        if self.busy.load(Ordering::SeqCst) {
            return Err("DOCKER_MAINTENANCE_BUSY".into());
        }
        let permit = self.operations.read().await;
        if self.busy.load(Ordering::SeqCst) {
            return Err("DOCKER_MAINTENANCE_BUSY".into());
        }
        Ok(permit)
    }
    async fn begin(&self) -> Result<Maintenance<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "DOCKER_MAINTENANCE_BUSY")?;
        // The guard clears busy even if this future is canceled while draining commands.
        let mut guard = Maintenance {
            gate: self,
            permit: None,
        };
        guard.permit = Some(self.operations.write().await);
        Ok(guard)
    }
}
impl Drop for Maintenance<'_> {
    fn drop(&mut self) {
        self.gate.busy.store(false, Ordering::SeqCst);
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    id: String,
    path: String,
    file_bytes: u64,
    allocated_bytes: u64,
    token: String,
}

fn fingerprint(path: &Path, metadata: &std::fs::Metadata) -> Result<String, String> {
    let mut hash = DefaultHasher::new();
    path.hash(&mut hash);
    metadata.len().hash(&mut hash);
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        (
            info.dwVolumeSerialNumber,
            info.nFileIndexHigh,
            info.nFileIndexLow,
        )
            .hash(&mut hash);
    }
    metadata
        .modified()
        .map_err(|e| e.to_string())?
        .hash(&mut hash);
    Ok(format!("{:x}", hash.finish()))
}
fn validate_file(path: &Path) -> Result<PathBuf, String> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.is_file()
        || !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("vhdx"))
    {
        return Err("DOCKER_DISK_INVALID: select a VHDX file".into());
    }
    #[cfg(windows)]
    if path
        .to_string_lossy()
        .to_uppercase()
        .starts_with(r"\\?\UNC\")
    {
        return Err("DOCKER_DISK_INVALID: network paths are not supported".into());
    }
    let mut header = [0; 8];
    std::fs::File::open(&path)
        .and_then(|mut f| f.read_exact(&mut header))
        .map_err(|e| e.to_string())?;
    if &header != b"vhdxfile" {
        return Err("DOCKER_DISK_INVALID: invalid VHDX header".into());
    }
    Ok(path)
}
fn disk(path: &Path) -> Result<Disk, String> {
    let path = validate_file(path)?;
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    Ok(Disk {
        id: uuid::Uuid::new_v4().to_string(),
        token: fingerprint(&path, &metadata)?,
        path: path.to_string_lossy().into_owned(),
        file_bytes: metadata.len(),
        allocated_bytes: allocated(&path)?,
    })
}
fn remember(disk: Disk) -> Result<Disk, String> {
    let mut cache = DISKS.lock().map_err(|_| "DOCKER_BUSY")?;
    cache.retain(|_, old| old.path != disk.path);
    if cache.len() >= 32 {
        cache.clear();
    }
    cache.insert(disk.id.clone(), disk.clone());
    Ok(disk)
}
fn candidates(root: &Path) -> Vec<PathBuf> {
    // Only Docker data disks; main/ext4.vhdx is the engine distro, not user data.
    vec![
        root.join("Docker/wsl/disk/docker_data.vhdx"),
        root.join("Docker/wsl/data/ext4.vhdx"),
    ]
}
async fn local_context(context: &str) -> Result<bool, String> {
    if !cfg!(windows) {
        return Ok(false);
    }
    let raw = cli::run(
        None,
        &[
            "context",
            "inspect",
            context,
            "--format",
            "{{json .Endpoints.docker.Host}}",
        ],
        10,
    )
    .await?;
    let endpoint: String = serde_json::from_str(&raw).map_err(|_| "DOCKER_INVALID_RESPONSE")?;
    let normalized = endpoint.replace('\\', "/").to_ascii_lowercase();
    Ok(matches!(
        normalized.as_str(),
        "npipe:////./pipe/docker_engine" | "npipe:////./pipe/dockerdesktoplinuxengine"
    ))
}
#[tauri::command]
pub async fn docker_storage_inspect(context: String) -> Result<Value, String> {
    if !local_context(&context).await? {
        return Ok(json!({"supported":false,"disks":[]}));
    }
    let mut paths = std::env::var_os("LOCALAPPDATA")
        .map(|p| candidates(Path::new(&p)))
        .unwrap_or_default();
    paths.extend(
        DISKS
            .lock()
            .map_err(|_| "DOCKER_BUSY")?
            .values()
            .map(|d| PathBuf::from(&d.path)),
    );
    let mut disks = Vec::new();
    for path in paths {
        if !path.exists() {
            continue;
        }
        let d = disk(&path)?;
        if disks.iter().any(|old: &Disk| old.path == d.path) {
            continue;
        }
        disks.push(remember(d)?);
    }
    Ok(json!({"supported":true,"disks":disks}))
}
#[tauri::command]
pub async fn docker_storage_pick(context: String) -> Result<Option<Disk>, String> {
    if !local_context(&context).await? {
        return Err("DOCKER_DISK_LOCAL_ONLY".into());
    }
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Virtual disk", &["vhdx"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    remember(disk(file.path())?).map(Some)
}
#[tauri::command]
pub async fn docker_storage_stop(context: String) -> Result<(), String> {
    if !local_context(&context).await? {
        return Err("DOCKER_DISK_LOCAL_ONLY".into());
    }
    let _engine = engine::START.try_acquire().map_err(|_| "DOCKER_BUSY")?;
    let _maintenance = GATE.begin().await?;
    // Explicit user action. No wsl --shutdown or forced process kills.
    cli::execute(
        cli::command(None, &["desktop", "stop", "--timeout", "90"])?,
        std::time::Duration::from_secs(100),
        1024 * 1024,
    )
    .await?;
    Ok(())
}
#[tauri::command]
pub async fn docker_storage_trim(context: String) -> Result<String, String> {
    if !local_context(&context).await? {
        return Err("DOCKER_DISK_LOCAL_ONLY".into());
    }
    let _engine = engine::START.try_acquire().map_err(|_| "DOCKER_BUSY")?;
    let _maintenance = GATE.begin().await?;
    #[cfg(windows)]
    {
        use std::process::Stdio;
        let system =
            std::env::var_os("SystemRoot").ok_or("Windows system directory unavailable")?;
        let exe = Path::new(&system).join("System32/wsl.exe");
        let command = |args: &[&str]| {
            let mut cmd = tokio::process::Command::new(&exe);
            cmd.args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .creation_flags(0x08000000);
            cmd
        };
        let raw = cli::execute_bytes(
            command(&["--list", "--running", "--quiet"]),
            std::time::Duration::from_secs(15),
            1024 * 1024,
        )
        .await?;
        if !decode_wsl(&raw)
            .lines()
            .any(|s| s.trim().trim_start_matches('\u{feff}') == "docker-desktop")
        {
            return Err("DOCKER_TRIM_NOT_RUNNING: start Docker's WSL engine before TRIM".into());
        }
        cli::execute(
            command(&[
                "--distribution",
                "docker-desktop",
                "--user",
                "root",
                "--exec",
                "fstrim",
                "--all",
                "--verbose",
            ]),
            std::time::Duration::from_secs(120),
            1024 * 1024,
        )
        .await
    }
    #[cfg(not(windows))]
    {
        Err("DOCKER_DISK_WINDOWS_ONLY".into())
    }
}
fn decode_wsl(raw: &[u8]) -> String {
    if raw.starts_with(&[0xff, 0xfe]) || raw.iter().any(|b| *b == 0) {
        let words: Vec<_> = raw
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        String::from_utf16_lossy(&words)
            .trim_start_matches('\u{feff}')
            .to_string()
    } else {
        String::from_utf8_lossy(raw).into_owned()
    }
}
#[tauri::command]
pub async fn docker_storage_compact(
    context: String,
    id: String,
    token: String,
) -> Result<Value, String> {
    if !local_context(&context).await? {
        return Err("DOCKER_DISK_LOCAL_ONLY".into());
    }
    let _engine = engine::START.try_acquire().map_err(|_| "DOCKER_BUSY")?;
    let _maintenance = GATE.begin().await?;
    let reviewed = DISKS
        .lock()
        .map_err(|_| "DOCKER_BUSY")?
        .get(&id)
        .cloned()
        .ok_or("DOCKER_DISK_STALE")?;
    if reviewed.token != token {
        return Err("DOCKER_DISK_STALE".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _maintenance = _maintenance;
        let before = disk(Path::new(&reviewed.path))?;
        if before.token != token {
            return Err("DOCKER_DISK_STALE".into());
        }
        offline(Path::new(&before.path))?;
        elevated_compact(&before)?;
        let after = remember(disk(Path::new(&before.path))?)?;
        Ok(json!({"before":before,"after":after}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(Some(0)).collect()
}
#[cfg(windows)]
fn allocated(path: &Path) -> Result<u64, String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, SetLastError},
        Storage::FileSystem::GetCompressedFileSizeW,
    };
    let mut high = 0;
    unsafe {
        SetLastError(0);
        let low = GetCompressedFileSizeW(wide(path.as_os_str()).as_ptr(), &mut high);
        if low == u32::MAX && GetLastError() != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(((high as u64) << 32) | low as u64)
    }
}
#[cfg(not(windows))]
fn allocated(path: &Path) -> Result<u64, String> {
    path.metadata().map(|m| m.len()).map_err(|e| e.to_string())
}
#[cfg(windows)]
fn offline(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(path)
        .map(|_| ())
        .map_err(|e| format!("DOCKER_DISK_IN_USE: {e}"))
}
#[cfg(windows)]
fn pin_file(path: &Path) -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(path)
        .map_err(|e| e.to_string())
}
#[cfg(not(windows))]
fn offline(_: &Path) -> Result<(), String> {
    Err("DOCKER_DISK_WINDOWS_ONLY".into())
}

#[cfg(windows)]
fn elevated_compact(reviewed: &Disk) -> Result<(), String> {
    use base64::Engine;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, WAIT_OBJECT_0},
        System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE},
        UI::Shell::{
            ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
        },
    };
    let exe = wide(
        std::env::current_exe()
            .map_err(|e| e.to_string())?
            .as_os_str(),
    );
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(reviewed).map_err(|e| e.to_string())?);
    let params = wide(std::ffi::OsStr::new(&format!(
        "--woojoo-compact-vhdx {encoded}"
    )));
    let verb = wide(std::ffi::OsStr::new("runas"));
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    info.lpVerb = verb.as_ptr();
    info.lpFile = exe.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = 0;
    unsafe {
        if ShellExecuteExW(&mut info) == 0 {
            let code = GetLastError();
            return Err(if code == 1223 {
                "DOCKER_DISK_UAC_CANCELLED".into()
            } else {
                format!(
                    "DOCKER_DISK_ELEVATION: {}",
                    std::io::Error::from_raw_os_error(code as i32)
                )
            });
        }
        if info.hProcess.is_null() {
            return Err("DOCKER_DISK_HELPER_START_FAILED".into());
        }
        // Never timeout/kill the helper while it may be moving virtual disk blocks.
        let wait = WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 1;
        let read = GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        if wait != WAIT_OBJECT_0 || read == 0 {
            return Err("DOCKER_DISK_RESULT_UNKNOWN".into());
        }
        if code == 0 {
            Ok(())
        } else {
            Err(format!(
                "DOCKER_DISK_COMPACT_FAILED: {} (Windows {code})",
                std::io::Error::from_raw_os_error(code as i32)
            ))
        }
    }
}
#[cfg(not(windows))]
fn elevated_compact(_: &Disk) -> Result<(), String> {
    Err("DOCKER_DISK_WINDOWS_ONLY".into())
}

/// Narrow elevated entry point. Does not initialize Tauri, read arbitrary scripts, or launch shells.
pub fn helper_entry() -> Option<i32> {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--woojoo-compact-vhdx") {
        return None;
    }
    Some(if args.len() != 3 {
        87
    } else {
        helper(&args[2]) as i32
    })
}
#[cfg(windows)]
fn helper(encoded: &str) -> u32 {
    use base64::Engine;
    use windows_sys::Win32::{Foundation::CloseHandle, Storage::Vhd::*};
    let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded) else {
        return 87;
    };
    let Ok(reviewed) = serde_json::from_slice::<Disk>(&bytes) else {
        return 87;
    };
    let path = Path::new(&reviewed.path);
    let Ok(current) = disk(path) else {
        return 87;
    };
    if current.token != reviewed.token || current.path != reviewed.path {
        return 1237;
    }
    if offline(path).is_err() {
        return 32;
    }
    // Hold a non-delete-sharing handle until the native operation completes, preventing
    // replacement/rename between the reviewed identity check and OpenVirtualDisk.
    let Ok(_pin) = pin_file(path) else {
        return 32;
    };
    let Ok(pinned) = disk(path) else {
        return 87;
    };
    if pinned.token != reviewed.token || pinned.path != reviewed.path {
        return 1237;
    }
    let storage = VIRTUAL_STORAGE_TYPE {
        DeviceId: VIRTUAL_STORAGE_TYPE_DEVICE_VHDX,
        VendorId: VIRTUAL_STORAGE_TYPE_VENDOR_MICROSOFT,
    };
    let params = OPEN_VIRTUAL_DISK_PARAMETERS {
        Version: OPEN_VIRTUAL_DISK_VERSION_1,
        Anonymous: OPEN_VIRTUAL_DISK_PARAMETERS_0 {
            Version1: OPEN_VIRTUAL_DISK_PARAMETERS_0_0 {
                RWDepth: OPEN_VIRTUAL_DISK_RW_DEPTH_DEFAULT,
            },
        },
    };
    let mut handle = std::ptr::null_mut();
    unsafe {
        let opened = OpenVirtualDisk(
            &storage,
            wide(path.as_os_str()).as_ptr(),
            VIRTUAL_DISK_ACCESS_METAOPS | VIRTUAL_DISK_ACCESS_GET_INFO,
            OPEN_VIRTUAL_DISK_FLAG_NONE,
            &params,
            &mut handle,
        );
        if opened != 0 {
            return opened;
        }
        let mut length = 2048;
        let mut physical = vec![0u16; 1024];
        let attached = GetVirtualDiskPhysicalPath(handle, &mut length, physical.as_mut_ptr());
        // ERROR_DEV_NOT_EXIST means detached. Any attached or ambiguous state is refused.
        let result = if attached == 55 {
            CompactVirtualDisk(
                handle,
                COMPACT_VIRTUAL_DISK_FLAG_NONE,
                std::ptr::null(),
                std::ptr::null(),
            )
        } else {
            32
        };
        CloseHandle(handle);
        result
    }
}
#[cfg(not(windows))]
fn helper(_: &str) -> u32 {
    50
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wsl_inventory_decodes_utf16_without_corrupting_unicode_names() {
        let text = "docker-desktop\r\n한글\r\n";
        let bytes: Vec<_> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_wsl(&bytes), text);
        assert_eq!(decode_wsl(text.as_bytes()), text);
    }
    #[test]
    fn discovers_data_not_engine_or_swap_disks() {
        let paths = candidates(Path::new("base"));
        assert_eq!(paths.len(), 2);
        assert!(paths.iter().all(|p| !p.to_string_lossy().contains("main")));
        assert!(paths[0].ends_with("Docker/wsl/disk/docker_data.vhdx"));
    }
    #[test]
    fn rejects_non_vhdx_and_replaced_content() {
        let root = std::env::temp_dir().join(format!("woojoo-disk-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("data.vhdx");
        std::fs::write(&path, b"not-vhdx").unwrap();
        assert!(validate_file(&path).is_err());
        std::fs::write(&path, b"vhdxfile-test").unwrap();
        let first = disk(&path).unwrap();
        std::fs::write(&path, b"vhdxfile-changed-content").unwrap();
        let second = disk(&path).unwrap();
        assert_ne!(first.token, second.token);
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }
    #[test]
    fn helper_rejects_malformed_requests_without_elevation_or_disk_access() {
        assert_eq!(helper("!invalid"), if cfg!(windows) { 87 } else { 50 });
    }
    #[tokio::test]
    async fn maintenance_guard_is_exclusive_and_releases() {
        let gate = MaintenanceGate::default();
        let guard = gate.begin().await.unwrap();
        assert!(gate.busy.load(Ordering::SeqCst));
        assert!(gate.begin().await.is_err());
        drop(guard);
        assert!(!gate.busy.load(Ordering::SeqCst));
    }
    #[tokio::test]
    async fn maintenance_drains_admitted_commands_and_rejects_new_ones() {
        let gate = MaintenanceGate::default();
        let running = gate.operation().await.unwrap();
        let queued = gate.operation().await.unwrap();
        let pending = gate.begin();
        tokio::pin!(pending);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), &mut pending)
                .await
                .is_err()
        );
        assert!(gate.operation().await.is_err());
        drop(running);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), &mut pending)
                .await
                .is_err()
        );
        drop(queued);
        let maintenance = pending.await.unwrap();
        assert!(gate.operation().await.is_err());
        drop(maintenance);
        assert!(gate.operation().await.is_ok());
    }
    #[cfg(windows)]
    #[test]
    fn pinned_file_cannot_be_replaced_during_native_open() {
        let root = std::env::temp_dir().join(format!("woojoo-pin-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("data.vhdx");
        let moved = root.join("moved.vhdx");
        std::fs::write(&path, b"vhdxfile-test").unwrap();
        let pin = pin_file(&path).unwrap();
        assert!(std::fs::rename(&path, &moved).is_err());
        drop(pin);
        std::fs::rename(&path, &moved).unwrap();
        std::fs::remove_file(&moved).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "creates and compacts an isolated disposable 64 MiB VHDX; requires Windows virtual disk privileges"]
    fn native_compaction_on_disposable_vhdx() {
        use base64::Engine;
        use windows_sys::Win32::{Foundation::CloseHandle, Storage::Vhd::*};
        let root =
            std::env::temp_dir().join(format!("woojoo-native-disk-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("disposable.vhdx");
        let storage = VIRTUAL_STORAGE_TYPE {
            DeviceId: VIRTUAL_STORAGE_TYPE_DEVICE_VHDX,
            VendorId: VIRTUAL_STORAGE_TYPE_VENDOR_MICROSOFT,
        };
        let mut params = CREATE_VIRTUAL_DISK_PARAMETERS {
            Version: CREATE_VIRTUAL_DISK_VERSION_2,
            ..Default::default()
        };
        params.Anonymous.Version2 = CREATE_VIRTUAL_DISK_PARAMETERS_0_1 {
            MaximumSize: 64 * 1024 * 1024,
            ..Default::default()
        };
        let mut handle = std::ptr::null_mut();
        let created = unsafe {
            CreateVirtualDisk(
                &storage,
                wide(path.as_os_str()).as_ptr(),
                VIRTUAL_DISK_ACCESS_NONE,
                std::ptr::null_mut(),
                CREATE_VIRTUAL_DISK_FLAG_NONE,
                0,
                &params,
                std::ptr::null(),
                &mut handle,
            )
        };
        if created != 0 {
            if path.exists() {
                std::fs::remove_file(&path).unwrap();
            }
            std::fs::remove_dir(&root).unwrap();
            panic!("Disposable VHDX creation unavailable: Windows {created}");
        }
        unsafe {
            CloseHandle(handle);
        }
        let reviewed = disk(&path).unwrap();
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&reviewed).unwrap());
        let result = helper(&encoded);
        let readable = validate_file(&path).is_ok();
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&root).unwrap();
        assert_eq!(result, 0, "Native compaction returned Windows {result}");
        assert!(readable);
    }
}
