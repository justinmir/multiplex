import { useEffect, useState } from "react";
import { Github, Loader2, CheckCircle2, AlertCircle, Plus, FolderGit2 } from "lucide-react";
import type { AppSettingsData } from "@app/core";
import { call } from "../lib/ipc/client";
import { useHarnessInfo } from "../lib/session/useHarnessInfo.js";
import { useRepos } from "../lib/repos/useRepos.js";
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
  const [connecting, setConnecting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  // GitHub: the token never crosses IPC; we only track connection status here,
  // and the token input is write-only.
  const [githubConnected, setGithubConnected] = useState(false);
  const [oauthAvailable, setOauthAvailable] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [connectedLogin, setConnectedLogin] = useState<string | null>(null);
  // M-A8: Harness state with dynamic model list and health status
  const { info: harnessInfo, loading: harnessLoading, refresh: refreshHarness } = useHarnessInfo(settings?.harnessId, open && !!settings);

  const refreshGithubStatus = async () => {
    try {
      const { connected, oauthAvailable } = await call("github:get-status", undefined as never);
      setGithubConnected(connected);
      setOauthAvailable(oauthAvailable);
    } catch { /* not critical */ }
  };

  // Load settings (secrets redacted) + connection status when dialog opens
  useEffect(() => {
    if (open) {
      call("settings:get", undefined).then(data => setSettings(data));
      refreshGithubStatus();
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
      await refreshGithubStatus();
    } catch (e) {
      console.error("GitHub connect failed:", e);
    } finally {
      setConnecting(false);
    }
  };

  const handleSaveToken = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setSavingToken(true);
    setTokenError(null);
    try {
      // Validates against the GitHub API before storing, so a bad token surfaces
      // an error here rather than silently failing later on PR fetches.
      const res = await call("github:set-token", { token });
      if (res.connected) {
        setTokenInput("");
        setConnectedLogin(res.login ?? null);
        await refreshGithubStatus();
      } else {
        setTokenError(res.error ?? "Could not validate token.");
      }
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : "Failed to save token.");
    } finally {
      setSavingToken(false);
    }
  };

  const handleDisconnectGitHub = async () => {
    await save({ githubToken: "" });
    setConnectedLogin(null);
    setTokenError(null);
    await refreshGithubStatus();
  };

  const openTokenPage = () => {
    call("app:open-url", { url: "https://github.com/settings/tokens/new?scopes=repo&description=Multiplex" }).catch(() => {});
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

        {/* GitHub Section — the token lives in main; the renderer only writes it. */}
        <div className="space-y-4 py-2">
          <h3 className="text-sm font-medium text-muted-foreground">GitHub</h3>

          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">GitHub</div>
                <span className="flex items-center gap-1.5 mt-0.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${githubConnected ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {githubConnected ? (connectedLogin ? `Connected as ${connectedLogin}` : "Connected") : "Not connected"}
                  </span>
                </span>
              </div>
              {githubConnected && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={handleDisconnectGitHub}>
                  Disconnect
                </Button>
              )}
            </div>

            {!githubConnected && (
              <div className="mt-3 space-y-3 pt-3 border-t border-border/60">
                {/* OAuth is only offered when a GitHub OAuth App is configured
                    (GITHUB_OAUTH_CLIENT_ID); otherwise the authorize URL 404s, so
                    we lead with the personal-access-token path that always works. */}
                {oauthAvailable && (
                  <Button variant="outline" size="sm" onClick={handleConnectGitHub} disabled={connecting}>
                    {connecting ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</>
                    ) : (
                      <><Github className="h-3.5 w-3.5" /> Connect with GitHub</>
                    )}
                  </Button>
                )}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="gh-token">{oauthAvailable ? "…or paste a personal access token" : "Paste a personal access token"}</Label>
                    <button type="button" onClick={openTokenPage} className="text-xs text-accent underline underline-offset-2 hover:opacity-80">
                      Create a token
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="gh-token"
                      type="password"
                      placeholder="ghp_…"
                      value={tokenInput}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setTokenInput(e.target.value); setTokenError(null); }}
                      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleSaveToken(); }}
                    />
                    <Button variant="outline" size="sm" onClick={handleSaveToken} disabled={!tokenInput.trim() || savingToken}>
                      {savingToken ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                  {tokenError && (
                    <p className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {tokenError}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Needs the <span className="font-mono">repo</span> scope to read PRs, checks, and reviews.</p>
                </div>
              </div>
            )}
          </div>

          {githubConnected && (
            <div className="flex items-center justify-between">
              <Label htmlFor="pr-poll-interval">Sync PR status every</Label>
              <select
                id="pr-poll-interval"
                value={settings.prPollIntervalMinutes ?? 5}
                onChange={(e) => save({ prPollIntervalMinutes: Number(e.target.value) })}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
          )}
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
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-synthesize-toggle">Auto-synthesize on activity</Label>
                <Switch
                  id="auto-synthesize-toggle"
                  checked={settings.autoSynthesizeOnActivity}
                  onCheckedChange={(v: boolean) => save({ autoSynthesizeOnActivity: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="synthesis-interval">Resynthesize projects every</Label>
                <select
                  id="synthesis-interval"
                  value={settings.synthesisIntervalMinutes ?? 60}
                  onChange={(e) => save({ synthesisIntervalMinutes: Number(e.target.value) })}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={360}>6 hours</option>
                  <option value={1440}>1 day</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* Storage Section (M7.2) */}
        <div className="space-y-2 py-2">
          <h3 className="text-sm font-medium text-muted-foreground">Storage</h3>
          <div className="flex items-center justify-between">
            <Label htmlFor="backend-select">Persistence backend</Label>
            <select
              id="backend-select"
              value={settings.repoBackend ?? "json"}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => save({ repoBackend: e.target.value as "json" | "sqlite" })}
              className="bg-background border rounded px-2 py-1 text-sm"
            >
              <option value="json">JSON file (default)</option>
              <option value="sqlite">SQLite</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Takes effect on restart. Switching to SQLite migrates your existing data once (db.json is backed up).
          </p>
        </div>

        {/* Repo Catalog Section */}
        <RepoCatalogSection />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The repo catalog: the set of local git repos a session's agent may declare.
 * Repos are registered here once (validated as real git repos), never picked
 * per-session.
 */
function RepoCatalogSection() {
  const { repos, add, remove } = useRepos();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    const root = path.trim();
    if (!root || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await add(root);
      if (result.ok) setPath("");
      else setError(result.error ?? "Failed to add repo");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add repo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 py-2">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground">Repositories</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Local git repos a session's agent can work in. Sessions never ask you to pick — the agent declares repos as it works.
        </p>
      </div>

      {repos.length > 0 ? (
        repos.map((repo) => (
          <div key={repo.name} className="flex items-center justify-between gap-2 p-2 border rounded">
            <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm">{repo.name}</span>
            <span className="flex-1 truncate text-xs text-muted-foreground">{repo.root}</span>
            <Button variant="ghost" size="sm" onClick={() => remove(repo.name)}>Remove</Button>
          </div>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">No repositories registered yet.</p>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="/absolute/path/to/repo"
          value={path}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setError(null); setPath(e.target.value); }}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAdd(); }}
        />
        <Button variant="outline" size="sm" onClick={handleAdd} disabled={!path.trim() || busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
