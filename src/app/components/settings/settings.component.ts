// Author: Preston Lee

import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { SettingsService } from '../../services/settings.service';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ThemeType } from '../../models/settings.model';
import { ToastService } from '../../services/toast.service';
import { ClipboardService } from '../../services/clipboard.service';
import { SettingsActionsComponent } from './settings-actions/settings-actions.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, SettingsActionsComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  @ViewChild('importFileInput') importFileInput!: ElementRef<HTMLInputElement>;

  constructor(
    protected settingsService: SettingsService,
    public location: Location,
    protected router: Router,
    protected toastService: ToastService,
    private clipboardService: ClipboardService
  ) {
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    this.settingsService.reload();
  }

  themeTypes() {
    return ThemeType;
  }

  themePreferenceChanged($event: any) {
    this.settingsService.setEffectiveTheme();
  }

  onValidateSchemaChange(): void {
    this.settingsService.saveSettings();
  }

  save() {
    this.settingsService.saveSettings();
    this.toastService.showSuccess("Settings are local to your browser only.", "Settings Saved");
    this.location.back();
  }

  restore() {
    this.settingsService.forceResetToDefaults();
    this.toastService.showSuccess("All settings have been restored to their defaults.", "Settings Restored");
  }

  onResetClipboard(): void {
    this.clipboardService.resetClipboard();
    this.toastService.showSuccess('Clipboard has been cleared.', 'Clipboard Reset');
  }

  onExportSettings(): void {
    const json = this.settingsService.exportSettingsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = SettingsService.EXPORT_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
    this.toastService.showSuccess('Settings exported to ' + SettingsService.EXPORT_FILENAME, 'Settings Exported');
  }

  onImportSettings(): void {
    this.importFileInput.nativeElement.click();
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      if (this.settingsService.importSettingsJson(text)) {
        this.toastService.showSuccess('Settings loaded from file.', 'Settings Imported');
      } else {
        this.toastService.showError('File is not valid settings JSON.', 'Import Failed');
      }
    };
    reader.readAsText(file);
  }

  back() {
    this.location.back();
  }
}

