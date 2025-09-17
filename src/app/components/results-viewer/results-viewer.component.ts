// Author: Preston Lee

import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CqlTestResults, TestResult } from '../../models/cql-test-results.model';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, registerables } from 'chart.js';
import { FileLoaderService } from '../../services/file-loader.service';
import { SchemaValidationService } from '../../services/schema-validation.service';
import { SettingsService } from '../../services/settings.service';

// Register Chart.js components
Chart.register(...registerables);

@Component({
  selector: 'app-results-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective],
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
  
  // Grouping and sorting controls
  groupBy = signal<string>('none');
  sortBy = signal<string>('name');
  sortOrder = signal<string>('asc');
  
  // Store the original URL parameter to preserve it
  private originalUrl: string | null = null;

  // Chart data properties
  pieChartData: any = {
    labels: ['Passed', 'Failed', 'Skipped', 'Errors'],
    datasets: [{
      data: [0, 0, 0, 0],
      backgroundColor: ['#28a745', '#dc3545', '#ffc107', '#6f42c1'],
      borderColor: ['#1e7e34', '#bd2130', '#e0a800', '#5a32a3'],
      borderWidth: 0
    }]
  };

  pieChartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          usePointStyle: true
        }
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: '#fff',
        borderWidth: 1,
        cornerRadius: 6,
        displayColors: true,
        padding: 12,
        callbacks: {
          title: function(context: any) {
            return 'Test Results Summary';
          },
          label: function(context: any) {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((context.parsed / total) * 100).toFixed(1);
            const statusIcon = context.label === 'Passed' ? '✓' : 
                             context.label === 'Failed' ? '✗' : 
                             context.label === 'Skipped' ? '⊘' : '⚠';
            return `${statusIcon} ${context.label}: ${context.parsed} tests (${percentage}%)`;
          },
          footer: function(context: any) {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            return `Total Tests: ${total}`;
          }
        }
      }
    }
  };

  barChartData: any = {
    labels: [],
    datasets: [
      {
        label: 'Passed',
        data: [],
        backgroundColor: '#28a745',
        borderColor: '#1e7e34',
        borderWidth: 1
      },
      {
        label: 'Failed',
        data: [],
        backgroundColor: '#dc3545',
        borderColor: '#bd2130',
        borderWidth: 1
      },
      {
        label: 'Skipped',
        data: [],
        backgroundColor: '#ffc107',
        borderColor: '#e0a800',
        borderWidth: 1
      },
      {
        label: 'Errors',
        data: [],
        backgroundColor: '#6f42c1',
        borderColor: '#5a32a3',
        borderWidth: 1
      }
    ]
  };

  barChartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: {
          stepSize: 1
        }
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          padding: 20,
          usePointStyle: true
        }
      },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: '#fff',
        borderWidth: 1,
        cornerRadius: 6,
        displayColors: true,
        padding: 12,
        callbacks: {
          title: function(context: any) {
            // Handle both array and single object cases
            const items = Array.isArray(context) ? context : [context];
            return `Group: ${items[0]?.label || 'Unknown'}`;
          },
          label: function(context: any) {
            // Handle both array and single object cases
            const items = Array.isArray(context) ? context : [context];
            const currentItem = items[0];
            
            if (!currentItem) return '';
            
            const groupTotal = items.map((item: any) => item.parsed.y).reduce((a: number, b: number) => a + b, 0);
            const percentage = groupTotal > 0 ? ((currentItem.parsed.y / groupTotal) * 100).toFixed(1) : '0.0';
            const statusIcon = currentItem.dataset.label === 'Passed' ? '✓' : 
                             currentItem.dataset.label === 'Failed' ? '✗' : 
                             currentItem.dataset.label === 'Skipped' ? '⊘' : '⚠';
            return `${statusIcon} ${currentItem.dataset.label}: ${currentItem.parsed.y} tests (${percentage}%)`;
          },
          footer: function(context: any) {
            // Handle both array and single object cases
            const items = Array.isArray(context) ? context : [context];
            const groupTotal = items.reduce((sum: number, item: any) => sum + item.parsed.y, 0);
            const passCount = items.find((item: any) => item.dataset.label === 'Passed')?.parsed.y || 0;
            const passRate = groupTotal > 0 ? ((passCount / groupTotal) * 100).toFixed(1) : '0.0';
            return [`Total Tests: ${groupTotal}`, `Pass Rate: ${passRate}%`];
          }
        }
      }
    }
  };

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private fileLoader: FileLoaderService,
    private schemaValidation: SchemaValidationService,
    private settingsService: SettingsService
  ) {}

  ngOnInit(): void {
    const storedData = sessionStorage.getItem('cqlTestResults');
    if (storedData) {
      try {
        const data = JSON.parse(storedData) as CqlTestResults;
        this.testResults.set(data);
        
        // Load initial parameters from URL or sessionStorage
        this.loadInitialParameters();
        
        // Apply filters with initial values
        this.applyFilters();
        this.updateChartData(); // Initial chart data load
        
        // Ensure URL parameter is set in the browser address bar after initialization
        this.updateUrlWithPreservedParams();
      } catch (error) {
        console.error('Error parsing stored data:', error);
        this.router.navigate(['/']);
      }
    } else {
      // Check if there's a URL parameter to load data from
      const params = this.route.snapshot.queryParams;
      if (params['url']) {
        this.loadFromUrl(params['url']);
      } else {
        this.router.navigate(['/']);
      }
    }
  }

  private loadInitialParameters(): void {
    // Get current query parameters
    const params = this.route.snapshot.queryParams;
    
    // Handle URL parameter (for files loaded from index)
    if (params['url']) {
      // Store the URL for potential future use
      sessionStorage.setItem('currentFileUrl', params['url']);
      // Store the URL in component property to preserve it
      this.originalUrl = params['url'];
    }
    
    // Priority: URL params > sessionStorage > defaults
    const initialStatus = params['status'] || sessionStorage.getItem('initialStatus');
    const initialSearch = params['search'] || sessionStorage.getItem('initialSearch');
    const initialGroupBy = params['groupBy'] || sessionStorage.getItem('initialGroupBy');
    const initialSortBy = params['sortBy'] || sessionStorage.getItem('initialSortBy');
    const initialSortOrder = params['sortOrder'] || sessionStorage.getItem('initialSortOrder');
    
    if (initialStatus) {
      this.selectedStatus.set(initialStatus);
      if (sessionStorage.getItem('initialStatus')) {
        sessionStorage.removeItem('initialStatus'); // Clean up after use
      }
    }
    
    if (initialSearch) {
      this.searchTerm.set(initialSearch);
      if (sessionStorage.getItem('initialSearch')) {
        sessionStorage.removeItem('initialSearch'); // Clean up after use
      }
    }
    
    if (initialGroupBy) {
      this.groupBy.set(initialGroupBy);
      if (sessionStorage.getItem('initialGroupBy')) {
        sessionStorage.removeItem('initialGroupBy'); // Clean up after use
      }
    }
    
    if (initialSortBy) {
      this.sortBy.set(initialSortBy);
      if (sessionStorage.getItem('initialSortBy')) {
        sessionStorage.removeItem('initialSortBy'); // Clean up after use
      }
    }
    
    if (initialSortOrder) {
      this.sortOrder.set(initialSortOrder);
      if (sessionStorage.getItem('initialSortOrder')) {
        sessionStorage.removeItem('initialSortOrder'); // Clean up after use
      }
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
    this.updateChartData(); // Only update charts for status filter changes
    this.updateUrlWithPreservedParams();
  }

  onSearchChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm.set(target.value);
    this.applyFilters();
    this.updateChartData(); // Only update charts for search changes
    this.updateUrlWithPreservedParams();
  }

  onGroupByChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.groupBy.set(target.value);
    this.applyFilters();
    this.updateUrlWithPreservedParams();
    // No chart update needed for grouping changes
  }

  onSortByChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.sortBy.set(target.value);
    this.applyFilters();
    this.updateUrlWithPreservedParams();
    // No chart update needed for sorting changes
  }

  onSortOrderChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.sortOrder.set(target.value);
    this.applyFilters();
    this.updateUrlWithPreservedParams();
    // No chart update needed for sort order changes
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

    // Sort results
    filtered = this.sortResults(filtered);

    this.filteredResults.set(filtered);
  }

  private sortResults(results: TestResult[]): TestResult[] {
    const sortBy = this.sortBy();
    const sortOrder = this.sortOrder();
    
    return [...results].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'name':
          comparison = a.testName.localeCompare(b.testName);
          break;
        case 'group':
          comparison = a.groupName.localeCompare(b.groupName);
          break;
        case 'status':
          comparison = a.testStatus.localeCompare(b.testStatus);
          break;
        case 'expression':
          comparison = a.expression.localeCompare(b.expression);
          break;
        case 'testsName':
          comparison = a.testsName.localeCompare(b.testsName);
          break;
        default:
          comparison = 0;
      }
      
      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }

  getGroupedResults(): { group: string; results: TestResult[] }[] {
    const results = this.filteredResults();
    const groupBy = this.groupBy();
    
    if (groupBy === 'none') {
      return [{ group: 'All Results', results }];
    }
    
    const groups = new Map<string, TestResult[]>();
    
    results.forEach(result => {
      const groupKey = groupBy === 'group' ? result.groupName : 
                      groupBy === 'status' ? result.testStatus :
                      groupBy === 'testsName' ? result.testsName : 'Ungrouped';
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(result);
    });
    
    // Sort groups alphabetically
    return Array.from(groups.entries())
      .map(([group, groupResults]) => ({ group, results: groupResults }))
      .sort((a, b) => a.group.localeCompare(b.group));
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

  goBackToIndex(): void {
    const indexUrl = sessionStorage.getItem('indexUrl');
    if (indexUrl) {
      this.router.navigate(['/'], { queryParams: { index: indexUrl } });
    } else {
      this.router.navigate(['/']);
    }
  }

  hasIndexUrl(): boolean {
    return !!sessionStorage.getItem('indexUrl');
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

  private updateChartData(): void {
    this.updatePieChartData();
    this.updateBarChartData();
  }

  private updatePieChartData(): void {
    const summary = this.testResults()?.testResultsSummary;
    if (!summary) return;

    this.pieChartData = {
      ...this.pieChartData,
      datasets: [{
        ...this.pieChartData.datasets[0],
        data: [summary.passCount, summary.failCount, summary.skipCount, summary.errorCount]
      }]
    };
  }

  private updateBarChartData(): void {
    const results = this.filteredResults();
    const groupCounts = new Map<string, { pass: number; fail: number; skip: number; error: number }>();

    // Count tests by group and result type
    results.forEach(result => {
      const group = result.groupName || 'Ungrouped';
      if (!groupCounts.has(group)) {
        groupCounts.set(group, { pass: 0, fail: 0, skip: 0, error: 0 });
      }
      
      const counts = groupCounts.get(group)!;
      switch (result.testStatus) {
        case 'pass':
          counts.pass++;
          break;
        case 'fail':
          counts.fail++;
          break;
        case 'skip':
          counts.skip++;
          break;
        case 'error':
          counts.error++;
          break;
      }
    });

    // Sort groups by total count (descending) and limit to top 10
    const sortedGroups = Array.from(groupCounts.entries())
      .map(([group, counts]) => ({
        group,
        counts,
        total: counts.pass + counts.fail + counts.skip + counts.error
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    this.barChartData = {
      labels: sortedGroups.map(item => item.group),
      datasets: [
        {
          ...this.barChartData.datasets[0],
          data: sortedGroups.map(item => item.counts.pass)
        },
        {
          ...this.barChartData.datasets[1],
          data: sortedGroups.map(item => item.counts.fail)
        },
        {
          ...this.barChartData.datasets[2],
          data: sortedGroups.map(item => item.counts.skip)
        },
        {
          ...this.barChartData.datasets[3],
          data: sortedGroups.map(item => item.counts.error)
        }
      ]
    };
  }

  private updateUrlWithPreservedParams(): void {
    const queryParams: any = {};
    
    // Always include the original URL parameter if it exists
    if (this.originalUrl) {
      queryParams.url = this.originalUrl;
    }
    
    // Only add parameters that are not default values
    if (this.selectedStatus() !== 'all') {
      queryParams.status = this.selectedStatus();
    }
    
    if (this.searchTerm().trim()) {
      queryParams.search = this.searchTerm().trim();
    }
    
    if (this.groupBy() !== 'none') {
      queryParams.groupBy = this.groupBy();
    }
    
    if (this.sortBy() !== 'name') {
      queryParams.sortBy = this.sortBy();
    }
    
    if (this.sortOrder() !== 'asc') {
      queryParams.sortOrder = this.sortOrder();
    }
    
    // Update URL without triggering navigation
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private async loadFromUrl(url: string): Promise<void> {
    try {
      const data = await this.fileLoader.loadFromUrl(url);
      
      // Check if schema validation is enabled
      if (this.settingsService.settings().validateSchema) {
        const validation = await this.schemaValidation.validateResults(data);
        
        if (validation.isValid) {
          sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
          this.testResults.set(data);
          this.loadInitialParameters();
          this.applyFilters();
          this.updateChartData();
          this.updateUrlWithPreservedParams();
        } else {
          console.error('Validation errors:', validation.errors);
          // Still load results but show validation errors
          sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
          sessionStorage.setItem('validationErrors', JSON.stringify(validation.errors));
          this.testResults.set(data);
          this.loadInitialParameters();
          this.applyFilters();
          this.updateChartData();
          this.updateUrlWithPreservedParams();
        }
      } else {
        // Skip validation, just store and load
        sessionStorage.setItem('cqlTestResults', JSON.stringify(data));
        this.testResults.set(data);
        this.loadInitialParameters();
        this.applyFilters();
        this.updateChartData();
        this.updateUrlWithPreservedParams();
      }
    } catch (error) {
      console.error('Error loading from URL:', error);
      this.router.navigate(['/']);
    }
  }
}
