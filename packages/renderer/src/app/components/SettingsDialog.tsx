import { useState } from "react";
import { Github, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useDataMutations } from "../../lib/data/DataProvider.js";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const mutations = useDataMutations();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await mutations.connectGitHub();
    } catch (e) {
      console.error("GitHub connect failed:", e);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* GitHub Connection Section */}
        <div className="space-y-4 pt-2">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">GitHub</div>
                <div className="mt-0.5 flex items-center gap-2">
                  {mutations.githubConnected ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                      <span className="font-mono text-[11px] text-muted-foreground">Connected</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                      <span className="font-mono text-[11px] text-muted-foreground">Not connected</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {!mutations.githubConnected && (
              <div className="mt-3 pt-3 border-t border-border/60">
                <Button size="sm" onClick={handleConnect} disabled={connecting}>
                  {connecting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <Github className="h-3.5 w-3.5" />
                      Connect GitHub
                    </>
                  )}
                </Button>
                <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">
                  Connect to fetch live PR data and check statuses for your projects.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
