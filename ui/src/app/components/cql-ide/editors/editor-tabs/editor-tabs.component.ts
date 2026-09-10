// Author: Preston Lee

import { Component, ChangeDetectionStrategy, output, OnInit, inject, signal, computed, effect, untracked } from '@angular/core';
import { IdeStateService } from '../../../../services/ide-state.service';
import { libraryIdsForTabCloseAction, type EditorTabCloseAction } from '../../../../services/editor-tab-close.lib';

interface TabContextMenuState {
  libraryId: string;
  x: number;
  y: number;
}

@Component({
  selector: 'app-editor-tabs',
  templateUrl: './editor-tabs.component.html',

  styleUrls: ['./editor-tabs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:contextmenu)': 'onDocumentContextMenu($event)',
    '(document:keydown.escape)': 'closeContextMenu()',
  },
})
export class EditorTabsComponent implements OnInit {
  selectLibrary = output<string>();
  closeLibrary = output<string>();
  closeLibraries = output<string[]>();
  reorderTabs = output<{ fromIndex: number; toIndex: number }>();

  protected readonly ideStateService = inject(IdeStateService);
  protected readonly isDragOver = signal(false);
  protected readonly contextMenu = signal<TabContextMenuState | null>(null);

  protected readonly libraryResources = this.ideStateService.libraryResources;
  protected readonly activeLibraryId = this.ideStateService.activeLibraryId;

  protected readonly contextMenuLibraryIndex = computed(() => {
    const menu = this.contextMenu();
    if (!menu) return -1;
    return this.libraryResources().findIndex(library => library.id === menu.libraryId);
  });

  protected readonly canCloseOthers = computed(() => this.libraryResources().length > 1);

  protected readonly canCloseToTheRight = computed(() => {
    const index = this.contextMenuLibraryIndex();
    return index >= 0 && index < this.libraryResources().length - 1;
  });

  protected readonly canCloseSaved = computed(() =>
    this.libraryResources().some(library => !library.isDirty)
  );

  protected readonly canCloseAll = computed(() => this.libraryResources().length > 0);

  constructor() {
    effect(() => {
      const menu = this.contextMenu();
      const resources = this.libraryResources();
      if (!menu) return;
      if (!resources.some(library => library.id === menu.libraryId)) {
        untracked(() => this.contextMenu.set(null));
      }
    });
  }

  ngOnInit(): void {
    // Component initialization
  }

  onSelectLibrary(libraryId: string): void {
    this.selectLibrary.emit(libraryId);
  }

  onCloseLibrary(libraryId: string, event: Event): void {
    event.stopPropagation();
    this.closeContextMenu();
    this.closeLibrary.emit(libraryId);
  }

  onTabContextMenu(event: MouseEvent, libraryId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.openContextMenu(event.clientX, event.clientY, libraryId);
  }

  onTabClick(event: MouseEvent, libraryId: string): void {
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      this.openContextMenu(event.clientX, event.clientY, libraryId);
      return;
    }
    this.closeContextMenu();
    this.onSelectLibrary(libraryId);
  }

  onContextMenuAction(action: EditorTabCloseAction, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const menu = this.contextMenu();
    if (!menu) return;

    const libraryId = menu.libraryId;
    const ids = libraryIdsForTabCloseAction(action, this.libraryResources(), libraryId);
    this.closeContextMenu();
    if (ids.length === 0) return;

    if (action === 'close') {
      this.closeLibrary.emit(ids[0]);
      return;
    }
    this.closeLibraries.emit(ids);
  }

  onDocumentPointerDown(event: MouseEvent): void {
    if (!this.contextMenu()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.editor-tab-context-menu') || target?.closest('.editor-tab')) return;
    this.closeContextMenu();
  }

  onDocumentContextMenu(event: MouseEvent): void {
    if (!this.contextMenu()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.editor-tab') || target?.closest('.editor-tab-context-menu')) return;
    this.closeContextMenu();
  }

  closeContextMenu(): void {
    if (this.contextMenu()) {
      this.contextMenu.set(null);
    }
  }

  onTabDragStart(event: DragEvent, libraryId: string): void {
    this.closeContextMenu();
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

  onTabDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onTabDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onTabDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);

    try {
      const libraryId = event.dataTransfer?.getData('text/plain');
      if (!libraryId) return;

      const currentResources = this.libraryResources();
      const fromIndex = currentResources.findIndex(lib => lib.id === libraryId);
      if (fromIndex === -1) return;

      // Find the target index based on the drop position
      const targetIndex = this.getDropTargetIndex(event, fromIndex);
      if (targetIndex === fromIndex) return; // No change needed

      // Reorder the libraries
      this.ideStateService.reorderLibraryResources(fromIndex, targetIndex);
    } catch (error) {
      console.error('Error handling tab drop:', error);
    }
  }

  onTabDropAtPosition(event: DragEvent, targetPosition: number): void {
    event.preventDefault();
    this.isDragOver.set(false);

    try {
      const libraryId = event.dataTransfer?.getData('text/plain');
      if (!libraryId) return;

      const currentResources = this.libraryResources();
      const fromIndex = currentResources.findIndex(lib => lib.id === libraryId);
      if (fromIndex === -1) return;

      // Handle special positions
      let toIndex: number;
      if (targetPosition === -1) {
        // Drop at the end - insert after the last item
        toIndex = currentResources.length;
        // If already at the end, no change needed
        if (fromIndex === currentResources.length - 1) return;
      } else {
        // Drop at the beginning
        toIndex = 0;
        // If already at the beginning, no change needed
        if (fromIndex === 0) return;
      }

      // Reorder the libraries
      this.ideStateService.reorderLibraryResources(fromIndex, toIndex);
    } catch (error) {
      console.error('Error handling tab drop at position:', error);
    }
  }

  private openContextMenu(clientX: number, clientY: number, libraryId: string): void {
    this.selectLibrary.emit(libraryId);
    const menuWidth = 200;
    const menuHeight = 220;
    const x = Math.min(clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(clientY, window.innerHeight - menuHeight - 8);
    this.contextMenu.set({ libraryId, x: Math.max(8, x), y: Math.max(8, y) });
  }

  private getDropTargetIndex(event: DragEvent, fromIndex: number): number {
    // Get all tab elements
    const tabElements = Array.from(document.querySelectorAll('.editor-tab'));
    const targetElement = event.target as HTMLElement;

    // Find the closest tab element
    const closestTab = targetElement.closest('.editor-tab');
    if (!closestTab) return fromIndex;

    // Find the index of the target tab
    const targetTabIndex = tabElements.indexOf(closestTab);
    if (targetTabIndex === -1) return fromIndex;

    // Determine if we should insert before or after the target
    const rect = closestTab.getBoundingClientRect();
    const mouseX = event.clientX;
    const tabCenter = rect.left + rect.width / 2;

    // If mouse is in the left half, insert before; otherwise insert after
    return mouseX < tabCenter ? targetTabIndex : targetTabIndex + 1;
  }
}
