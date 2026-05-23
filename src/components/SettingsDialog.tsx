import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: Props) {
  const [hasPwd, setHasPwd] = useState(false);
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function refresh() {
    try {
      setHasPwd(await api.hasSudoPassword());
    } catch {
      setHasPwd(false);
    }
  }

  useEffect(() => {
    if (open) {
      refresh();
      setPwd("");
      setShow(false);
    }
  }, [open]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!pwd) return;
    setSaving(true);
    try {
      await api.setSudoPassword(pwd);
      toast.success("Password saved & verified");
      setPwd("");
      await refresh();
    } catch (e) {
      toast.error(`${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setClearing(true);
    try {
      await api.clearSudoPassword();
      toast.success("Password removed");
      await refresh();
    } catch (e) {
      toast.error(`${e}`);
    } finally {
      setClearing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Privileged action authentication</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded border bg-muted/30 p-3 text-xs">
            {hasPwd ? (
              <ShieldCheck className="size-4 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="size-4 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-medium text-foreground">
                {hasPwd ? "Password stored in system keyring" : "No password stored"}
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {hasPwd
                  ? "Service actions run silently via sudo. Remove to switch back to polkit prompts."
                  : "Each action triggers the system polkit prompt. Store your sudo password (encrypted in the OS keyring) to skip prompts."}
              </p>
            </div>
          </div>

          {hasPwd ? (
            <div className="flex justify-end">
              <Button
                variant="destructive"
                size="sm"
                onClick={clear}
                disabled={clearing}
              >
                <Trash2 />
                {clearing ? "Removing…" : "Remove stored password"}
              </Button>
            </div>
          ) : (
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-widest flex items-center gap-1.5">
                  <KeyRound className="size-3.5" />
                  Sudo password
                </label>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="off"
                    className="w-full h-10 rounded border border-input bg-background pl-3 pr-10 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Stored encrypted in the OS keyring (libsecret / kwallet). Verified
                  against sudo before saving.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !pwd}>
                  {saving && <Loader2 className="animate-spin" />}
                  {saving ? "Verifying…" : "Save"}
                </Button>
              </div>
            </form>
          )}

          <Separator />

          <div className="text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
            <div className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
              Security note
            </div>
            <p>
              Any user-session process can read the keyring once unlocked. If you
              prefer per-action confirmation, leave this empty — polkit will prompt.
            </p>
          </div>
        </div>

        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
