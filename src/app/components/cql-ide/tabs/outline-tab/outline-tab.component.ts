// Author: Preston Lee

import { Component, Input, Output, EventEmitter, computed, signal } from '@angular/core';
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
  public outlineSearchTerm = signal('');
  public outlineSortBy = signal<'name' | 'type' | 'line'>('name');
  public outlineSortOrder = signal<'asc' | 'desc'>('asc');

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
    if (this.outlineSearchTerm().trim()) {
      const searchTerm = this.outlineSearchTerm().toLowerCase();
      filtered = filtered.filter(item => 
        item.name.toLowerCase().includes(searchTerm) ||
        item.type.toLowerCase().includes(searchTerm)
      );
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (this.outlineSortBy()) {
        case 'name':
          comparison = this.normalizeNameForSorting(a.name).localeCompare(this.normalizeNameForSorting(b.name));
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'line':
          comparison = a.line - b.line;
          break;
      }
      
      return this.outlineSortOrder() === 'asc' ? comparison : -comparison;
    });
    
    return filtered;
  });


  onSortByChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const newSortBy = target.value as 'name' | 'type' | 'line';
    this.changeOutlineSorting(newSortBy);
  }

  changeOutlineSorting(sortBy: 'name' | 'type' | 'line'): void {
    if (this.outlineSortBy() === sortBy) {
      this.outlineSortOrder.set(this.outlineSortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.outlineSortBy.set(sortBy);
      this.outlineSortOrder.set('asc');
    }
  }

  onOutlineItemClick(item: OutlineItem): void {
    this.navigateToLine.emit(item.line);
  }

  trackByOutlineItem(index: number, item: OutlineItem): string {
    return `${item.type}-${item.line}-${item.name}`;
  }

  // Getters and setters for template binding
  get searchTerm(): string {
    return this.outlineSearchTerm();
  }

  set searchTerm(value: string) {
    this.outlineSearchTerm.set(value);
  }

  get sortBy(): 'name' | 'type' | 'line' {
    return this.outlineSortBy();
  }

  set sortBy(value: 'name' | 'type' | 'line') {
    this.outlineSortBy.set(value);
  }

  get sortOrder(): 'asc' | 'desc' {
    return this.outlineSortOrder();
  }

  getIconForType(type: string): string {
    switch (type) {
      case 'library':
        return 'book';
      case 'define':
        return 'code';
      case 'function':
        return 'gear';
      case 'parameter':
        return 'sliders';
      case 'valueset':
        return 'collection';
      case 'codesystem':
        return 'database';
      default:
        return 'file-text';
    }
  }

  private normalizeNameForSorting(name: string): string {
    let normalized = name.trim();
    
    // Remove all double quotes and single quotes
    normalized = normalized.replace(/["']/g, '');
    
    // Remove "function " prefix
    if (normalized.startsWith('function ')) {
      normalized = normalized.substring(9); // "function " is 9 characters
    }
    
    // Remove "library " prefix
    if (normalized.startsWith('library ')) {
      normalized = normalized.substring(8); // "library " is 8 characters
    }
    
    return normalized;
  }
}
