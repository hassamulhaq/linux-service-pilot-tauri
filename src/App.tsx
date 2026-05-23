import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Moon, Play, RefreshCw, RotateCcw, Square, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServiceTable } from "@/components/ServiceTable";
import { LogsDialog } from "@/components/LogsDialog";
import { AddServiceDialog } from "@/components/AddServiceDialog";
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
      setConfig(await api.loadConfig());
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

  const rows = useMemo(
    () => config.services.map((entry) => ({ entry, status: statuses[entry.unit] })),
    [config.services, statuses],
  );

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
    setSelected((prev) =>
      prev.size === config.services.length
        ? new Set()
        : new Set(config.services.map((s) => s.unit)),
    );
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
            <AddServiceDialog onAdded={setConfig} />
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

        <div className="flex items-center justify-between mb-3 px-1">
          <div className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : `${counts.total} services`}
          </div>
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
