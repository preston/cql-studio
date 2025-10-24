// Author: Preston Lee

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-ide-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ide-header.component.html',
  styleUrls: ['./ide-header.component.scss']
})
export class IdeHeaderComponent {
  @Input() libraryResources: any[] = [];
  @Input() activeLibraryId: string | null = null;
  @Input() isExecuting: boolean = false;
  @Input() isEvaluating: boolean = false;
  @Input() isTranslating: boolean = false;
  
  @Output() libraryIdChange = new EventEmitter<string>();
  @Output() libraryVersionChange = new EventEmitter<string>();
  @Output() libraryDescriptionChange = new EventEmitter<string>();
  @Output() saveLibrary = new EventEmitter<void>();
  @Output() deleteLibrary = new EventEmitter<string>();
  @Output() translateCqlToElm = new EventEmitter<void>();
  @Output() clearElmTranslation = new EventEmitter<void>();
  @Output() executeAll = new EventEmitter<void>();

  constructor(public router: Router) {}

  onLibraryIdChange(libraryId: string): void {
    this.libraryIdChange.emit(libraryId);
  }

  onLibraryVersionChange(version: string): void {
    this.libraryVersionChange.emit(version);
  }

  onLibraryDescriptionChange(description: string): void {
    this.libraryDescriptionChange.emit(description);
  }

  onSaveLibrary(): void {
    this.saveLibrary.emit();
  }

  onDeleteLibrary(libraryId: string): void {
    this.deleteLibrary.emit(libraryId);
  }

  onTranslateCqlToElm(): void {
    this.translateCqlToElm.emit();
  }

  onClearElmTranslation(): void {
    this.clearElmTranslation.emit();
  }

  onExecuteAll(): void {
    this.executeAll.emit();
  }

  onNavigateToSettings(): void {
    this.router.navigate(['/settings']);
  }
}
