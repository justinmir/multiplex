import { useEffect, useState } from "react";
import { Eye, EyeOff, Github, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { AppSettingsData } from "@app/core";
import { call } from "../lib/ipc/client";
import { useHarnessInfo } from "../lib/session/useHarnessInfo.js";
import { Button } from "../app/components/ui/button";
import { Input } from "../app/components/ui/input";
import { Label } from "../app/components/ui/label";
import { Switch } from "../app/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../app/components/ui/dialog";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettingsData | null>(null);
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  // M-A8: Harness state with dynamic model list and health status
  const { info: harnessInfo, loading: harnessLoading, refresh: refreshHarness } = useHarnessInfo(settings?.harnessId, open && !!settings);

  // Load settings when dialog opens
  useEffect(() => {
    if (open) {
      call("settings:get", undefined).then(data => setSettings(data));
    }
  }, [open]);

  const save = async (partial: Partial<AppSettingsData>) => {
    try {
      const updated = await call("settings:set", partial);
      setSettings(updated);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  const handleConnectGitHub = async () => {
    setConnecting(true);
    try {
      await call("github:connect", undefined as never);
      // Reload settings after OAuth completes so the token shows up
      const updated = await call("settings:get", undefined);
      setSettings(updated);
    } catch (e) {
      console.error("GitHub connect failed:", e);
    } finally {
      setConnecting(false);
    }
  };

  if (!settings) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* M-A8: Harness Section with health status and model picker */}
        <div className="space-y-4 py-2">
          <h3 className="text-sm font-medium text-muted-foreground">Harness</h3>

          <div className="flex items-center justify-between">
            <Label htmlFor="harness-select">Active harness</Label>
            <select
              id="harness-select"
              value={settings.harnessId ?? "opencode"}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => save({ harnessId: e.target.value as "mock" | "opencode" })}
              className="bg-background border rounded px-2 py-1 text-sm"
            >
              <option value="mock">Mock (dev)</option>
              <option value="opencode">OpenCode</option>
            </select>
          </div>

          {/* Harness Health Status */}
          {harnessInfo.health && (
            <div className={`flex items-center gap-2 text-xs ${harnessInfo.health.ok ? "text-green-500" : "text-red-500"}`}>
              {harnessInfo.health.ok ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Connected{harnessInfo.health.version ? ` v${harnessInfo.health.version}` : ""}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{harnessInfo.health.detail ?? "Not connected"}</span>
                </>
              )}
            </div>
          )}

          {/* M-A8: Test connection button */}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setTestingConnection(true);
              try {
                await refreshHarness();
              } finally {
                setTestingConnection(false);
              }
            }}
            disabled={testingConnection || harnessLoading}
          >
            {testingConnection ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Testing…
              </>
            ) : (
              "Test connection"
            )}
          </Button>

          {/* Model Picker */}
          <div className="space-y-2">
            <Label htmlFor="model-select">Default model</Label>
            {harnessLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading models...
              </div>
            ) : harnessInfo.models && harnessInfo.models.length > 0 ? (
              <select
                id="model-select"
                value={settings.defaultModel ?? ""}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => save({ defaultModel: e.target.value })}
                className="bg-background border rounded px-2 py-1 text-sm w-full"
              >
                {!settings.defaultModel && <option value="">-- Select a model --</option>}
                {harnessInfo.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label ?? m.id}{m.provider ? ` (${m.provider})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="model-input"
                placeholder="Enter model ID manually..."
                value={settings.defaultModel ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => save({ defaultModel: e.target.value })}
              />
            )}
          </div>
        </div>

        {/* API Keys Section */}
        <div className="space-y-4 py-2">
          <h3 className="text-sm font-medium text-muted-foreground">API Keys</h3>

          {(["githubToken", "anthropicApiKey"] as const).map((key) => (
            <div key={key} className="space-y-2">
              <Label>{key === "githubToken" ? "GitHub Token" : "Anthropic API Key"}</Label>
              <div className="flex gap-2">
                <Input
                  type={showToken[key] ? "text" : "password"}
                  placeholder={`Enter ${key}...`}
                  value={settings[key] ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => save({ [key]: e.target.value })}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken(prev => ({ ...prev, [key]: !prev[key] }))}
                  aria-label={showToken[key] ? "Hide token" : "Show token"}
                >
                  {showToken[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          ))}

          {/* GitHub Connection Status */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">GitHub</div>
                <span className="flex items-center gap-1.5 mt-0.5">
                  {settings.githubToken ? (
                    <>
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                      <span className="font-mono text-xs text-muted-foreground">Connected</span>
                    </>
                  ) : (
                    <>
                      <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                      <span className="font-mono text-xs text-muted-foreground">Not connected</span>
                    </>
                  )}
                </span>
              </div>
            </div>

            {!settings.githubToken && (
              <div className="mt-3 pt-3 border-t border-border/60">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnectGitHub}
                  disabled={connecting}
                >
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
              </div>
            )}
          </div>
        </div>

        {/* Intelligence Section */}
        <div className="space-y-4 py-2">
          <h3 className="text-sm font-medium text-muted-foreground">Intelligence</h3>

          <div className="flex items-center justify-between">
            <Label htmlFor="intelligence-toggle">Enable project intelligence</Label>
            <Switch
              id="intelligence-toggle"
              checked={settings.intelligenceEnabled}
              onCheckedChange={(v: boolean) => save({ intelligenceEnabled: v })}
            />
          </div>

          {settings.intelligenceEnabled && (
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-synthesize-toggle">Auto-synthesize on activity</Label>
              <Switch
                id="auto-synthesize-toggle"
                checked={settings.autoSynthesizeOnActivity}
                onCheckedChange={(v: boolean) => save({ autoSynthesizeOnActivity: v })}
              />
            </div>
          )}
        </div>

        {/* Repo Roots Section */}
        <div className="space-y-4 py-2">
          <h3 className="text-sm font-medium text-muted-foreground">Repository Roots</h3>

          {settings.repoRoots.length > 0 ? (
            settings.repoRoots.map((repo, index) => (
              <div key={index} className="flex items-center justify-between gap-2 p-2 border rounded">
                <span className="text-sm">{repo.name}</span>
                <span className="text-xs text-muted-foreground truncate max-w-[180px]">{repo.root}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newRoots = settings.repoRoots.filter((_, i) => i !== index);
                    save({ repoRoots: newRoots });
                  }}
                >
                  Remove
                </Button>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No repository roots configured.</p>
          )}

          <p className="text-xs text-muted-foreground">
            Add repos from the workspace picker in session composer.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
