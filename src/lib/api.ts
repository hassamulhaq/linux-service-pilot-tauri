import { invoke } from "@tauri-apps/api/core";

export type ServiceEntry = {
  name: string;
  unit: string;
  group?: string | null;
  is_system?: boolean;
};

export type AppConfig = {
  services: ServiceEntry[];
};

export type ServiceStatus = {
  unit: string;
  active: string;
  sub: string;
  load: string;
  unit_file_state: string;
};

export type Action =
  | "start"
  | "stop"
  | "restart"
  | "reload"
  | "enable"
  | "disable"
  | "mask"
  | "unmask";

export type DiscoveredService = {
  unit: string;
  description: string;
  state: string;
  active: string;
  is_system: boolean;
};

export const api = {
  loadConfig: () => invoke<AppConfig>("load_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
  addService: (entry: ServiceEntry) => invoke<AppConfig>("add_service", { entry }),
  addServicesBulk: (entries: ServiceEntry[]) =>
    invoke<AppConfig>("add_services_bulk", { entries }),
  removeService: (unit: string) => invoke<AppConfig>("remove_service", { unit }),
  scanServices: () => invoke<DiscoveredService[]>("scan_services"),
  setSudoPassword: (password: string) =>
    invoke<void>("set_sudo_password", { password }),
  clearSudoPassword: () => invoke<void>("clear_sudo_password"),
  hasSudoPassword: () => invoke<boolean>("has_sudo_password"),
  listStatus: () => invoke<ServiceStatus[]>("list_status"),
  serviceStatus: (unit: string) => invoke<ServiceStatus>("service_status", { unit }),
  serviceAction: (action: Action, unit: string) =>
    invoke<string>("service_action", { action, unit }),
  bulkAction: (action: Action, units: string[]) =>
    invoke<[string, { Ok?: string; Err?: string }][]>("bulk_action", { action, units }),
  getLogs: (unit: string, lines = 200) =>
    invoke<string>("get_logs", { unit, lines }),
};

export function statusBadgeVariant(s: ServiceStatus): "default" | "destructive" | "secondary" | "outline" {
  if (s.load === "not-found") return "outline";
  if (s.active === "active") return "default";
  if (s.active === "failed") return "destructive";
  return "secondary";
}

export function statusLabel(s: ServiceStatus): string {
  if (s.load === "not-found") return "Not Installed";
  if (s.load === "masked" || s.unit_file_state === "masked") return "Masked";
  if (s.active === "active") return s.sub === "running" ? "Running" : `Active (${s.sub})`;
  if (s.active === "inactive") {
    return s.unit_file_state === "disabled" ? "Stopped · Disabled" : "Stopped";
  }
  if (s.active === "failed") return "Failed";
  if (s.active === "activating") return "Starting…";
  if (s.active === "deactivating") return "Stopping…";
  return s.active;
}
