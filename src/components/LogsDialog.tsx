import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";

type Props = {
  unit: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function LogsDialog({ unit, open, onOpenChange }: Props) {
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!unit) return;
    setLoading(true);
    setError(null);
    try {
      const text = await api.getLogs(unit, 300);
      setLogs(text || "(no logs)");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && unit) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unit]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[80vw] w-[80vw] sm:max-w-[80vw]">
        <DialogHeader>
          <DialogTitle>Logs: {unit}</DialogTitle>
          <DialogDescription>
            Last 300 lines from journalctl
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
        <ScrollArea className="h-[60vh] rounded border bg-muted/40">
          {error ? (
            <pre className="p-4 text-sm text-destructive whitespace-pre-wrap">{error}</pre>
          ) : (
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed">
              {loading && !logs ? "Loading…" : logs}
            </pre>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
