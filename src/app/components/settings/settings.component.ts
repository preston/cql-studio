// Author: Preston Lee

import { Component, OnInit, viewChild, ElementRef, inject, signal } from '@angular/core';
import { SettingsService } from '../../services/settings.service';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ThemeType } from '../../models/settings.model';
import { ToastService } from '../../services/toast.service';
import { ClipboardService } from '../../services/clipboard.service';
import { SettingsActionsComponent } from './settings-actions/settings-actions.component';
import { SettingsSectionNavComponent, SettingsSectionId } from './settings-section-nav/settings-section-nav.component';
import { SettingsEnvironmentsComponent } from './settings-environments/settings-environments.component';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, SettingsActionsComponent, SettingsSectionNavComponent, SettingsEnvironmentsComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  importFileInput = viewChild.required<ElementRef<HTMLInputElement>>('importFileInput');

  protected readonly settingsService = inject(SettingsService);
  protected readonly router = inject(Router);
  protected readonly route = inject(ActivatedRoute);
  protected readonly toastService = inject(ToastService);
  private readonly clipboardService = inject(ClipboardService);

  readonly activeSection = signal<SettingsSectionId>('environments');

  ngOnInit() {
    this.reload();
    const section = this.route.snapshot.queryParamMap.get('section');
    if (this.isValidSection(section)) {
      this.activeSection.set(section);
    }
  }

  reload() {
    this.settingsService.reload();
  }

  themeTypes() {
    return ThemeType;
  }

  themePreferenceChanged() {
    this.settingsService.setEffectiveTheme();
  }

  onValidateSchemaChange(): void {
    this.settingsService.saveSettings();
  }

  onSectionChange(section: SettingsSectionId): void {
    this.activeSection.set(section);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  save() {
    this.settingsService.saveSettings();
    this.toastService.showSuccess('Settings are local to your browser only.', 'Settings Saved');
  }

  restore() {
    this.settingsService.forceResetToDefaults();
    this.toastService.showSuccess('All settings have been restored to their defaults.', 'Settings Restored');
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
    this.importFileInput().nativeElement.click();
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

  private isValidSection(section: string | null): section is SettingsSectionId {
    return section === 'environments'
      || section === 'advanced'
      || section === 'runner'
      || section === 'registry'
      || section === 'vsac'
      || section === 'server';
  }
}
