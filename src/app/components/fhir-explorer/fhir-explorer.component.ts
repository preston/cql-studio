// Author: Preston Lee

import { Component, OnChanges, SimpleChanges } from '@angular/core';
import { Library, Bundle, Patient, Parameters } from 'fhir/r4';
import { LibraryService } from '../../services/library.service';
import { PatientService } from '../../services/patient.service';
import { SettingsService } from '../../services/settings.service';
import { TranslationService } from '../../services/translation.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

@Component({
  selector: 'app-fhir-explorer',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './fhir-explorer.component.html',
  styleUrl: './fhir-explorer.component.scss'
})
export class FhirExplorerComponent implements OnChanges {

  public library: Library | null = null;

  protected cql: string | null = null;
  public static DEFAULT_LIBRARY_NAME: string = '';
  public static DEFAULT_LIBRARY_VERSION = "0.0.0";
  public libraryVersion: string = FhirExplorerComponent.DEFAULT_LIBRARY_VERSION;
  public libraryDescription: string = "";

  // Search functionality
  public searchTerm: string = "";
  public searchResults: Library[] = [];
  public isSearching: boolean = false;
  public showSearchResults: boolean = false;
  private searchSubject = new Subject<string>();

  // Patient search functionality
  public patientSearchTerm: string = "";
  public patientSearchResults: Patient[] = [];
  public isSearchingPatients: boolean = false;
  public showPatientSearchResults: boolean = false;
  private patientSearchSubject = new Subject<string>();

  // Library state tracking
  public isNewLibrary: boolean = false;
  public hasSelectedLibrary: boolean = false;

  // Patient state tracking
  public hasSelectedPatient: boolean = false;

  // Evaluation results
  public evaluationResults: Parameters | null = null;
  public isEvaluating: boolean = false;

  // ELM Translation functionality
  public elmTranslationResults: string | null = null;
  public isTranslating: boolean = false;

