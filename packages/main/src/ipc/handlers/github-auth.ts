import { handle } from "../router.js";
import { configStore } from "../../git/ConfigStore.js";
import { githubAuth } from "../../git/GitHubAuth.js";

/** Register GitHub OAuth IPC handlers. */
export function registerGitHubAuthHandlers() {
  // Return stored token or null if not connected
  handle("github:get-token", () => configStore.getGitHubToken());

  // Initiate OAuth flow (async — returns immediately, resolves when user completes)
  handle("github:connect", async () => githubAuth.startOAuth());

  // Check connection status
  handle("github:get-status", () => ({ connected: configStore.isGitHubConnected() }));
}
