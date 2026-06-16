import { getAppSettings } from "../settings/AppSettings.js";

class ConfigStoreImpl {
  getGitHubToken(): string | null {
    return getAppSettings().get().githubToken ?? null;
  }

  setGitHubToken(token: string): void {
    getAppSettings().set({ githubToken: token });
  }

  clearGitHubToken(): void {
    getAppSettings().set({ githubToken: undefined });
  }

  isGitHubConnected(): boolean {
    return !!getAppSettings().get().githubToken;
  }
}

/** Default singleton instance. */
export const configStore = new ConfigStoreImpl();
