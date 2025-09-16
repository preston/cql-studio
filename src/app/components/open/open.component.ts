// Author: Preston Lee

import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FileLoaderService } from '../../services/file-loader.service';
import { SchemaValidationService } from '../../services/schema-validation.service';
import { SettingsService } from '../../services/settings.service';
import { CqlTestResults } from '../../models/cql-test-results.model';

@Component({
  selector: 'app-open',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './open.component.html',
  styleUrl: './open.component.scss'
})
export class OpenComponent {
  urlInput = signal('');
  isLoading = signal(false);
  errorMessage = signal('');
  validationErrors = signal<string[]>([]);
  selectedFile = signal<File | null>(null);
  lastLoadedData = signal<CqlTestResults | null>(null);

  constructor(
    private fileLoader: FileLoaderService,
    private schemaValidation: SchemaValidationService,
    public settingsService: SettingsService,
    private router: Router
  ) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (file) {
      this.loadFile(file);
    }
  }

  onUrlSubmit(): void {
    const url = this.urlInput().trim();
    if (url) {
      this.loadFromUrl(url);
    }
  }

  onValidateSchemaChange(): void {
    this.settingsService.saveSettings();
  }

  clearSelectedFile(): void {
    this.selectedFile.set(null);
    this.lastLoadedData.set(null);
    this.errorMessage.set('');
    this.validationErrors.set([]);
    // Clear the file input
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  async rerunValidation(): Promise<void> {
    const file = this.selectedFile();
    if (file) {
      await this.loadFile(file);
    }
  }

  private async loadFile(file: File): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.validationErrors.set([]);
    this.selectedFile.set(file);

    try {
      const data = await this.fileLoader.loadFromFile(file);
      this.lastLoadedData.set(data);
      // Store the original filename
      sessionStorage.setItem('originalFilename', file.name);
      await this.validateAndNavigate(data);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadFromUrl(url: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.validationErrors.set([]);

    try {
      const data = await this.fileLoader.loadFromUrl(url);
      // Extract filename from URL
      const filename = this.extractFilenameFromUrl(url);
      sessionStorage.setItem('originalFilename', filename);
      await this.validateAndNavigate(data);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'results.json';
      return filename;
    } catch (error) {
      // If URL parsing fails, try to extract filename from the end of the string
      const filename = url.split('/').pop() || 'results.json';
      return filename.includes('.') ? filename : 'results.json';
    }
  }

  private async validateAndNavigate(data: CqlTestResults): Promise<void> {
    // Check if schema validation is enabled
    if (this.settingsService.settings().validateSchema) {
      const validation = await this.schemaValidation.validateResults(data);
      
      if (validation.isValid) {
        // Store data in sessionStorage for the results viewer
        sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
        this.router.navigate(['/results']);
      } else {
        this.validationErrors.set(validation.errors);
      }
    } else {
      // Skip validation, just store and navigate
      sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
      this.router.navigate(['/results']);
    }
  }
}
