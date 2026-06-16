import Store from "electron-store";
import type { AppSettingsData } from "@app/core";

const defaultSettings: AppSettingsData = {
  harnessId: "opencode",
  repoRoots: [],
  intelligenceEnabled: false,
  autoSynthesizeOnActivity: true,
};

export class AppSettings {
  private store: Store<AppSettingsData>;

  constructor() {
    this.store = new Store<AppSettingsData>({
      name: "multiplex-settings",
      defaults: defaultSettings,
    });
  }

  get(): AppSettingsData {
    return { ...defaultSettings, ...this.store.store };
  }

  set(partial: Partial<AppSettingsData>): AppSettingsData {
    this.store.set(partial);
    return this.get();
  }
}

// Singleton instance
let appSettingsInstance: AppSettings | null = null;

export function getAppSettings(): AppSettings {
  if (!appSettingsInstance) {
    appSettingsInstance = new AppSettings();
  }
  return appSettingsInstance;
}
