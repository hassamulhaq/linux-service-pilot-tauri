import { MoreHorizontal, Play, Square, RotateCcw, ScrollText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ServiceEntry, ServiceStatus, Action } from "@/lib/api";
import { statusLabel } from "@/lib/api";

type Row = {
  entry: ServiceEntry;
  status?: ServiceStatus;
};

type Props = {
  rows: Row[];
  selected: Set<string>;
  busy: Set<string>;
  onToggle: (unit: string) => void;
  onToggleAll: () => void;
  onAction: (action: Action, unit: string) => void;
  onLogs: (unit: string) => void;
  onRemove: (unit: string) => void;
};

export function ServiceTable({
  rows,
  selected,
  busy,
  onToggle,
  onToggleAll,
  onAction,
  onLogs,
  onRemove,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.entry.unit));
  const someSelected = rows.some((r) => selected.has(r.entry.unit)) && !allSelected;

  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-muted-foreground">
        No services. Add one to begin.
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-[calc(100vh-260px)]">
      <div className="grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_140px] items-center gap-3 px-3 h-8 text-[10px] uppercase tracking-wider text-muted-foreground border-b bg-card sticky top-0">
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={onToggleAll}
          aria-label="Select all"
          className="size-3.5"
        />
        <span>Service</span>
        <span>Unit</span>
        <span>Group</span>
        <span>Status</span>
        <span className="text-right pr-1">Actions</span>
      </div>
      <div className="overflow-y-auto divide-y">
      {rows.map(({ entry, status }) => {
        const isSelected = selected.has(entry.unit);
        const isBusy = busy.has(entry.unit);
        const isActive = status?.active === "active";
        const isFailed = status?.active === "failed";
        const dotColor = isActive
          ? "bg-emerald-500"
          : isFailed
          ? "bg-red-500"
          : status?.load === "not-found"
          ? "bg-muted-foreground/30"
          : "bg-muted-foreground/50";

        return (
          <div
            key={entry.unit}
            data-selected={isSelected || undefined}
            className="grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_140px] items-center gap-3 px-3 h-10 hover:bg-muted/40 data-[selected]:bg-muted/60 group transition-colors"
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggle(entry.unit)}
              aria-label={`Select ${entry.name}`}
              className="size-3.5"
            />
            <span className="truncate font-medium flex items-center gap-1.5">
              {entry.name}
              {entry.is_system && (
                <span className="text-[9px] uppercase tracking-wider text-amber-500 border border-amber-500/40 rounded px-1 py-px shrink-0">
                  sys
                </span>
              )}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {entry.unit}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {entry.group ?? "—"}
            </span>
            <span className="flex items-center gap-1.5 text-xs">
              <span className={`size-1.5 rounded-full ${dotColor} ${isActive ? "animate-pulse" : ""}`} />
              <span className={isFailed ? "text-red-500" : ""}>
                {status ? statusLabel(status) : "…"}
              </span>
            </span>
            <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
              <Button
                size="icon-xs"
                variant="ghost"
                title="Start"
                disabled={isBusy || isActive}
                onClick={() => onAction("start", entry.unit)}
              >
                <Play />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title="Stop"
                disabled={isBusy || !isActive}
                onClick={() => onAction("stop", entry.unit)}
              >
                <Square />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title="Restart"
                disabled={isBusy}
                onClick={() => onAction("restart", entry.unit)}
              >
                <RotateCcw />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-xs" variant="ghost" title="More">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuItem onSelect={() => onLogs(entry.unit)}>
                    <ScrollText />
                    Logs
                  </DropdownMenuItem>
                  {!entry.is_system && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => onRemove(entry.unit)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 />
                        Remove
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
