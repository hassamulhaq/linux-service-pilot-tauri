import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, Moon, Play, RefreshCw, RotateCcw, ScanSearch, Search, Settings, Square, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ServiceTable } from "@/components/ServiceTable";
import { LogsDialog } from "@/components/LogsDialog";
import { AddServiceDialog } from "@/components/AddServiceDialog";
import { ScanDialog } from "@/components/ScanDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { api, type Action, type AppConfig, type ServiceStatus } from "@/lib/api";
import { toast } from "sonner";

const POLL_MS = 3000;

export default function App() {
  const [config, setConfig] = useState<AppConfig>({ services: [] });
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [logsUnit, setLogsUnit] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const refreshStatuses = useCallback(async () => {
    try {
      const list = await api.listStatus();
      const map: Record<string, ServiceStatus> = {};
      for (const s of list) map[s.unit] = s;
      setStatuses(map);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.loadConfig();
      setConfig(cfg);
      if (cfg.services.length === 0) setScanOpen(true);
    } catch (e) {
      toast.error(`Failed to load config: ${e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config.services.length === 0) return;
    refreshStatuses();
    pollRef.current = window.setInterval(refreshStatuses, POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [config.services.length, refreshStatuses]);

  const allRows = useMemo(
    () => config.services.map((entry) => ({ entry, status: statuses[entry.unit] })),
    [config.services, statuses],
  );

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const s of config.services) if (s.group) set.add(s.group);
    return Array.from(set).sort();
  }, [config.services]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(({ entry }) => {
      if (groupFilter !== "all" && (entry.group ?? "") !== groupFilter) return false;
      if (!q) return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.unit.toLowerCase().includes(q) ||
        (entry.group ?? "").toLowerCase().includes(q)
      );
    });
  }, [allRows, query, groupFilter]);

  const counts = useMemo(() => {
    let running = 0, stopped = 0, failed = 0;
    for (const s of Object.values(statuses)) {
      if (s.active === "active") running++;
      else if (s.active === "failed") failed++;
      else stopped++;
    }
    return { running, stopped, failed, total: config.services.length };
  }, [statuses, config.services.length]);

  function toggle(unit: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(unit)) next.delete(unit);
      else next.add(unit);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const visibleUnits = rows.map((r) => r.entry.unit);
      const allVisibleSelected =
        visibleUnits.length > 0 && visibleUnits.every((u) => prev.has(u));
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleUnits.forEach((u) => next.delete(u));
        return next;
      }
      const next = new Set(prev);
      visibleUnits.forEach((u) => next.add(u));
      return next;
    });
  }

  async function doAction(action: Action, unit: string) {
    setBusy((p) => new Set(p).add(unit));
    try {
      await api.serviceAction(action, unit);
      toast.success(`${action} ${unit}`);
      await refreshStatuses();
    } catch (e) {
      toast.error(`${action} ${unit}: ${e}`);
    } finally {
      setBusy((p) => {
        const n = new Set(p);
        n.delete(unit);
        return n;
      });
    }
  }

  async function bulk(action: Action) {
    const units = Array.from(selected);
    if (units.length === 0) return;
    setBusy((p) => {
      const n = new Set(p);
      units.forEach((u) => n.add(u));
      return n;
    });
    try {
      await api.bulkAction(action, units);
      toast.success(`${action} × ${units.length}`);
      await refreshStatuses();
    } catch (e) {
      toast.error(`Bulk ${action}: ${e}`);
    } finally {
      setBusy((p) => {
        const n = new Set(p);
        units.forEach((u) => n.delete(u));
        return n;
      });
    }
  }

  async function remove(unit: string) {
    try {
      const cfg = await api.removeService(unit);
      setConfig(cfg);
      setSelected((p) => {
        const n = new Set(p);
        n.delete(unit);
        return n;
      });
    } catch (e) {
      toast.error(`Remove: ${e}`);
    }
  }

  function openLogs(unit: string) {
    setLogsUnit(unit);
    setLogsOpen(true);
  }

  return (
    <div className="min-h-screen bg-background text-foreground text-sm">
      <header className="border-b sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <span className="font-medium">Linux Service Pilot</span>
            <span className="text-xs text-muted-foreground">/ systemd</span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon-xs" variant="ghost" onClick={() => setDark((d) => !d)} title="Theme">
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={refreshStatuses} title="Refresh">
              <RefreshCw />
            </Button>
            <Button size="xs" variant="outline" onClick={() => setScanOpen(true)}>
              <ScanSearch />
              Scan
            </Button>
            <AddServiceDialog onAdded={setConfig} />
            <Button size="icon-xs" variant="ghost" onClick={() => setSettingsOpen(true)} title="Settings">
              <Settings />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4">
        <div className="grid grid-cols-4 gap-2 mb-4">
          <StatCard label="Total" value={counts.total} />
          <StatCard label="Running" value={counts.running} dot="emerald" />
          <StatCard label="Stopped" value={counts.stopped} dot="muted" />
          <StatCard label="Failed" value={counts.failed} dot="red" />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, unit, or group…"
              className="w-full h-8 pl-8 pr-8 rounded border border-input bg-background text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {groups.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="outline" className="min-w-32 justify-between">
                  <span>{groupFilter === "all" ? "All groups" : groupFilter}</span>
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-xs min-w-32">
                <DropdownMenuItem onSelect={() => setGroupFilter("all")}>
                  All groups
                </DropdownMenuItem>
                {groups.map((g) => (
                  <DropdownMenuItem key={g} onSelect={() => setGroupFilter(g)}>
                    {g}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              disabled={selected.size === 0}
              onClick={() => bulk("start")}
            >
              <Play />
              Start
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={selected.size === 0}
              onClick={() => bulk("stop")}
            >
              <Square />
              Stop
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={selected.size === 0}
              onClick={() => bulk("restart")}
            >
              <RotateCcw />
              Restart
            </Button>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground mb-2 px-1">
          {selected.size > 0
            ? `${selected.size} selected`
            : query || groupFilter !== "all"
            ? `${rows.length} of ${allRows.length} services`
            : `${counts.total} services`}
        </div>

        <div className="rounded border bg-card">
          {loading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">Loading…</div>
          ) : (
            <ServiceTable
              rows={rows}
              selected={selected}
              busy={busy}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onAction={doAction}
              onLogs={openLogs}
              onRemove={remove}
            />
          )}
        </div>
      </main>

      <LogsDialog unit={logsUnit} open={logsOpen} onOpenChange={setLogsOpen} />
      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        existing={config.services.map((s) => s.unit)}
        onAdded={setConfig}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function StatCard({
  label,
  value,
  dot,
}: {
  label: string;
  value: number;
  dot?: "emerald" | "red" | "muted";
}) {
  const color =
    dot === "emerald"
      ? "bg-emerald-500"
      : dot === "red"
      ? "bg-red-500"
      : dot === "muted"
      ? "bg-muted-foreground/40"
      : "bg-muted-foreground/20";
  return (
    <div className="rounded border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className={`size-1.5 rounded-full ${color}`} />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums leading-none">
        {value}
      </div>
    </div>
  );
}
