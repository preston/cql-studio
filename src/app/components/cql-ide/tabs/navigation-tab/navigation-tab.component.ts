// Author: Preston Lee

import { Component, OnInit, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Library, Patient, Bundle } from 'fhir/r4';
import { LibraryService } from '../../../../services/library.service';
import { PatientService } from '../../../../services/patient.service';
import { IdeStateService, TabDataScope } from '../../../../services/ide-state.service';
import { CqlIdeLibraryOpenerService } from '../../../../services/cql-ide-library-opener.service';
import { SettingsService } from '../../../../services/settings.service';
import { isResourceType } from '../../../../services/fhir-resource-type.lib';

@Component({
  selector: 'app-navigation-tab',
  imports: [FormsModule],
  templateUrl: './navigation-tab.component.html',

  styleUrls: ['./navigation-tab.component.scss']
})
export class NavigationTabComponent implements OnInit {
  private readonly libraryService = inject(LibraryService);
  protected readonly patientService = inject(PatientService);
  private readonly ideStateService = inject(IdeStateService);
  private readonly libraryOpenerService = inject(CqlIdeLibraryOpenerService);
  private readonly settingsService = inject(SettingsService);

  protected readonly paginatedLibraries = signal<Library[]>([]);
  protected readonly currentPage = signal(1);
  protected readonly totalPages = signal(0);
  protected readonly totalLibraries = signal(0);
  protected readonly pageSize = signal(5);
  protected readonly librarySortBy = signal<'name' | 'version' | 'date'>('name');
  protected readonly librarySortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly isLoadingLibraries = signal(false);
  protected readonly libraryListSearchTerm = signal('');

  protected readonly patientSearchTerm = signal('');
  protected readonly patientSearchResults = signal<Patient[]>([]);
  protected readonly isSearchingPatients = signal(false);
  protected readonly showPatientSearchResults = signal(false);

  public Math = Math;

  private lastSeenLibraryListInvalidation = 0;

  constructor() {
    effect(() => {
      const inv = this.ideStateService.tabDataInvalidation();
      const count = inv[TabDataScope.LibraryList] ?? 0;
      if (count > this.lastSeenLibraryListInvalidation) {
        this.lastSeenLibraryListInvalidation = count;
        this.loadLibraries();
      }
    });
  }

  ngOnInit(): void {
    this.loadPaginatedLibraries();
  }

  createNewLibraryResource(): void {
    const newId = `new-library-${Date.now()}`;
    const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    const canonicalUrl = `${effectiveFhirBaseUrl}/Library/${newId}`;
    
    const libraryResource = {
      id: newId,
      name: 'NewLibrary',
      title: 'New Library',
      version: '1.0.0',
      description: 'New library',
      url: canonicalUrl,
      cqlContent: '',
      originalContent: '',
      isActive: false,
      isDirty: false,
      library: null
    };
    
    this.ideStateService.addLibraryResource(libraryResource);
    this.ideStateService.selectLibraryResource(newId);
  }

  loadPaginatedLibraries(): void {
    this.isLoadingLibraries.set(true);
    this.libraryService.getAll(
      this.currentPage(),
      this.pageSize(),
      this.librarySortBy(),
      this.librarySortOrder()
    ).subscribe({
      next: (bundle: Bundle) => {
        this.isLoadingLibraries.set(false);
        const libraries = bundle.entry
          ? bundle.entry
              .map(entry => entry.resource)
              .filter((resource): resource is Library => isResourceType(resource, 'Library'))
          : [];
        this.paginatedLibraries.set(libraries);
        
        const hasNextPage = bundle.link?.some(link => link.relation === 'next');
        
        if (bundle.total && bundle.total > 0) {
          this.totalLibraries.set(bundle.total);
          this.totalPages.set(Math.ceil(bundle.total / this.pageSize()));
        } else if (hasNextPage) {
          this.totalLibraries.set(this.currentPage() * this.pageSize() + 1);
          this.totalPages.set(this.currentPage() + 1);
        } else {
          this.totalLibraries.set((this.currentPage() - 1) * this.pageSize() + libraries.length);
          this.totalPages.set(this.currentPage());
        }
      },
      error: (error: any) => {
        this.isLoadingLibraries.set(false);
        console.error('Error loading paginated libraries:', error);
        const errorMessage = error?.message || error?.error?.message || 'Unable to connect to server';
        this.ideStateService.addErrorOutput(
          'Library List Error',
          `Failed to load libraries from server: ${errorMessage}`
        );
        this.paginatedLibraries.set([]);
        this.totalPages.set(0);
        this.totalLibraries.set(0);
      }
    });
  }

  loadLibraries(): void {
    if (this.libraryListSearchTerm().trim()) {
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages() && page !== this.currentPage()) {
      this.currentPage.set(page);
      this.loadLibraries();
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.goToPage(this.currentPage() + 1);
    }
  }

  previousPage(): void {
    if (this.currentPage() > 1) {
      this.goToPage(this.currentPage() - 1);
    }
  }

  changePageSize(newPageSize: number): void {
    this.pageSize.set(newPageSize);
    this.currentPage.set(1);
    this.loadLibraries();
  }

