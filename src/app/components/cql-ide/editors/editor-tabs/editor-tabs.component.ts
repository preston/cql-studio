// Author: Preston Lee

import { Component, Input, Output, EventEmitter, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IdeStateService } from '../../../../services/ide-state.service';
import { LibraryResource } from '../../shared/ide-types';

@Component({
  selector: 'app-editor-tabs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './editor-tabs.component.html',
  styleUrls: ['./editor-tabs.component.scss']
})
export class EditorTabsComponent implements OnInit {
  @Output() selectLibrary = new EventEmitter<string>();
  @Output() closeLibrary = new EventEmitter<string>();
  @Output() reorderTabs = new EventEmitter<{ fromIndex: number; toIndex: number }>();

  get libraryResources() {
    return this.ideStateService.libraryResources;
  }
  
  get activeLibraryId() {
    return this.ideStateService.activeLibraryId;
  }

  constructor(public ideStateService: IdeStateService) {}

  ngOnInit(): void {
    // Component initialization
  }

  onSelectLibrary(libraryId: string): void {
    this.selectLibrary.emit(libraryId);
  }

  onCloseLibrary(libraryId: string, event: Event): void {
    event.stopPropagation();
    this.closeLibrary.emit(libraryId);
  }

  onTabDragStart(event: DragEvent, libraryId: string): void {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', libraryId);
    }
  }

  onTabDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onTabDrop(event: DragEvent): void {
    event.preventDefault();
    
    try {
      const libraryId = event.dataTransfer?.getData('text/plain');
      if (libraryId) {
        // Handle tab reordering logic here
        // This would need to be implemented based on the specific requirements
      }
    } catch (error) {
      console.error('Error handling tab drop:', error);
    }
  }

  trackByLibraryId(index: number, library: LibraryResource): string {
    return library.id;
  }
}
