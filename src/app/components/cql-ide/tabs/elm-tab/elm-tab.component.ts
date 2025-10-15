// Author: Preston Lee

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../../services/settings.service';
import { TranslationService } from '../../../../services/translation.service';
import { IdeStateService } from '../../../../services/ide-state.service';

@Component({
  selector: 'app-elm-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './elm-tab.component.html',
  styleUrls: ['./elm-tab.component.scss']
})
export class ElmTabComponent {
  @Input() cqlContent: string = '';
  @Input() isTranslating: boolean = false;
  @Input() elmTranslationResults: string | null = null;
  
  @Output() translateCqlToElm = new EventEmitter<void>();
  @Output() clearElmTranslation = new EventEmitter<void>();

  constructor(
    public settingsService: SettingsService,
    public translationService: TranslationService,
    public ideStateService: IdeStateService
  ) {}

  get enableElmTranslation(): boolean {
    return this.settingsService.settings().enableElmTranslation;
  }

  onTranslateCqlToElm(): void {
    this.translateCqlToElm.emit();
  }

  onClearElmTranslation(): void {
    this.clearElmTranslation.emit();
  }

  elmTranslationResultsAsString(): string {
    return this.elmTranslationResults || '';
  }
}
