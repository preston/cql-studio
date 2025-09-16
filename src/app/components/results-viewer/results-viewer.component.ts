// Author: Preston Lee

import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CqlTestResults, TestResult } from '../../models/cql-test-results.model';

@Component({
  selector: 'app-results-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './results-viewer.component.html',
  styleUrl: './results-viewer.component.scss'
})
export class ResultsViewerComponent implements OnInit {
  testResults = signal<CqlTestResults | null>(null);
  filteredResults = signal<TestResult[]>([]);
  selectedStatus = signal<string>('all');
  searchTerm = signal<string>('');
  expandedResults = signal<Set<string>>(new Set());
  showAllDetails = signal<boolean>(false);

  constructor(private router: Router) {}

  ngOnInit(): void {
    const storedData = sessionStorage.getItem('cqlTestResults');
    if (storedData) {
      try {
        const data = JSON.parse(storedData) as CqlTestResults;
        this.testResults.set(data);
        
        // Check for initial filter values from query parameters
        const initialStatus = sessionStorage.getItem('initialStatus');
        const initialSearch = sessionStorage.getItem('initialSearch');
        
        if (initialStatus) {
          this.selectedStatus.set(initialStatus);
          sessionStorage.removeItem('initialStatus'); // Clean up after use
        }
        
        if (initialSearch) {
          this.searchTerm.set(initialSearch);
          sessionStorage.removeItem('initialSearch'); // Clean up after use
        }
        
        // Apply filters with initial values
        this.applyFilters();
      } catch (error) {
        console.error('Error parsing stored data:', error);
        this.router.navigate(['/']);
      }
    } else {
      this.router.navigate(['/']);
    }
  }

  getValidationErrors(): string[] {
    const storedErrors = sessionStorage.getItem('validationErrors');
    if (storedErrors) {
      try {
        return JSON.parse(storedErrors);
      } catch (error) {
        console.error('Error parsing validation errors:', error);
        return [];
      }
    }
    return [];
  }

  onStatusFilterChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.selectedStatus.set(target.value);
    this.applyFilters();
  }

  onSearchChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm.set(target.value);
    this.applyFilters();
  }

  private applyFilters(): void {
    const results = this.testResults()?.results || [];
    let filtered = results;

    // Filter by status
    if (this.selectedStatus() !== 'all') {
      filtered = filtered.filter(result => result.testStatus === this.selectedStatus());
    }

    // Filter by search term
    const searchTerm = this.searchTerm().toLowerCase();
    if (searchTerm) {
      filtered = filtered.filter(result => 
        result.testName.toLowerCase().includes(searchTerm) ||
        result.groupName.toLowerCase().includes(searchTerm) ||
        result.testsName.toLowerCase().includes(searchTerm) ||
        result.expression.toLowerCase().includes(searchTerm)
      );
    }

    this.filteredResults.set(filtered);
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'pass': return 'text-success';
      case 'fail': return 'text-danger';
      case 'skip': return 'text-warning';
      case 'error': return 'text-danger';
      default: return 'text-muted';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'pass': return '✓';
      case 'fail': return '✗';
      case 'skip': return '⊘';
      case 'error': return '⚠';
      default: return '?';
    }
  }

  getTotalTests(): number {
    const summary = this.testResults()?.testResultsSummary;
    if (!summary) return 0;
    return summary.passCount + summary.failCount + summary.skipCount + summary.errorCount;
  }

  getPassRate(): number {
    const summary = this.testResults()?.testResultsSummary;
    if (!summary) return 0;
    const total = this.getTotalTests();
    return total > 0 ? (summary.passCount / total) * 100 : 0;
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  hasDetailedInfo(): boolean {
    return this.filteredResults().some(r => r.error || r.actual || r.expected);
  }

  toggleResultDetails(resultId: string): void {
    const expanded = new Set(this.expandedResults());
    if (expanded.has(resultId)) {
      expanded.delete(resultId);
    } else {
      expanded.add(resultId);
    }
    this.expandedResults.set(expanded);
  }

  isResultExpanded(resultId: string): boolean {
    return this.expandedResults().has(resultId) || this.showAllDetails();
  }

  toggleAllDetails(): void {
    this.showAllDetails.set(!this.showAllDetails());
  }

  getResultId(result: TestResult): string {
    return `${result.testName}-${result.groupName}-${result.expression}`;
  }

  hasResultDetails(result: TestResult): boolean {
    return !!(result.error || result.actual || result.expected);
  }
}
