// Author: Preston Lee

import { Injectable, signal } from '@angular/core';
import { Settings, ThemeType } from '../models/settings.model';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  public static SETTINGS_KEY: string = "cql_tests_ui_settings";
  public static FORCE_RESET_KEY: string = "cql_tests_ui_settings_force_reset";

  public settings = signal<Settings>(new Settings());
  public force_reset = signal<boolean>(false);
  public theme_effective = signal<ThemeType>(ThemeType.LIGHT);

  constructor() {
    this.reload();
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', ({ matches }) => {
        if (this.settings().theme_preferred == ThemeType.AUTOMATIC) {
          if (matches) {
            this.theme_effective.set(ThemeType.DARK);
            this.saveSettings();
            console.log("Changed to dark mode!")
          } else {
            this.theme_effective.set(ThemeType.LIGHT);
            this.saveSettings();
            console.log("Changed to light mode!")
          }
        }
      })
  }

  setEffectiveTheme() {
    if (this.settings().theme_preferred == ThemeType.AUTOMATIC) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        this.theme_effective.set(ThemeType.DARK);
        console.log("Theme automatically set to dark mode!")
      } else {
        this.theme_effective.set(ThemeType.LIGHT);
        console.log("Theme automatically set to light mode!")
      }
    } else {
      this.theme_effective.set(this.settings().theme_preferred);
      console.log("Theme forced to", this.settings().theme_preferred, "mode!")
    }
  }

  reload() {
    this.force_reset.set((localStorage.getItem(SettingsService.FORCE_RESET_KEY) == 'true' ? true : false));
    if (this.force_reset()) {
      this.forceResetToDefaults();
    }
    let tmp = localStorage.getItem(SettingsService.SETTINGS_KEY);
    if (tmp) {
      try {
        const parsedSettings = JSON.parse(tmp);
        let shouldSave = false;
        if (parsedSettings.experimental == null) {
          parsedSettings.experimental = false;
          shouldSave = true;
        }
        if (parsedSettings.developer == null) {
          parsedSettings.developer = false;
          shouldSave = true;
        }
        if (parsedSettings.theme_preferred == null) {
          parsedSettings.theme_preferred = Settings.DEFAULT_THEME;
          shouldSave = true;
        }
        if (parsedSettings.validateSchema == null) {
          parsedSettings.validateSchema = false;
          shouldSave = true;
        }
        if (parsedSettings.runnerApiBaseUrl == null) {
          parsedSettings.runnerApiBaseUrl = this.getDefaultRunnerApiBaseUrl();
          shouldSave = true;
        }
        if (shouldSave) {
          this.saveSettings();
          console.log("Settings have been updated to include default field values.");
        } else {
          console.log("Settings have been loaded from local browser storage on this device without modification.");
        }
        this.settings.set(parsedSettings);
        console.log("Current settings:", this.settings());

      } catch (e) {
        console.log("Settings could not be parsed and are likely not valid JSON. They will be ignored.");
        console.log(e);
      }
    } else {
      this.settings.set(new Settings());
      this.saveSettings();
    }
    this.setEffectiveTheme();
  }

  forceResetToDefaults() {
    localStorage.clear();
    this.settings.set(new Settings());
    this.force_reset.set(false);
    this.saveSettings();
    this.setEffectiveTheme();
    this.reload();
    console.log("All application settings have been restored to their defaults.");
  }

  saveSettings() {
    localStorage.setItem(SettingsService.SETTINGS_KEY, JSON.stringify(this.settings()));
    console.log("Your settings have been saved to local browser storage on this device. They will not be sync'd to any other system, even if your browser supports such features.");
  }

  getDefaultRunnerApiBaseUrl(): string {
    return (window as any)['CQL_TESTS_UI_RUNNER_BASE_URL'] || 'http://localhost:3000';
  }
}
