// Author: Preston Lee

import { Component, signal, OnInit } from '@angular/core';
import { RouterOutlet, Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FileLoaderService } from './services/file-loader.service';
import { SchemaValidationService } from './services/schema-validation.service';
import { NavigationComponent } from './components/navigation/navigation.component';
import { FooterComponent } from './components/footer/footer.component';
import { SettingsService } from './services/settings.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule, FormsModule, NavigationComponent, FooterComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('CQL Test Results Viewer');

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private fileLoader: FileLoaderService,
    private schemaValidation: SchemaValidationService,
    protected settingsService: SettingsService
  ) {}

  ngOnInit(): void {
    // Check for URL query parameters
    this.route.queryParams.subscribe(params => {
      if (params['url']) {
        this.loadFromUrl(
          params['url'], 
          params['status'], 
          params['search'],
          params['groupBy'],
          params['sortBy'],
          params['sortOrder']
        );
      }
    });
  }

  private async loadFromUrl(
    url: string, 
    status?: string, 
    search?: string, 
    groupBy?: string, 
    sortBy?: string, 
    sortOrder?: string
  ): Promise<void> {
    try {
      const data = await this.fileLoader.loadFromUrl(url);
      
      // Check if schema validation is enabled
      if (this.settingsService.settings().validateSchema) {
        const validation = await this.schemaValidation.validateResults(data);
        
        if (validation.isValid) {
          sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
          // Store filter parameters if provided
          this.storeInitialParameters(status, search, groupBy, sortBy, sortOrder);
          this.router.navigate(['/results']);
        } else {
          console.error('Validation errors:', validation.errors);
          // Still navigate to results but show validation errors
          sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
          sessionStorage.setItem('validationErrors', JSON.stringify(validation.errors));
          // Store filter parameters even with validation errors
          this.storeInitialParameters(status, search, groupBy, sortBy, sortOrder);
          this.router.navigate(['/results']);
        }
      } else {
        // Skip validation, just store and navigate
        sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
        // Store filter parameters if provided
        this.storeInitialParameters(status, search, groupBy, sortBy, sortOrder);
        this.router.navigate(['/results']);
      }
    } catch (error) {
      console.error('Error loading from URL:', error);
    }
  }

  private storeInitialParameters(
    status?: string, 
    search?: string, 
    groupBy?: string, 
    sortBy?: string, 
    sortOrder?: string
  ): void {
    if (status) {
      sessionStorage.setItem('initialStatus', status);
    }
    if (search) {
      sessionStorage.setItem('initialSearch', search);
    }
    if (groupBy) {
      sessionStorage.setItem('initialGroupBy', groupBy);
    }
    if (sortBy) {
      sessionStorage.setItem('initialSortBy', sortBy);
    }
    if (sortOrder) {
      sessionStorage.setItem('initialSortOrder', sortOrder);
    }
  }
}
