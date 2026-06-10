// Author: Preston Lee

import { Component, OnInit, output, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Library, Bundle } from 'fhir/r4';
import { LibraryService } from '../../../services/library.service';
import { SettingsService } from '../../../services/settings.service';
import { isResourceType } from '../../../services/fhir-resource-type.lib';

@Component({
  selector: 'app-guidelines-browser',
  imports: [FormsModule, DatePipe],
  templateUrl: './guidelines-browser.component.html',

  styleUrl: './guidelines-browser.component.scss'
})
export class GuidelinesBrowserComponent implements OnInit {
  openLibrary = output<Library>();
  testLibrary = output<Library>();
  deleteLibrary = output<Library>();
  createNew = output<void>();

  protected readonly libraries = signal<Library[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly searchTerm = signal('');
  protected readonly currentPage = signal(1);
  protected readonly totalPages = signal(0);
  protected readonly totalLibraries = signal(0);
  protected readonly pageSize = signal(10);
  protected readonly sortBy = signal<'name' | 'version' | 'date'>('name');
  protected readonly sortOrder = signal<'asc' | 'desc'>('asc');

  private readonly libraryService = inject(LibraryService);
  protected readonly settingsService = inject(SettingsService);

  ngOnInit(): void {
    this.loadLibraries();
  }

  public loadLibraries(): void {
    this.isLoading.set(true);
    this.libraryService.getAll(
      this.currentPage(),
      this.pageSize(),
      this.sortBy(),
      this.sortOrder()
    ).subscribe({
      next: (bundle: Bundle) => {
        this.isLoading.set(false);
        const loadedLibraries = bundle.entry
          ? bundle.entry
              .map(entry => entry.resource)
              .filter((resource): resource is Library => isResourceType(resource, 'Library'))
          : [];
        this.libraries.set(loadedLibraries);

        if (bundle.total && bundle.total > 0) {
          this.totalLibraries.set(bundle.total);
          this.totalPages.set(Math.ceil(bundle.total / this.pageSize()));
        } else {
          const hasNextPage = bundle.link?.some(link => link.relation === 'next');
          if (hasNextPage) {
            this.totalLibraries.set((this.currentPage() * this.pageSize()) + 1);
            this.totalPages.set(this.currentPage() + 1);
          } else {
            this.totalLibraries.set((this.currentPage() - 1) * this.pageSize() + loadedLibraries.length);
            this.totalPages.set(this.currentPage());
          }
        }
      },
      error: (error: any) => {
        this.isLoading.set(false);
        console.error('Error loading libraries:', error);
        this.libraries.set([]);
        this.totalPages.set(0);
        this.totalLibraries.set(0);
      }
    });
  }

  onSearch(): void {
    if (this.searchTerm().trim()) {
      this.isLoading.set(true);
      this.libraryService.search(this.searchTerm()).subscribe({
        next: (bundle: Bundle) => {
          this.isLoading.set(false);
          this.libraries.set(
            bundle.entry
              ? bundle.entry
                  .map(entry => entry.resource)
                  .filter((resource): resource is Library => isResourceType(resource, 'Library'))
              : []
          );
          this.totalLibraries.set(this.libraries().length);
          this.totalPages.set(1);
          this.currentPage.set(1);
        },
        error: (error: any) => {
          this.isLoading.set(false);
          console.error('Error searching libraries:', error);
          this.libraries.set([]);
        }
      });
    } else {
      this.loadLibraries();
    }
  }

  onClearSearch(): void {
    this.searchTerm.set('');
    this.currentPage.set(1);
    this.loadLibraries();
  }

  onOpenLibrary(library: Library): void {
    this.openLibrary.emit(library);
  }

  onTestLibrary(library: Library): void {
    this.testLibrary.emit(library);
  }

  onCreateNew(): void {
    this.createNew.emit();
  }

  onDeleteLibrary(library: Library): void {
    const libraryName = library.name || library.id || 'this library';
    if (confirm(`Are you sure you want to delete "${libraryName}"? This action cannot be undone.`)) {
      this.deleteLibrary.emit(library);
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.loadLibraries();
    }
  }

  onSort(column: 'name' | 'version' | 'date'): void {
    if (this.sortBy() === column) {
      this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortBy.set(column);
      this.sortOrder.set('asc');
    }
    this.currentPage.set(1);
    this.loadLibraries();
  }

  protected readonly Math = Math;
}
