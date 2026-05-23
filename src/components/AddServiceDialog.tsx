import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { AppConfig } from "@/lib/api";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  onAdded: (cfg: AppConfig) => void;
};

type Mode = "existing" | "command";

export function AddServiceDialog({ onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("existing");

  // existing-unit fields
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [group, setGroup] = useState("");

  // command-mode fields
  const [cmdName, setCmdName] = useState("");
  const [folder, setFolder] = useState("");
  const [runUser, setRunUser] = useState("");
  const [cmdGroup, setCmdGroup] = useState("");
  const [commands, setCommands] = useState("");

  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setUnit("");
    setGroup("");
    setCmdName("");
    setFolder("");
    setRunUser("");
    setCmdGroup("");
    setCommands("");
  }

  async function submitExisting(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !unit.trim()) return;
    setSaving(true);
    try {
      const cfg = await api.addService({
        name: name.trim(),
        unit: unit.trim(),
        group: group.trim() || null,
      });
      onAdded(cfg);
      toast.success(`Added ${name}`);
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function submitCommands(e: React.FormEvent) {
    e.preventDefault();
    const lines = commands
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    if (!cmdName.trim() || !folder.trim() || lines.length === 0) return;
    setSaving(true);
    try {
      const cfg = await api.createCommandServices({
        prefix: cmdName.trim(),
        workingDir: folder.trim(),
        runUser: runUser.trim() || null,
        group: cmdGroup.trim() || null,
        commands: lines,
      });
      onAdded(cfg);
      toast.success(
        `Created ${lines.length} service${lines.length === 1 ? "" : "s"}`,
      );
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus />
          Add Service
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Service</DialogTitle>
          <DialogDescription>
            Register an existing systemd unit, or generate one from shell
            commands.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-md bg-muted p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={`flex-1 h-8 rounded ${
              mode === "existing"
                ? "bg-background shadow-sm font-medium"
                : "text-muted-foreground"
            }`}
          >
            Existing Unit
          </button>
          <button
            type="button"
            onClick={() => setMode("command")}
            className={`flex-1 h-8 rounded ${
              mode === "command"
                ? "bg-background shadow-sm font-medium"
                : "text-muted-foreground"
            }`}
          >
            Create from Commands
          </button>
        </div>

        {mode === "existing" ? (
          <form onSubmit={submitExisting} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Point at a systemd unit already installed on this machine.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest">
                Display Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Laravel Queue"
                className="w-full h-10 rounded border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest">
                systemd Unit
              </label>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="supervisor"
                className="w-full h-10 rounded border border-input bg-background px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                required
                pattern="[A-Za-z0-9._\-@:]+"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest">
                Group (optional)
              </label>
              <input
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="Web / Database / Runtime"
                className="w-full h-10 rounded border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={submitCommands} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Generates a systemd <code>.service</code> file per command line.
              Requires sudo. Each command runs from the folder below.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest">
                Display Name
              </label>
              <input
                value={cmdName}
                onChange={(e) => setCmdName(e.target.value)}
                placeholder="Laravel"
                className="w-full h-10 rounded border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Used as a prefix; unit name becomes{" "}
                <code>name-command.service</code>.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest">
                Working Directory
              </label>
              <input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="/var/www/html/laravel13-app"
                className="w-full h-10 rounded border border-input bg-background px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                required
                pattern="/.*"
              />
              <p className="text-[11px] text-muted-foreground">
                Absolute path. Each command's <code>cwd</code>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-widest">
                  Run as User
                </label>
                <input
                  value={runUser}
                  onChange={(e) => setRunUser(e.target.value)}
                  placeholder="www-data"
                  className="w-full h-10 rounded border border-input bg-background px-3 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-widest">
                  Group (optional)
                </label>
                <input
                  value={cmdGroup}
                  onChange={(e) => setCmdGroup(e.target.value)}
                  placeholder="Laravel"
                  className="w-full h-10 rounded border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest">
                Commands (one per line)
              </label>
              <textarea
                value={commands}
                onChange={(e) => setCommands(e.target.value)}
                rows={5}
                placeholder={
                  "php artisan queue:listen --tries=3\nphp artisan reverb:start\nphp artisan schedule:work"
                }
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                required
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Each non-empty line becomes its own service. Lines starting with{" "}
                <code>#</code> are ignored.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create Services"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
