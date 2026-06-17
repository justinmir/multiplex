import { handle } from "../router.js";
import { configStore } from "../../git/ConfigStore.js";
import { githubAuth } from "../../git/GitHubAuth.js";

/** Register GitHub OAuth IPC handlers. The token stays in main — the renderer
 *  only ever learns the connection status, never the token value. */
export function registerGitHubAuthHandlers() {
  // Initiate OAuth flow (async — returns immediately, resolves when user completes)
  handle("github:connect", async () => githubAuth.startOAuth());

  // Validate + store a personal access token (the token never leaves main).
  handle("github:set-token", async (req) => githubAuth.setToken(req.token));

  // Check connection status + whether the browser OAuth flow is even available.
  handle("github:get-status", () => ({
    connected: configStore.isGitHubConnected(),
    oauthAvailable: githubAuth.isOAuthConfigured(),
  }));
}
