// Author: Preston Lee

import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
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
export class OpenComponent implements OnInit {
  urlInput = signal('');
  isLoading = signal(false);
  errorMessage = signal('');
  validationErrors = signal<string[]>([]);
  selectedFile = signal<File | null>(null);
  lastLoadedData = signal<CqlTestResults | null>(null);
  
  // Index file related signals
  indexUrl = signal('');
  indexFiles = signal<string[]>([]);
  indexLoading = signal(false);
  indexError = signal('');

  constructor(
    private fileLoader: FileLoaderService,
    private schemaValidation: SchemaValidationService,
    public settingsService: SettingsService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Check for index query parameter
    const indexParam = this.route.snapshot.queryParams['index'];
    if (indexParam) {
      this.loadIndexFile(indexParam);
    }
  }

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

  onLoadExample(): void {
    this.loadExampleFile();
  }

  onLoadIndexFile(): void {
    const url = this.indexUrl().trim();
    if (url) {
      this.loadIndexFile(url);
    }
  }

  onLoadFileFromIndex(filename: string): void {
    const baseUrl = this.getBaseUrlFromIndexUrl();
    const fileUrl = `${baseUrl}/${filename}`;
    
    // Store the index URL for the "Back to Index" functionality
    sessionStorage.setItem('indexUrl', this.indexUrl());
    
    // Load the file and update URL with the specific file URL
    this.loadFromUrlWithIndex(fileUrl);
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
      await this.validateAndNavigateWithUrl(data, url);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadFromUrlWithIndex(url: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.validationErrors.set([]);

    try {
      const data = await this.fileLoader.loadFromUrl(url);
      // Extract filename from URL
      const filename = this.extractFilenameFromUrl(url);
      sessionStorage.setItem('originalFilename', filename);
      await this.validateAndNavigateWithUrl(data, url);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadExampleFile(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.validationErrors.set([]);

    try {
      const data = await this.fileLoader.loadFromExample();
      sessionStorage.setItem('originalFilename', 'results.json');
      // Use the example file URL for deep linking support
      const exampleUrl = '/examples/results.json';
      await this.validateAndNavigateWithUrl(data, exampleUrl);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadIndexFile(url: string): Promise<void> {
    this.indexLoading.set(true);
    this.indexError.set('');
    this.indexUrl.set(url);

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to load index file: ${response.statusText}`);
      }
      
      const indexData = await response.json();
      
      if (!indexData.files || !Array.isArray(indexData.files)) {
        throw new Error('Invalid index file format. Expected object with "files" array.');
      }
      
      this.indexFiles.set(indexData.files);
    } catch (error) {
      this.indexError.set((error as Error).message);
      this.indexFiles.set([]);
    } finally {
      this.indexLoading.set(false);
    }
  }

  private getBaseUrlFromIndexUrl(): string {
    const indexUrl = this.indexUrl();
    try {
      const urlObj = new URL(indexUrl);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/'))}`;
    } catch (error) {
      // If URL parsing fails, try to extract base URL from the string
      const lastSlashIndex = indexUrl.lastIndexOf('/');
      return lastSlashIndex > 0 ? indexUrl.substring(0, lastSlashIndex) : indexUrl;
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
    // Clear indexUrl since this file is not loaded from an index
    sessionStorage.removeItem('indexUrl');
    
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

  private async validateAndNavigateWithUrl(data: CqlTestResults, fileUrl: string): Promise<void> {
    // Check if schema validation is enabled
    if (this.settingsService.settings().validateSchema) {
      const validation = await this.schemaValidation.validateResults(data);
      
      if (validation.isValid) {
        // Store data in sessionStorage for the results viewer
        sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
        // Navigate with the file URL as a query parameter
        this.router.navigate(['/results'], { queryParams: { url: fileUrl } });
      } else {
        this.validationErrors.set(validation.errors);
      }
    } else {
      // Skip validation, just store and navigate
      sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
      // Navigate with the file URL as a query parameter
      this.router.navigate(['/results'], { queryParams: { url: fileUrl } });
    }
  }
}
