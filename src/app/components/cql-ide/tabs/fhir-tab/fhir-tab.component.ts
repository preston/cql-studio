// Author: Preston Lee

import { Component, Input, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Library, Patient } from 'fhir/r4';
import { LibraryService } from '../../../../services/library.service';
import { PatientService } from '../../../../services/patient.service';
import { IdeStateService } from '../../../../services/ide-state.service';
import { SettingsService } from '../../../../services/settings.service';

@Component({
  selector: 'app-fhir-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fhir-tab.component.html',
  styleUrls: ['./fhir-tab.component.scss']
})
export class FhirTabComponent {
  @Input() libraryId: string = '';
  @Input() libraryVersion: string = '0.0.0';
  @Input() libraryDescription: string = '';
  @Input() isNewLibrary: boolean = false;
  
  @Output() libraryIdChange = new EventEmitter<string>();
  @Output() libraryVersionChange = new EventEmitter<string>();
  @Output() libraryDescriptionChange = new EventEmitter<string>();
  @Output() saveLibrary = new EventEmitter<void>();
  @Output() deleteLibrary = new EventEmitter<void>();

  constructor(
    public libraryService: LibraryService,
    public patientService: PatientService,
    public ideStateService: IdeStateService,
    public settingsService: SettingsService,
    public router: Router
  ) {}

  public hasSelectedLibrary = computed(() => this.libraryId && this.libraryId.trim() !== '');
  public hasSelectedPatients = computed(() => this.patientService.selectedPatients.length > 0);
  public selectedPatients = computed(() => this.patientService.selectedPatients);
  public fhirServerUrl = computed(() => this.settingsService.getEffectiveFhirBaseUrl());

  onLibraryIdChange(value: string): void {
    this.libraryIdChange.emit(value);
  }

  onLibraryVersionChange(value: string): void {
    this.libraryVersionChange.emit(value);
  }

  onLibraryDescriptionChange(value: string): void {
    this.libraryDescriptionChange.emit(value);
  }

  onSaveLibrary(): void {
    this.saveLibrary.emit();
  }

  onDeleteLibrary(): void {
    this.deleteLibrary.emit();
  }

  onNavigateToSettings(): void {
    this.router.navigate(['/settings']);
  }

  libraryAsString(): string {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    if (!activeLibrary) return '';

    const libraryCopy = { ...activeLibrary.library };
    if (libraryCopy) {
      libraryCopy.id = this.libraryId || '';
      libraryCopy.name = this.libraryId || '';
      libraryCopy.title = this.libraryId || '';
      libraryCopy.version = this.libraryVersion || '';
      libraryCopy.description = this.libraryDescription || '';
      libraryCopy.url = this.libraryService.urlFor(this.libraryId || '');
      
      if (activeLibrary.cqlContent && activeLibrary.cqlContent.trim()) {
        libraryCopy.content = [{
          contentType: 'text/cql',
          data: btoa(activeLibrary.cqlContent)
        }];
      } else {
        libraryCopy.content = [];
      }
      
      return JSON.stringify(libraryCopy, null, 2);
    }
    return '';
  }

  patientAsString(patient?: Patient): string {
    const targetPatient = patient || this.patientService.selectedPatient;
    if (targetPatient) {
      return JSON.stringify(targetPatient, null, 2);
    }
    return '';
  }

  getPatientDisplayName(patient: Patient): string {
    // Try multiple approaches to get patient name
    if (patient.name && patient.name.length > 0) {
      const name = patient.name[0];
      const given = name.given ? name.given.join(' ') : '';
      const family = name.family || '';
      const result = `${given} ${family}`.trim();
      if (result) {
        return result;
      }
    }
    
    // Try alternative name fields
    if (patient.text && patient.text.div) {
      // Extract name from text field if available
      const textMatch = patient.text.div.match(/<div[^>]*>([^<]+)<\/div>/);
      if (textMatch && textMatch[1]) {
        return textMatch[1].trim();
      }
    }
    
    // Try identifier fields
    if (patient.identifier && patient.identifier.length > 0) {
      const identifier = patient.identifier[0];
      if (identifier.value) {
        return identifier.value;
      }
    }
    
    // Fall back to ID
    return patient.id || 'Unknown';
  }

  trackByPatientId(index: number, patient: Patient): string {
    return patient.id || index.toString();
  }
}