  constructor(
    protected libraryService: LibraryService,
    protected patientService: PatientService,
    protected settingsService: SettingsService,
    protected translationService: TranslationService,
    protected router: Router) {

    // Set up live search with debouncing
    this.searchSubject.pipe(
      debounceTime(100), // Wait 100ms after user stops typing
      distinctUntilChanged(), // Only emit if the value has changed
      switchMap(searchTerm => {
        if (searchTerm.trim()) {
          this.isSearching = true;
          return this.libraryService.search(searchTerm);
        } else {
          this.isSearching = false;
          this.showSearchResults = false;
          this.searchResults = [];
          return [];
        }
      })
    ).subscribe({
      next: (bundle: Bundle<Library>) => {
        this.isSearching = false;
        if (bundle.entry && bundle.entry.length > 0) {
          this.searchResults = bundle.entry.map(entry => entry.resource!);
          this.showSearchResults = true;
        } else if (this.searchTerm.trim()) {
          this.searchResults = [];
          this.showSearchResults = true;
        }
      },
      error: (error: any) => {
        this.isSearching = false;
        console.error('Error searching libraries:', error);
      }
    });

    // Set up patient search with debouncing
    this.patientSearchSubject.pipe(
      debounceTime(100), // Wait 100ms after user stops typing
      distinctUntilChanged(), // Only emit if the value has changed
      switchMap(searchTerm => {
        if (searchTerm.trim()) {
          this.isSearchingPatients = true;
          return this.patientService.search(searchTerm);
        } else {
          this.isSearchingPatients = false;
          this.showPatientSearchResults = false;
          this.patientSearchResults = [];
          return [];
        }
      })
    ).subscribe({
      next: (bundle: Bundle<Patient>) => {
        this.isSearchingPatients = false;
        if (bundle.entry && bundle.entry.length > 0) {
          this.patientSearchResults = bundle.entry.map(entry => entry.resource!);
          this.showPatientSearchResults = true;
        } else if (this.patientSearchTerm.trim()) {
          this.patientSearchResults = [];
          this.showPatientSearchResults = true;
        }
      },
      error: (error: any) => {
        this.isSearchingPatients = false;
        console.error('Error searching patients:', error);
      }
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    // Component changes detected
  }

  libraryAsString(): string {
    let s = '';
    if (this.library) {
      // Create a copy of the library object with current form values
      const libraryCopy = { ...this.library };
      libraryCopy.id = this.libraryService.libraryId || '';
      libraryCopy.name = this.libraryService.libraryId || '';
      libraryCopy.title = this.libraryService.libraryId || '';
      libraryCopy.version = this.libraryVersion || '';
      libraryCopy.description = this.libraryDescription || '';
      libraryCopy.url = this.libraryService.urlFor(this.libraryService.libraryId || '');
      
      // Update content if CQL is present
      if (this.cql && this.cql.trim()) {
        libraryCopy.content = [{
          contentType: 'text/cql',
          data: btoa(this.cql)
        }];
      } else {
        libraryCopy.content = [];
      }
      
      s = JSON.stringify(libraryCopy, null, 2);
    }
    return s;
  }

  decodeLibaryData() {
    if (this.library?.name) {
      this.libraryService.libraryId = this.library.name;
    } else {
      this.libraryService.libraryId = FhirExplorerComponent.DEFAULT_LIBRARY_NAME;
    }
    if (this.library?.version) {
      this.libraryVersion = this.library.version;
    } else {
      this.libraryVersion = FhirExplorerComponent.DEFAULT_LIBRARY_VERSION;
    }
    if (this.library?.description) {
      this.libraryDescription = this.library.description;
    } else {
      this.libraryDescription = `Logic Library for ${this.libraryService.libraryId}`;
    }
    if (this.library && this.library.content) {
      for (const content of this.library.content) {
        if (content.contentType === 'text/cql' && content.data) {
          try {
            this.cql = atob(content.data); // Decode base64 encoded CQL
          } catch (e) {
            console.error('Error decoding CQL:', e);
          }
        }
      }
    }
  }

  reloadLibraryFromServer() {
    this.libraryService.get(this.libraryService.libraryId).subscribe({
      next: (library: Library) => {
        this.library = library;
        this.decodeLibaryData();
        console.log('Library loaded:', library);
      }, error: (error: any) => {
        this.library = null;
        console.error('Error loading library:', error);
      }
    });
  }

  extractVersionFromCql(cql: string): string | null {
    const versionRegex = /library.*version\s+['"]([^'"]+)['"]/; // Match version in single or double quotes
    const match = cql.match(versionRegex);
    let version = null;
    if (match?.length && match.length >= 2) {
      version = match[1];
    }
    return version;
  }

  saveCql() {
    if (this.cql) {
      let bundle = this.buildFHIRBundle(
        this.libraryService.libraryId,
        this.libraryVersion,
        this.libraryDescription,
        this.cql);
      this.libraryService.put(bundle).subscribe({
        next: (response: any) => {
          console.log('Library saved successfully:', response);
          this.library = response; // Update the local library reference
          this.isNewLibrary = false; // After saving, it's no longer a new library
        }, error: (error: any) => {
          console.error('Error saving library:', error);
        }
      });
    }
  }

  deleteCql() {
    if (this.library) {
      this.libraryService.delete(this.library).subscribe({
        next: (response: any) => {
          console.log('Library deleted successfully:', response);
          this.library = null; // Clear the local library reference
          this.hasSelectedLibrary = false; // Reset selection state
          this.isNewLibrary = false; // Reset new library state
          this.decodeLibaryData(); // Reset the decoded data to defaults
        }, error: (error: any) => {
          console.error('Error deleting library:', error);
        }
      });
    } else {
      console.error('No library ID set. Please provide a valid library ID before deleting.');
    }
  }

  buildFHIRBundle(libraryName: string, version: string, description: string, cql: string) {
    let encoded = btoa(cql); // Ensure cql is base64 encoded
    const libraryResource: Library = {
      resourceType: 'Library',
      type: {},
      id: libraryName,
      version: version,
      name: libraryName,
      title: libraryName,
      status: 'active',
      description: description,
      url: this.libraryService.urlFor(libraryName),
      content: [
        {
          contentType: 'text/cql',
          data: encoded, // Use base64 encoded CQL
        },
      ],
    };
    return libraryResource;
  }

  // Search functionality methods
  onSearchInput(event: any) {
    const searchTerm = event.target.value;
    this.searchTerm = searchTerm;
    this.searchSubject.next(searchTerm);
  }

  selectLibrary(library: Library) {
    if (library.id) {
      this.libraryService.libraryId = library.id;
      this.showSearchResults = false;
      this.searchTerm = "";
      this.searchResults = [];
      
      // Set state for existing library
      this.isNewLibrary = false;
      this.hasSelectedLibrary = true;
      
      // Set the library object immediately for the FHIR Resource tab
      this.library = library;
      
      this.reloadLibraryFromServer();
    }
  }

  clearSearch() {
    this.searchTerm = "";
    this.searchResults = [];
    this.showSearchResults = false;
    this.isSearching = false;
    this.searchSubject.next(""); // Clear any pending searches
  }

  createNewLibrary() {
    // Reset to defaults for a new library
    this.libraryService.libraryId = "";
    this.libraryVersion = FhirExplorerComponent.DEFAULT_LIBRARY_VERSION;
    this.libraryDescription = "";
    this.cql = "";
    
    // Create a basic Library object for the FHIR Resource tab
    this.library = {
      resourceType: 'Library',
      type: {},
      id: '',
      version: this.libraryVersion,
      name: '',
      title: '',
      status: 'draft',
      description: this.libraryDescription,
      url: '',
      content: []
    };
    
    // Set state for new library
    this.isNewLibrary = true;
    this.hasSelectedLibrary = true;
    
    // Clear search state
    this.clearSearch();
    
  }

  clearSelection() {
    // Reset all state
    this.library = null;
    this.libraryService.libraryId = "";
    this.libraryVersion = FhirExplorerComponent.DEFAULT_LIBRARY_VERSION;
    this.libraryDescription = "";
    this.cql = "";
    this.isNewLibrary = false;
    this.hasSelectedLibrary = false;
    
    // Clear search state
    this.clearSearch();
    
  }

  /**
   * Check if all required form fields are filled
   */
  isFormValid(): boolean {
    return !!(
      this.libraryService.libraryId?.trim() &&
      this.libraryVersion?.trim() &&
      this.libraryDescription?.trim() &&
      this.cql?.trim()
    );
  }

  // Patient search functionality methods
  onPatientSearchInput(event: any) {
    const searchTerm = event.target.value;
    this.patientSearchTerm = searchTerm;
    this.patientSearchSubject.next(searchTerm);
  }

  selectPatient(patient: Patient) {
    if (patient.id) {
      this.patientService.selectedPatient = patient;
      this.showPatientSearchResults = false;
      this.patientSearchTerm = "";
      this.patientSearchResults = [];
      this.hasSelectedPatient = true;
    }
  }

  clearPatientSearch() {
    this.patientSearchTerm = "";
    this.patientSearchResults = [];
    this.showPatientSearchResults = false;
    this.isSearchingPatients = false;
    this.patientSearchSubject.next(""); // Clear any pending searches
  }

  clearPatientSelection() {
    this.patientService.clearSelection();
    this.hasSelectedPatient = false;
    this.clearPatientSearch();
    this.evaluationResults = null; // Clear evaluation results when patient is cleared
  }

  getPatientDisplayName(patient: Patient): string {
    if (patient.name && patient.name.length > 0) {
      const name = patient.name[0];
      const given = name.given ? name.given.join(' ') : '';
      const family = name.family || '';
      return `${given} ${family}`.trim() || patient.id || 'Unknown';
    }
    return patient.id || 'Unknown';
  }

  // Evaluation functionality
  canEvaluate(): boolean {
    return this.hasSelectedLibrary && this.hasSelectedPatient && !this.isNewLibrary;
  }

  // Check if we can show evaluation-related UI elements
  canShowEvaluationUI(): boolean {
    return this.hasSelectedLibrary && this.hasSelectedPatient;
  }

  evaluateLibrary() {
    if (!this.canEvaluate()) {
      console.error('Please select both a library and a patient before evaluating.');
      return;
    }

    if (!this.libraryService.libraryId || !this.patientService.selectedPatient?.id) {
      console.error('Missing library ID or patient ID for evaluation.');
      return;
    }

    this.isEvaluating = true;
    this.evaluationResults = null;

    // If ELM translation is enabled, translate CQL to ELM first
    if (this.enableElmTranslation && this.cql) {
      this.translateCqlToElm();
    }

    // Create parameters for evaluation with patient context
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: [
        {
          name: 'subject',
          valueString: `Patient/${this.patientService.selectedPatient.id}`
        }
      ]
    };

    this.libraryService.evaluate(
      this.libraryService.libraryId,
      parameters
    ).subscribe({
      next: (results: Parameters) => {
        this.isEvaluating = false;
        this.evaluationResults = results;
      },
      error: (error: any) => {
        this.isEvaluating = false;
        console.error('Error evaluating library:', error);
      }
    });
  }

  evaluationResultsAsString(): string {
    return this.evaluationResults ? JSON.stringify(this.evaluationResults, null, 2) : '';
  }

  // ELM Translation methods
  translateCqlToElm() {
    if (!this.cql || !this.cql.trim()) {
      console.error('No CQL content to translate.');
      return;
    }

    const translationBaseUrl = this.settingsService.settings().translationBaseUrl || this.settingsService.getDefaultTranslationBaseUrl();
    
    this.isTranslating = true;
    this.elmTranslationResults = null;

    this.translationService.translateCqlToElm(this.cql, translationBaseUrl).subscribe({
      next: (elmXml: string) => {
        this.isTranslating = false;
        this.elmTranslationResults = elmXml;
        console.log('CQL translated to ELM successfully');
      },
      error: (error: any) => {
        this.isTranslating = false;
        console.error('Error translating CQL to ELM:', error);
        // You might want to show an error message to the user here
      }
    });
  }

  elmTranslationResultsAsString(): string {
    return this.elmTranslationResults || '';
  }

  clearElmTranslation() {
    this.elmTranslationResults = null;
  }

  getCurrentFhirUrl(): string {
    return this.settingsService.settings().fhirBaseUrl || this.settingsService.getDefaultFhirBaseUrl();
  }

  get enableElmTranslation(): boolean {
    return this.settingsService.settings().enableElmTranslation;
  }

  navigateToSettings(): void {
    this.router.navigate(['/settings']);
  }
}
