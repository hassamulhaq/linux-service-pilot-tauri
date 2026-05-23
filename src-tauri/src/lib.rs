use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const KEYRING_SERVICE: &str = "linux-service-pilot";
const KEYRING_USER: &str = "sudo";

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn stored_sudo_password() -> Option<String> {
    let entry = match keyring_entry() {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[keyring] open entry failed: {}", e);
            return None;
        }
    };
    match entry.get_password() {
        Ok(p) => Some(p),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            eprintln!("[keyring] read failed: {}", e);
            None
        }
    }
}

#[tauri::command]
fn set_sudo_password(password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password is empty".into());
    }
    let entry = keyring_entry()?;
    entry.set_password(&password).map_err(|e| e.to_string())?;
    // Verify it actually works.
    sudo_verify(&password).map_err(|e| {
        let _ = entry.delete_credential();
        e
    })?;
    Ok(())
}

#[tauri::command]
fn clear_sudo_password() -> Result<(), String> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn has_sudo_password() -> bool {
    stored_sudo_password().is_some()
}

fn sudo_verify(password: &str) -> Result<(), String> {
    let mut child = Command::new("sudo")
        .args(["-S", "-k", "-p", "", "--", "true"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(password.as_bytes());
        let _ = stdin.write_all(b"\n");
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Invalid sudo password".into());
    }
    Ok(())
}

fn run_with_sudo(password: &str, args: &[String]) -> Result<String, String> {
    let mut cmd_args: Vec<String> = vec![
        "-S".into(), "-k".into(), "-p".into(), "".into(), "--".into(),
    ];
    cmd_args.extend(args.iter().cloned());
    let mut child = Command::new("sudo")
        .args(&cmd_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(password.as_bytes());
        let _ = stdin.write_all(b"\n");
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("sudo failed with status {}", out.status)
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn run_with_pkexec(args: &[String]) -> Result<String, String> {
    let out = Command::new("pkexec")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn run_privileged(args: &[String]) -> Result<String, String> {
    match stored_sudo_password() {
        Some(pw) => run_with_sudo(&pw, args),
        None => run_with_pkexec(args),
    }
}

#[tauri::command]
fn diagnose_auth() -> String {
    let mut report = String::new();
    match keyring_entry() {
        Ok(e) => match e.get_password() {
            Ok(_) => report.push_str("keyring: OK (password present)\n"),
            Err(keyring::Error::NoEntry) => report.push_str("keyring: empty (no entry)\n"),
            Err(err) => report.push_str(&format!("keyring: read error: {}\n", err)),
        },
        Err(err) => report.push_str(&format!("keyring: open error: {}\n", err)),
    }
    if let Some(pw) = stored_sudo_password() {
        match run_with_sudo(&pw, &["systemctl".into(), "is-system-running".into()]) {
            Ok(out) => report.push_str(&format!("sudo test: OK -> {}", out.trim())),
            Err(e) => report.push_str(&format!("sudo test: FAILED -> {}", e)),
        }
    }
    report
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServiceEntry {
    pub name: String,
    pub unit: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub is_system: bool,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub run_user: Option<String>,
    #[serde(default)]
    pub is_custom: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppConfig {
    pub services: Vec<ServiceEntry>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ServiceStatus {
    pub unit: String,
    pub active: String,
    pub sub: String,
    pub load: String,
    pub unit_file_state: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiscoveredService {
    pub unit: String,
    pub description: String,
    pub state: String,
    pub active: String,
    pub is_system: bool,
}

fn is_system_service(unit: &str) -> bool {
    const PATTERNS: &[&str] = &[
        "systemd-", "dbus", "polkit", "NetworkManager", "networkd-dispatcher",
        "snap", "accounts-daemon", "avahi-daemon", "bluetooth", "bluez",
        "ModemManager", "udisks", "upower", "packagekit", "gdm", "lightdm",
        "sddm", "kdm", "cups", "rsyslog", "syslog", "thermald", "irqbalance",
        "apparmor", "ufw", "chrony", "chronyd", "ntp", "fwupd", "whoopsie",
        "kerneloops", "apport", "plymouth", "smartmontools", "multipath",
        "secureboot-db", "getty@", "autovt@", "serial-getty@", "user@",
        "user-runtime-dir@", "console-getty", "motd-news", "fstrim",
        "logrotate", "man-db", "apt-daily", "unattended-upgrades",
        "update-notifier", "dpkg-", "grub-", "swapfile", "swap-",
        "wpa_supplicant", "power-profiles-daemon", "gnome-initial-setup",
        "gnome-remote-desktop", "rtkit-daemon", "switcheroo-control",
        "colord", "iio-sensor-proxy", "boot-efi", "anacron", "cron.service",
        "kmod-", "blk-availability", "console-setup", "keyboard-setup",
        "finalrd", "lvm2-", "mdmonitor", "modprobe@", "rpcbind",
        "binfmt-support",
    ];
    PATTERNS.iter().any(|p| {
        if p.ends_with('@') {
            unit.starts_with(p)
        } else if p.ends_with('-') {
            unit.starts_with(p)
        } else {
            unit == *p || unit.starts_with(&format!("{}.", p)) || unit.starts_with(&format!("{}-", p))
        }
    }) || unit.starts_with("systemd-")
}

fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("linux-service-pilot")
}

fn config_path() -> PathBuf {
    config_dir().join("services.json")
}

fn default_config() -> AppConfig {
    AppConfig { services: vec![] }
}

fn load_or_init() -> AppConfig {
    let path = config_path();
    if !path.exists() {
        let cfg = default_config();
        let _ = fs::create_dir_all(config_dir());
        if let Ok(json) = serde_json::to_string_pretty(&cfg) {
            let _ = fs::write(&path, json);
        }
        return cfg;
    }
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| default_config()),
        Err(_) => default_config(),
    }
}

fn save(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path();
    fs::create_dir_all(config_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn valid_unit(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 128
        && name.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@' | ':' | '\\')
        })
}

fn is_whitelisted(unit: &str, cfg: &AppConfig) -> bool {
    cfg.services.iter().any(|s| s.unit == unit)
}

#[tauri::command]
fn load_config() -> AppConfig {
    load_or_init()
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    save(&config)
}

#[tauri::command]
fn add_service(entry: ServiceEntry) -> Result<AppConfig, String> {
    if !valid_unit(&entry.unit) {
        return Err("Invalid unit name".into());
    }
    let mut cfg = load_or_init();
    if cfg.services.iter().any(|s| s.unit == entry.unit) {
        return Err("Service already exists".into());
    }
    cfg.services.push(entry);
    save(&cfg)?;
    Ok(cfg)
}

#[tauri::command]
fn remove_service(unit: String) -> Result<AppConfig, String> {
    let mut cfg = load_or_init();
    let custom = cfg
        .services
        .iter()
        .find(|s| s.unit == unit)
        .map(|s| {
            if s.is_system {
                Err("System services cannot be removed".to_string())
            } else {
                Ok(s.is_custom)
            }
        })
        .transpose()?
        .unwrap_or(false);

    if custom {
        let full = format!("{}.service", unit);
        let _ = run_privileged(&["systemctl".into(), "stop".into(), full.clone()]);
        let _ = run_privileged(&["systemctl".into(), "disable".into(), full.clone()]);
        let dest = format!("/etc/systemd/system/{}", full);
        run_privileged(&["rm".into(), "-f".into(), dest])?;
        let _ = run_privileged(&["systemctl".into(), "daemon-reload".into()]);
    }

    cfg.services.retain(|s| s.unit != unit);
    save(&cfg)?;
    Ok(cfg)
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

fn shell_escape(s: &str) -> String {
    let mut out = String::from("'");
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

fn build_unit_content(
    description: &str,
    working_dir: &str,
    command: &str,
    run_user: &str,
    group: Option<&str>,
) -> String {
    let mut s = String::new();
    s.push_str("[Unit]\n");
    s.push_str(&format!("Description={}\n", description));
    s.push_str("After=network.target\n\n");
    s.push_str("[Service]\n");
    s.push_str("Type=simple\n");
    s.push_str(&format!("User={}\n", run_user));
    if let Some(g) = group.filter(|g| !g.is_empty()) {
        s.push_str(&format!("# Group={}\n", g));
    }
    s.push_str(&format!("WorkingDirectory={}\n", working_dir));
    s.push_str(&format!("ExecStart=/bin/sh -c {}\n", shell_escape(command)));
    s.push_str("Restart=on-failure\n");
    s.push_str("RestartSec=5\n\n");
    s.push_str("[Install]\n");
    s.push_str("WantedBy=multi-user.target\n");
    s
}

#[tauri::command]
fn create_command_services(
    prefix: String,
    working_dir: String,
    run_user: Option<String>,
    group: Option<String>,
    commands: Vec<String>,
) -> Result<AppConfig, String> {
    let prefix_slug = slugify(&prefix);
    if prefix_slug.is_empty() {
        return Err("Display name required".into());
    }
    let working_dir = working_dir.trim().to_string();
    if working_dir.is_empty() {
        return Err("Folder path required".into());
    }
    if !std::path::Path::new(&working_dir).is_absolute() {
        return Err("Folder path must be absolute".into());
    }
    if !std::path::Path::new(&working_dir).is_dir() {
        return Err(format!("Folder does not exist: {}", working_dir));
    }
    let user = run_user
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())
        .or_else(|| std::env::var("USER").ok())
        .ok_or_else(|| "Could not resolve run-as user".to_string())?;

    let cmds: Vec<String> = commands
        .into_iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty() && !c.starts_with('#'))
        .collect();
    if cmds.is_empty() {
        return Err("At least one command required".into());
    }

    let mut cfg = load_or_init();
    let mut planned: Vec<(String, String, String)> = Vec::new(); // (unit_name, dest_path, content)
    let mut seen: std::collections::HashSet<String> = cfg.services.iter().map(|s| s.unit.clone()).collect();

    for (i, cmd) in cmds.iter().enumerate() {
        let cmd_slug = slugify(cmd);
        let truncated: String = cmd_slug.split('-').take(4).collect::<Vec<_>>().join("-");
        let mut base = if truncated.is_empty() {
            format!("{}-{}", prefix_slug, i + 1)
        } else {
            format!("{}-{}", prefix_slug, truncated)
        };
        let mut n = 2u32;
        let original = base.clone();
        while seen.contains(&base) {
            base = format!("{}-{}", original, n);
            n += 1;
        }
        if !valid_unit(&base) {
            return Err(format!("Generated unit name invalid: {}", base));
        }
        seen.insert(base.clone());
        let content = build_unit_content(
            &format!("{} ({})", prefix, cmd),
            &working_dir,
            cmd,
            &user,
            group.as_deref(),
        );
        let dest = format!("/etc/systemd/system/{}.service", base);
        planned.push((base, dest, content));
    }

    let tmp_dir = std::env::temp_dir();
    let mut staged: Vec<(String, String, String)> = Vec::new(); // (unit_name, tmp, dest)
    for (unit_name, dest, content) in &planned {
        let tmp_path = tmp_dir.join(format!("lsp-{}.service", unit_name));
        fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
        staged.push((unit_name.clone(), tmp_path.display().to_string(), dest.clone()));
    }

    for (_, tmp, dest) in &staged {
        if let Err(e) = run_privileged(&[
            "install".into(),
            "-m".into(),
            "644".into(),
            tmp.clone(),
            dest.clone(),
        ]) {
            // cleanup temp files on failure
            for (_, t, _) in &staged {
                let _ = fs::remove_file(t);
            }
            return Err(format!("install {} failed: {}", dest, e));
        }
    }
    for (_, tmp, _) in &staged {
        let _ = fs::remove_file(tmp);
    }

    run_privileged(&["systemctl".into(), "daemon-reload".into()])
        .map_err(|e| format!("daemon-reload failed: {}", e))?;

    for (i, (unit_name, _, _)) in planned.iter().enumerate() {
        let display = format!("{} · {}", prefix, cmds[i]);
        cfg.services.push(ServiceEntry {
            name: display,
            unit: unit_name.clone(),
            group: group.clone().filter(|g| !g.is_empty()),
            is_system: false,
            working_dir: Some(working_dir.clone()),
            command: Some(cmds[i].clone()),
            run_user: Some(user.clone()),
            is_custom: true,
        });
    }
    save(&cfg)?;
    Ok(cfg)
}

#[tauri::command]
fn service_status(unit: String) -> Result<ServiceStatus, String> {
    let cfg = load_or_init();
    if !is_whitelisted(&unit, &cfg) || !valid_unit(&unit) {
        return Err("Unit not allowed".into());
    }
    let out = Command::new("systemctl")
        .args([
            "show",
            &unit,
            "--property=ActiveState,SubState,LoadState,UnitFileState",
            "--no-pager",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut active = String::from("unknown");
    let mut sub = String::from("unknown");
    let mut load = String::from("unknown");
    let mut unit_file_state = String::new();
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("ActiveState=") { active = v.to_string(); }
        else if let Some(v) = line.strip_prefix("SubState=") { sub = v.to_string(); }
        else if let Some(v) = line.strip_prefix("LoadState=") { load = v.to_string(); }
        else if let Some(v) = line.strip_prefix("UnitFileState=") { unit_file_state = v.to_string(); }
    }
    Ok(ServiceStatus { unit, active, sub, load, unit_file_state })
}

#[tauri::command]
fn list_status() -> Result<Vec<ServiceStatus>, String> {
    let cfg = load_or_init();
    let mut out = Vec::with_capacity(cfg.services.len());
    for s in &cfg.services {
        match service_status(s.unit.clone()) {
            Ok(st) => out.push(st),
            Err(_) => out.push(ServiceStatus {
                unit: s.unit.clone(),
                active: "unknown".into(),
                sub: "unknown".into(),
                load: "not-found".into(),
                unit_file_state: String::new(),
            }),
        }
    }
    Ok(out)
}

fn run_systemctl(action: &str, unit: &str) -> Result<String, String> {
    let cfg = load_or_init();
    if !is_whitelisted(unit, &cfg) || !valid_unit(unit) {
        return Err(format!("Unit not allowed: {}", unit));
    }
    if !matches!(
        action,
        "start" | "stop" | "restart" | "reload" | "enable" | "disable" | "mask" | "unmask"
    ) {
        return Err(format!("Action not allowed: {}", action));
    }
    run_privileged(&["systemctl".into(), action.into(), unit.into()])
}

#[tauri::command]
fn service_action(action: String, unit: String) -> Result<String, String> {
    run_systemctl(&action, &unit)
}

#[tauri::command]
fn bulk_action(action: String, units: Vec<String>) -> Result<Vec<(String, Result<String, String>)>, String> {
    let cfg = load_or_init();
    if !matches!(
        action.as_str(),
        "start" | "stop" | "restart" | "reload" | "enable" | "disable" | "mask" | "unmask"
    ) {
        return Err(format!("Action not allowed: {}", action));
    }
    for u in &units {
        if !is_whitelisted(u, &cfg) || !valid_unit(u) {
            return Err(format!("Unit not allowed: {}", u));
        }
    }
    let mut args: Vec<String> = vec!["systemctl".into(), action.clone()];
    args.extend(units.iter().cloned());
    let result_msg = run_privileged(&args);
    Ok(units.into_iter().map(|u| (u, result_msg.clone())).collect())
}

#[tauri::command]
fn scan_services() -> Result<Vec<DiscoveredService>, String> {
    let files = Command::new("systemctl")
        .args([
            "list-unit-files",
            "--type=service",
            "--no-legend",
            "--no-pager",
            "--plain",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !files.status.success() {
        return Err(String::from_utf8_lossy(&files.stderr).trim().to_string());
    }
    let files_text = String::from_utf8_lossy(&files.stdout);

    let units = Command::new("systemctl")
        .args([
            "list-units",
            "--type=service",
            "--all",
            "--no-legend",
            "--no-pager",
            "--plain",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let units_text = String::from_utf8_lossy(&units.stdout);

    let mut active_map: std::collections::HashMap<String, (String, String)> =
        std::collections::HashMap::new();
    for line in units_text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let unit = parts[0].trim_end_matches(".service").to_string();
            let active = parts[2].to_string();
            let desc = parts[4..].join(" ");
            active_map.insert(unit, (active, desc));
        }
    }

    let mut out = Vec::new();
    for line in files_text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let full = parts[0];
        if !full.ends_with(".service") {
            continue;
        }
        let unit = full.trim_end_matches(".service").to_string();
        if unit.ends_with('@') {
            continue;
        }
        let state = parts[1].to_string();
        let (active, description) = active_map
            .get(&unit)
            .cloned()
            .unwrap_or_else(|| ("inactive".to_string(), String::new()));
        let is_system = is_system_service(&unit);
        out.push(DiscoveredService {
            unit,
            description,
            state,
            active,
            is_system,
        });
    }
    out.sort_by(|a, b| a.unit.cmp(&b.unit));
    Ok(out)
}

#[tauri::command]
fn add_services_bulk(entries: Vec<ServiceEntry>) -> Result<AppConfig, String> {
    let mut cfg = load_or_init();
    for entry in entries {
        if !valid_unit(&entry.unit) {
            continue;
        }
        if cfg.services.iter().any(|s| s.unit == entry.unit) {
            continue;
        }
        cfg.services.push(entry);
    }
    save(&cfg)?;
    Ok(cfg)
}

#[tauri::command]
fn get_logs(unit: String, lines: Option<u32>) -> Result<String, String> {
    let cfg = load_or_init();
    if !is_whitelisted(&unit, &cfg) || !valid_unit(&unit) {
        return Err("Unit not allowed".into());
    }
    let n = lines.unwrap_or(200).min(2000).to_string();
    let out = Command::new("journalctl")
        .args(["-u", &unit, "-n", &n, "--no-pager", "--output=short-iso"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            add_service,
            add_services_bulk,
            remove_service,
            service_status,
            list_status,
            service_action,
            bulk_action,
            get_logs,
            scan_services,
            create_command_services,
            set_sudo_password,
            clear_sudo_password,
            has_sudo_password,
            diagnose_auth,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
