// Author: Preston Lee

import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-settings-actions',
  standalone: true,
  imports: [],
  templateUrl: './settings-actions.component.html',
  styleUrl: './settings-actions.component.scss'
})
export class SettingsActionsComponent {
  idSuffix = input<string>('');

  save = output<void>();
  resetClipboard = output<void>();
  restore = output<void>();
  exportSettings = output<void>();
  importSettings = output<void>();

  onSave(): void {
    this.save.emit();
  }

  onResetClipboard(): void {
    this.resetClipboard.emit();
  }

  onRestore(): void {
    this.restore.emit();
  }

  onExport(): void {
    this.exportSettings.emit();
  }

  onImport(): void {
    this.importSettings.emit();
  }
}
