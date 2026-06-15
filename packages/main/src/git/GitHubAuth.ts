import http from "node:http";
import { randomUUID } from "node:crypto";
import { shell } from "electron";
import { configStore } from "./ConfigStore.js";

const GITHUB_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID || "";
const GITHUB_REDIRECT_PORT = 39876; // Fixed port for OAuth callback

export class GitHubAuth {

  /**
   * Start the GitHub OAuth flow.
   * Opens system browser → user authenticates → local server captures code → exchanges for token.
   */
  async startOAuth(): Promise<{ success: boolean }> {
    // Generate a unique state token for CSRF protection
    const state = randomUUID();

    // Build the GitHub OAuth authorize URL
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: `http://localhost:${GITHUB_REDIRECT_PORT}/callback`,
      scope: "repo",
      state,
    });

    const authUrl = `https://github.com/login/oauth/authorize?${params}`;

    return new Promise((resolve) => {
      // Set up a local HTTP server to capture the callback
      const server = http.createServer(async (req, res) => {
        try {
          if (!req.url) {
            res.writeHead(400);
            res.end("Bad request");
            return;
          }

          const url = new URL(req.url, `http://localhost:${GITHUB_REDIRECT_PORT}`);

          if (url.pathname !== "/callback") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }

          // Verify CSRF state
          const receivedState = url.searchParams.get("state");
          if (receivedState !== state) {
            res.writeHead(403);
            res.end("Invalid state parameter — possible CSRF attack");
            server.close();
            resolve({ success: false });
            return;
          }

          const code = url.searchParams.get("code");

          if (!code) {
            // User denied access
            res.writeHead(200);
            res.end(`<html><body style="font-family:sans-serif;text-align:center;margin-top:60px"><h2>Authorization cancelled</h2><p>You can close this window.</p></body></html>`);
            server.close();
            resolve({ success: false });
            return;
          }

          // Exchange the authorization code for a token
          const token = await exchangeCodeForToken(code);

          if (token) {
            configStore.setGitHubToken(token);
            res.writeHead(200);
            res.end(`<html><body style="font-family:sans-serif;text-align:center;margin-top:60px"><h2>Connected to GitHub</h2><p>You can close this window and return to the app.</p></body></html>`);
            server.close();
            resolve({ success: true });
          } else {
            res.writeHead(500);
            res.end(`<html><body style="font-family:sans-serif;text-align:center;margin-top:60px"><h2>Token exchange failed</h2><p>Please try again.</p></body></html>`);
            server.close();
            resolve({ success: false });
          }
        } catch (err) {
          console.error("OAuth callback error:", err);
          res.writeHead(500);
          res.end(`<html><body style="font-family:sans-serif;text-align:center;margin-top:60px"><h2>Error</h2><p>An unexpected error occurred.</p></body></html>`);
        }
      });

      server.listen(GITHUB_REDIRECT_PORT, () => {
        // Open system browser to GitHub OAuth page
        shell.openExternal(authUrl).catch((err) => {
          console.error("Failed to open auth URL:", err);
          server.close();
          resolve({ success: false });
        });

        // Timeout after 5 minutes if user doesn't complete flow
        setTimeout(() => {
          server.close();
          resolve({ success: false });
        }, 300_000);
      });

      // Handle server errors
      server.on("error", (err) => {
        console.error("OAuth server error:", err);
        resolve({ success: false });
      });
    });
  }
}

/** Exchange authorization code for a personal access token via GitHub API. */
async function exchangeCodeForToken(code: string): Promise<string | null> {
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Multiplex-Electron",
      },
      body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, code }),
    });

    if (!response.ok) {
      console.error(`Token exchange failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // GitHub returns the token as "token" or "access_token" depending on response type
    return (data as Record<string, unknown>).token as string ||
           (data as Record<string, unknown>).access_token as string || null;
  } catch (err) {
    console.error("Token exchange error:", err);
    return null;
  }
}

/** Default singleton instance. */
export const githubAuth = new GitHubAuth();
