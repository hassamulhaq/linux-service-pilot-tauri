import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type AppConfig, type DiscoveredService, type ServiceEntry } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: string[];
  onAdded: (cfg: AppConfig) => void;
};

const COMMON_GROUPS: Record<string, RegExp> = {
  Web: /^(nginx|apache2|httpd|caddy|traefik|lighttpd)/,
  Database: /^(mysql|mariadb|postgres|mongod|cassandra|influxdb|clickhouse)/,
  Cache: /^(redis|memcached|valkey)/,
  Runtime: /^(php\d|node|pm2|gunicorn|uwsgi)/,
  Container: /^(docker|containerd|podman|k3s|kubelet)/,
  Queue: /^(rabbitmq|kafka|nats|beanstalkd|supervisor)/,
  Search: /^(elasticsearch|opensearch|solr|meilisearch)/,
};

function guessGroup(unit: string): string | null {
  for (const [g, rx] of Object.entries(COMMON_GROUPS)) {
    if (rx.test(unit)) return g;
  }
  return null;
}

function prettyName(unit: string): string {
  return unit
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ScanDialog({ open, onOpenChange, existing, onAdded }: Props) {
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredService[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [hideInstalled, setHideInstalled] = useState(true);
  const [includeSystem, setIncludeSystem] = useState(false);

  async function scan() {
    setScanning(true);
    setPicked(new Set());
    try {
      const list = await api.scanServices();
      setDiscovered(list);
    } catch (e) {
      toast.error(`Scan failed: ${e}`);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (open && discovered.length === 0) scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return discovered.filter((d) => {
      if (hideInstalled && existing.includes(d.unit)) return false;
      if (d.state === "masked" || d.state === "alias") return false;
      if (!includeSystem && d.is_system) return false;
      if (!q) return true;
      return d.unit.toLowerCase().includes(q) || d.description.toLowerCase().includes(q);
    });
  }, [discovered, filter, existing, hideInstalled, includeSystem]);

  function toggle(unit: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(unit)) n.delete(unit);
      else n.add(unit);
      return n;
    });
  }

  function toggleAll() {
    if (picked.size === filtered.length) setPicked(new Set());
    else setPicked(new Set(filtered.map((d) => d.unit)));
  }

  async function add() {
    if (picked.size === 0) return;
    setSaving(true);
    try {
      const entries: ServiceEntry[] = filtered
        .filter((d) => picked.has(d.unit))
        .map((d) => ({
          name: prettyName(d.unit),
          unit: d.unit,
          group: d.is_system ? "System" : guessGroup(d.unit),
          is_system: d.is_system,
        }));
      const cfg = await api.addServicesBulk(entries);
      onAdded(cfg);
      toast.success(`Added ${entries.length} service(s)`);
      onOpenChange(false);
      setPicked(new Set());
    } catch (e) {
      toast.error(`Failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[80vw] w-[80vw] sm:max-w-[80vw]">
        <DialogHeader>
          <DialogTitle>Scan System Services</DialogTitle>
          <DialogDescription>
            Discover installed systemd services and add them to your dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name or description…"
              className="w-full h-9 pl-8 pr-3 rounded border border-input bg-background text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground select-none">
            <Checkbox
              checked={hideInstalled}
              onCheckedChange={(v) => setHideInstalled(!!v)}
              className="size-3.5"
            />
            Hide added
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground select-none">
            <Checkbox
              checked={includeSystem}
              onCheckedChange={(v) => setIncludeSystem(!!v)}
              className="size-3.5"
            />
            Include system services
          </label>
          <Button size="sm" variant="outline" onClick={scan} disabled={scanning}>
            {scanning ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Rescan
          </Button>
        </div>

        {includeSystem && (
          <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <ShieldAlert className="size-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-amber-700 dark:text-amber-200">
              <span className="font-medium">System services included.</span>{" "}
              Modifying these can break your OS. Once added, they cannot be removed from this list.
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span>
            {scanning
              ? "Scanning…"
              : `${filtered.length} of ${discovered.length} services`}
          </span>
          <button
            onClick={toggleAll}
            className="hover:text-foreground"
            disabled={filtered.length === 0}
          >
            {picked.size === filtered.length && filtered.length > 0
              ? "Clear"
              : "Select all"}
          </button>
        </div>

        <ScrollArea className="h-[55vh] rounded border bg-background">
          {scanning && discovered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-xs">Scanning systemd…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground">
              {discovered.length === 0
                ? "No services found."
                : "No matches. Adjust filter."}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((d) => {
                const isPicked = picked.has(d.unit);
                const isActive = d.active === "active";
                const isInstalled = existing.includes(d.unit);
                return (
                  <label
                    key={d.unit}
                    className="grid grid-cols-[28px_minmax(0,1.2fr)_minmax(0,2fr)_90px_70px] items-center gap-3 px-3 h-9 hover:bg-muted/40 cursor-pointer text-xs"
                  >
                    <Checkbox
                      checked={isPicked}
                      onCheckedChange={() => toggle(d.unit)}
                      disabled={isInstalled}
                      className="size-3.5"
                    />
                    <span className="truncate font-mono flex items-center gap-1.5">
                      {d.unit}
                      {d.is_system && (
                        <span className="text-[9px] uppercase tracking-wider text-amber-500 border border-amber-500/40 rounded px-1 py-px">
                          sys
                        </span>
                      )}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {d.description || "—"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`size-1.5 rounded-full ${
                          isActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                        }`}
                      />
                      {d.active}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wider ${
                        d.state === "enabled"
                          ? "text-emerald-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      {isInstalled ? "added" : d.state}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <span className="text-xs text-muted-foreground mr-auto self-center">
            {picked.size} selected
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={add} disabled={picked.size === 0 || saving}>
            {saving ? "Adding…" : `Add ${picked.size || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
