use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServiceEntry {
    pub name: String,
    pub unit: String,
    #[serde(default)]
    pub group: Option<String>,
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
    AppConfig {
        services: vec![
            ServiceEntry { name: "Nginx".into(), unit: "nginx".into(), group: Some("Web".into()) },
            ServiceEntry { name: "Apache".into(), unit: "apache2".into(), group: Some("Web".into()) },
            ServiceEntry { name: "MySQL".into(), unit: "mysql".into(), group: Some("Database".into()) },
            ServiceEntry { name: "PostgreSQL".into(), unit: "postgresql".into(), group: Some("Database".into()) },
            ServiceEntry { name: "Redis".into(), unit: "redis-server".into(), group: Some("Cache".into()) },
            ServiceEntry { name: "MongoDB".into(), unit: "mongod".into(), group: Some("Database".into()) },
            ServiceEntry { name: "PHP 8.3 FPM".into(), unit: "php8.3-fpm".into(), group: Some("Runtime".into()) },
            ServiceEntry { name: "Docker".into(), unit: "docker".into(), group: Some("Container".into()) },
        ],
    }
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
    cfg.services.retain(|s| s.unit != unit);
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
        .args(["show", &unit, "--property=ActiveState,SubState,LoadState", "--no-pager"])
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut active = String::from("unknown");
    let mut sub = String::from("unknown");
    let mut load = String::from("unknown");
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("ActiveState=") { active = v.to_string(); }
        else if let Some(v) = line.strip_prefix("SubState=") { sub = v.to_string(); }
        else if let Some(v) = line.strip_prefix("LoadState=") { load = v.to_string(); }
    }
    Ok(ServiceStatus { unit, active, sub, load })
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
    if !matches!(action, "start" | "stop" | "restart" | "reload") {
        return Err(format!("Action not allowed: {}", action));
    }
    let out = Command::new("pkexec")
        .args(["systemctl", action, unit])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
fn service_action(action: String, unit: String) -> Result<String, String> {
    run_systemctl(&action, &unit)
}

#[tauri::command]
fn bulk_action(action: String, units: Vec<String>) -> Result<Vec<(String, Result<String, String>)>, String> {
    let cfg = load_or_init();
    if !matches!(action.as_str(), "start" | "stop" | "restart" | "reload") {
        return Err(format!("Action not allowed: {}", action));
    }
    for u in &units {
        if !is_whitelisted(u, &cfg) || !valid_unit(u) {
            return Err(format!("Unit not allowed: {}", u));
        }
    }
    let mut args: Vec<String> = vec!["systemctl".into(), action.clone()];
    args.extend(units.iter().cloned());
    let out = Command::new("pkexec")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let result_msg = if out.status.success() { Ok(stdout) } else { Err(stderr.trim().to_string()) };
    Ok(units.into_iter().map(|u| (u, result_msg.clone())).collect())
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
            remove_service,
            service_status,
            list_status,
            service_action,
            bulk_action,
            get_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