  changeSorting(sortBy: 'name' | 'version' | 'date'): void {
    if (this.librarySortBy() === sortBy) {
      this.librarySortOrder.set(this.librarySortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.librarySortBy.set(sortBy);
      this.librarySortOrder.set('asc');
    }
    this.currentPage.set(1);
    this.loadLibraries();
  }

  addLibraryFromPaginatedList(library: Library): void {
    if (library.id) {
      void this.libraryOpenerService.openLibraryFromServer(library);
    }
  }

  onLibraryListSearch(): void {
    if (this.libraryListSearchTerm().trim()) {
      this.currentPage.set(1);
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  loadSearchedLibraries(): void {
    this.isLoadingLibraries.set(true);
    this.libraryService.searchPaginated(
      this.libraryListSearchTerm(),
      this.currentPage(),
      this.pageSize(),
      this.librarySortBy(),
      this.librarySortOrder()
    ).subscribe({
      next: (bundle: Bundle) => {
        this.isLoadingLibraries.set(false);
        const libraries = bundle.entry
          ? bundle.entry
              .map(entry => entry.resource)
              .filter((resource): resource is Library => isResourceType(resource, 'Library'))
          : [];
        this.paginatedLibraries.set(libraries);
        
        const hasNextPage = bundle.link?.some(link => link.relation === 'next');
        
        if (bundle.total && bundle.total > 0) {
          this.totalLibraries.set(bundle.total);
          this.totalPages.set(Math.ceil(bundle.total / this.pageSize()));
        } else if (hasNextPage) {
          this.totalLibraries.set(this.currentPage() * this.pageSize() + 1);
          this.totalPages.set(this.currentPage() + 1);
        } else {
          this.totalLibraries.set((this.currentPage() - 1) * this.pageSize() + libraries.length);
          this.totalPages.set(this.currentPage());
        }
      },
      error: (error: any) => {
        this.isLoadingLibraries.set(false);
        console.error('Error searching libraries:', error);
        this.paginatedLibraries.set([]);
        this.totalPages.set(0);
        this.totalLibraries.set(0);
      }
    });
  }

  getLibraryDisplayName(library: Library): string {
    return library.name || library.id || 'Unknown';
  }

  getLibraryVersion(library: Library): string {
    return library.version || 'N/A';
  }

  getLibraryDescription(library: Library): string {
    return library.description || 'No description available';
  }

  getPageNumbers(): (number | string)[] {
    const pages: (number | string)[] = [];
    const maxVisiblePages = 5;
    const total = this.totalPages();
    const current = this.currentPage();
    
    if (total <= maxVisiblePages) {
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      
      if (current > 3) {
        pages.push('...');
      }
      
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);
      
      for (let i = start; i <= end; i++) {
        if (i !== 1 && i !== total) {
          pages.push(i);
        }
      }
      
      if (current < total - 2) {
        pages.push('...');
      }
      
      if (total > 1) {
        pages.push(total);
      }
    }
    
    return pages;
  }

  onPageClick(page: number | string): void {
    if (typeof page === 'number') {
      this.goToPage(page);
    }
  }

  onPatientSearchInput(event: Event): void {
    const searchTerm = (event.target as HTMLInputElement).value;
    this.patientSearchTerm.set(searchTerm);
    
    if (searchTerm.trim()) {
      this.isSearchingPatients.set(true);
      this.patientService.search(searchTerm).subscribe({
        next: (bundle: Bundle) => {
          this.isSearchingPatients.set(false);
          if (bundle.entry && bundle.entry.length > 0) {
            this.patientSearchResults.set(
              bundle.entry
                .map(entry => entry.resource)
                .filter((resource): resource is Patient => isResourceType(resource, 'Patient'))
            );
            this.showPatientSearchResults.set(true);
          } else {
            this.patientSearchResults.set([]);
            this.showPatientSearchResults.set(true);
          }
        },
        error: (error: any) => {
          this.isSearchingPatients.set(false);
          console.error('Error searching patients:', error);
        }
      });
    } else {
      this.isSearchingPatients.set(false);
      this.showPatientSearchResults.set(false);
      this.patientSearchResults.set([]);
    }
  }

  selectPatient(patient: Patient): void {
    if (patient.id) {
      this.patientService.addPatient(patient);
      this.showPatientSearchResults.set(false);
      this.patientSearchTerm.set('');
      this.patientSearchResults.set([]);
    }
  }

  clearPatientSearch(): void {
    this.patientSearchTerm.set('');
    this.patientSearchResults.set([]);
    this.showPatientSearchResults.set(false);
    this.isSearchingPatients.set(false);
  }

  clearPatientSelection(): void {
    this.patientService.clearSelection();
    this.clearPatientSearch();
  }

  removePatient(patientId: string): void {
    this.patientService.removePatient(patientId);
  }

  getPatientDisplayName(patient: Patient): string {
    if (patient.name && patient.name.length > 0) {
      const name = patient.name[0];
      const given = name.given ? name.given.join(' ') : '';
      const family = name.family || '';
      const result = `${given} ${family}`.trim();
      if (result) {
        return result;
      }
    }
    
    if (patient.text && patient.text.div) {
      const textMatch = patient.text.div.match(/<div[^>]*>([^<]+)<\/div>/);
      if (textMatch && textMatch[1]) {
        return textMatch[1].trim();
      }
    }
    
    if (patient.identifier && patient.identifier.length > 0) {
      const identifier = patient.identifier[0];
      if (identifier.value) {
        return identifier.value;
      }
    }
    
    return patient.id || 'Unknown';
  }

  trackByLibraryId(index: number, library: Library): string {
    return library.id || index.toString();
  }

  trackByPatientId(index: number, patient: Patient): string {
    return patient.id || index.toString();
  }
}
