// Author: Preston Lee

import { Component, Input, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IdeStateService } from '../../../../services/ide-state.service';
import { OutlineItem } from '../../shared/ide-types';

@Component({
  selector: 'app-outline-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './outline-tab.component.html',
  styleUrls: ['./outline-tab.component.scss']
})
export class OutlineTabComponent {
  public outlineSearchTerm: string = '';
  public outlineSortBy: 'name' | 'type' | 'line' = 'line';
  public outlineSortOrder: 'asc' | 'desc' = 'asc';

  @Output() navigateToLine = new EventEmitter<number>();

  constructor(public ideStateService: IdeStateService) {}

  // Computed properties for outline items
  public outlineItems = computed(() => {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    if (!activeLibrary) return [];

    const items: OutlineItem[] = [];
    const lines = activeLibrary.cqlContent.split('\n');
    
    lines.forEach((line: string, index: number) => {
      const trimmed = line.trim();
      const lineNumber = index + 1;
      
      if (trimmed.startsWith('library ')) {
        items.push({ name: trimmed, type: 'library', line: lineNumber });
      } else if (trimmed.startsWith('define ')) {
        const name = trimmed.replace('define ', '').split(':')[0].trim();
        items.push({ name, type: 'define', line: lineNumber });
      } else if (trimmed.startsWith('function ')) {
        const name = trimmed.replace('function ', '').split('(')[0].trim();
        items.push({ name, type: 'function', line: lineNumber });
      } else if (trimmed.startsWith('parameter ')) {
        const name = trimmed.replace('parameter ', '').split(':')[0].trim();
        items.push({ name, type: 'parameter', line: lineNumber });
      } else if (trimmed.startsWith('valueset ')) {
        const name = trimmed.replace('valueset ', '').split(':')[0].trim();
        items.push({ name, type: 'valueset', line: lineNumber });
      } else if (trimmed.startsWith('codesystem ')) {
        const name = trimmed.replace('codesystem ', '').split(':')[0].trim();
        items.push({ name, type: 'codesystem', line: lineNumber });
      }
    });
    
    return items;
  });

  public filteredOutlineItems = computed(() => {
    let filtered = [...this.outlineItems()];
    
    // Apply search filter
    if (this.outlineSearchTerm.trim()) {
      const searchTerm = this.outlineSearchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.name.toLowerCase().includes(searchTerm) ||
        item.type.toLowerCase().includes(searchTerm)
      );
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (this.outlineSortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'line':
          comparison = a.line - b.line;
          break;
      }
      
      return this.outlineSortOrder === 'asc' ? comparison : -comparison;
    });
    
    return filtered;
  });

  onOutlineSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.outlineSearchTerm = target.value;
  }

  changeOutlineSorting(sortBy: 'name' | 'type' | 'line'): void {
    if (this.outlineSortBy === sortBy) {
      this.outlineSortOrder = this.outlineSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.outlineSortBy = sortBy;
      this.outlineSortOrder = 'asc';
    }
  }

  onOutlineItemClick(item: OutlineItem): void {
    this.navigateToLine.emit(item.line);
  }

  trackByOutlineItem(index: number, item: OutlineItem): string {
    return `${item.type}-${item.line}-${item.name}`;
  }
}
