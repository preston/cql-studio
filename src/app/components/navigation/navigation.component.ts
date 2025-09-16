// Author: Preston Lee

import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss'
})
export class NavigationComponent {
  protected readonly title = signal(
    (window as any)['CQL_TESTS_UI_NAME'] || 'CQL Test Results'
  );
  protected readonly showFileMenu = signal(false);

  constructor(private router: Router) {
    // Listen to route changes to update the signal
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        // Show file menu everywhere except on the open component (root path)
        this.showFileMenu.set(event.url !== '/' && event.url !== '');
      });
  }

  onOpenNew(): void {
    // Clear any stored data and navigate to home
    sessionStorage.removeItem('cqlTestResults');
    sessionStorage.removeItem('validationErrors');
    sessionStorage.removeItem('initialStatus');
    sessionStorage.removeItem('initialSearch');
    sessionStorage.removeItem('originalFilename');
    this.router.navigate(['/']);
  }

  onDownloadResults(): void {
    const storedData = sessionStorage.getItem('cqlTestResults');
    if (storedData) {
      try {
        // Parse and re-stringify to ensure valid JSON formatting
        const data = JSON.parse(storedData);
        const jsonString = JSON.stringify(data, null, 2);
        
        // Get the original filename or use default
        const originalFilename = sessionStorage.getItem('originalFilename') || 'cql-test-results.json';
        
        // Create a blob and download it
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = originalFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Error downloading results:', error);
      }
    }
  }
}
