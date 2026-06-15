import Store from "electron-store";

export interface AppConfig {
  githubToken?: string;
}

class ConfigStoreImpl {
  readonly #store = new Store<AppConfig>({
    name: "multiplex-config",
    fileExtension: "json",
  });

  getGitHubToken(): string | null {
    return this.#store.get("githubToken") ?? null;
  }

  setGitHubToken(token: string): void {
    this.#store.set("githubToken", token);
  }

  clearGitHubToken(): void {
    this.#store.delete("githubToken");
  }

  isGitHubConnected(): boolean {
    return !!this.#store.get("githubToken");
  }
}

/** Default singleton instance. */
export const configStore = new ConfigStoreImpl();
