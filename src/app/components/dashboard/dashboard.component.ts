// Author: Preston Lee

import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';
import { SessionStorageKeys } from '../../constants/session-storage.constants';
import { CqlTestResults, TestResult, TestResultsSummary } from '../../models/cql-test-results.model';

interface DashboardData {
  filename: string;
  summary: TestResultsSummary;
  results: TestResult[];
  engine: string;
  timestamp: string;
}

interface ChartDataPoint {
  label: string;
  value: number;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  // Data signals
  dashboardData = signal<DashboardData[]>([]);
  isLoading = signal(false);
  errorMessage = signal('');
  
  // Filter and sort signals
  selectedFiles = signal<string[]>([]);
  statusFilter = signal<string>('all');
  sortBy = signal<string>('filename');
  sortOrder = signal<'asc' | 'desc'>('asc');
  
  // Computed values
  filteredData = computed(() => {
    let data = this.dashboardData();
    
    // Filter by selected files
    if (this.selectedFiles().length > 0) {
      data = data.filter(item => this.selectedFiles().includes(item.filename));
    }
    
    // Filter by status
    if (this.statusFilter() !== 'all') {
      data = data.filter(item => {
        const summary = item.summary;
        switch (this.statusFilter()) {
          case 'pass':
            return summary.passCount > 0;
          case 'fail':
            return summary.failCount > 0;
          case 'skip':
            return summary.skipCount > 0;
          case 'error':
            return summary.errorCount > 0;
          default:
            return true;
        }
      });
    }
    
    // Sort data
    data.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (this.sortBy()) {
        case 'engine':
          aValue = a.engine;
          bValue = b.engine;
          break;
        case 'filename':
          aValue = a.filename;
          bValue = b.filename;
          break;
        case 'passCount':
          aValue = a.summary.passCount;
          bValue = b.summary.passCount;
          break;
        case 'failCount':
          aValue = a.summary.failCount;
          bValue = b.summary.failCount;
          break;
        case 'skipCount':
          aValue = a.summary.skipCount;
          bValue = b.summary.skipCount;
          break;
        case 'errorCount':
          aValue = a.summary.errorCount;
          bValue = b.summary.errorCount;
          break;
        case 'totalTests':
          aValue = a.summary.passCount + a.summary.failCount + a.summary.skipCount + a.summary.errorCount;
          bValue = b.summary.passCount + b.summary.failCount + b.summary.skipCount + b.summary.errorCount;
          break;
        case 'timestamp':
          aValue = new Date(a.timestamp).getTime();
          bValue = new Date(b.timestamp).getTime();
          break;
        default:
          aValue = a.filename;
          bValue = b.filename;
      }
      
      if (this.sortOrder() === 'desc') {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });
    
    return data;
  });
  
  // Summary totals
  totalPass = computed(() => this.filteredData().reduce((sum, item) => sum + item.summary.passCount, 0));
  totalFail = computed(() => this.filteredData().reduce((sum, item) => sum + item.summary.failCount, 0));
  totalSkip = computed(() => this.filteredData().reduce((sum, item) => sum + item.summary.skipCount, 0));
  totalError = computed(() => this.filteredData().reduce((sum, item) => sum + item.summary.errorCount, 0));
  
  // Chart configurations
  summaryChartData = computed((): ChartData<'doughnut'> => {
    const data = this.filteredData();
    const totalPass = data.reduce((sum, item) => sum + item.summary.passCount, 0);
    const totalFail = data.reduce((sum, item) => sum + item.summary.failCount, 0);
    const totalSkip = data.reduce((sum, item) => sum + item.summary.skipCount, 0);
    const totalError = data.reduce((sum, item) => sum + item.summary.errorCount, 0);
    
    return {
      labels: ['Pass', 'Fail', 'Skip', 'Error'],
      datasets: [{
        data: [totalPass, totalFail, totalSkip, totalError],
        backgroundColor: ['#28a745', '#dc3545', '#ffc107', '#6c757d'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    };
  });
  
  summaryChartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom'
      },
      title: {
        display: true,
        text: 'Overall Test Results Summary'
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.label || '';
            const value = context.parsed;
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${label}: ${value} tests (${percentage}%)`;
          },
          afterLabel: (context) => {
            const label = context.label || '';
            const data = this.filteredData();
            
            // Get engine breakdown for this category
            const engineBreakdown = data.map(item => {
              let count = 0;
              switch (label) {
                case 'Pass':
                  count = item.summary.passCount;
                  break;
                case 'Fail':
                  count = item.summary.failCount;
                  break;
                case 'Skip':
                  count = item.summary.skipCount;
                  break;
                case 'Error':
                  count = item.summary.errorCount;
                  break;
              }
              return { engine: item.engine, count };
            }).filter(item => item.count > 0);
            
            if (engineBreakdown.length === 0) {
              return `No ${label.toLowerCase()} tests found`;
            }
            
            // Create breakdown text
            const breakdownText = engineBreakdown
              .map(item => `${item.engine}: ${item.count}`)
              .join('\n');
            
            return `Breakdown by Engine:\n${breakdownText}`;
          }
        },
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: '#fff',
        borderWidth: 1,
        cornerRadius: 6,
        displayColors: true,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 12
        }
      }
    }
  };
  
  fileComparisonChartData = computed((): ChartData<'bar'> => {
    const data = this.filteredData();
    
    return {
      labels: data.map(item => item.engine),
      datasets: [
        {
          label: 'Pass',
          data: data.map(item => item.summary.passCount),
          backgroundColor: '#28a745'
        },
        {
          label: 'Fail',
          data: data.map(item => item.summary.failCount),
          backgroundColor: '#dc3545'
        },
        {
          label: 'Skip',
          data: data.map(item => item.summary.skipCount),
          backgroundColor: '#ffc107'
        },
        {
          label: 'Error',
          data: data.map(item => item.summary.errorCount),
          backgroundColor: '#6c757d'
        }
      ]
    };
  });
  
  fileComparisonChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true
      },
      y: {
        stacked: true,
        beginAtZero: true
      }
    },
    plugins: {
      title: {
        display: true,
        text: 'Test Results by Engine'
      }
    }
  };
  
  constructor(private router: Router) {}
  
  ngOnInit(): void {
    this.loadDashboardData();
  }
  
  async loadDashboardData(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    
    try {
      const indexUrl = sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
      const indexFilesStr = sessionStorage.getItem(SessionStorageKeys.INDEX_FILES);
      
      if (!indexUrl || !indexFilesStr) {
        throw new Error('No index data found. Please load an index file first.');
      }
      
      const indexFiles: string[] = JSON.parse(indexFilesStr);
      const baseUrl = this.getBaseUrlFromIndexUrl(indexUrl);
      
      // Load all files
      const dataPromises = indexFiles.map(filename => this.loadFileData(baseUrl, filename));
      const results = await Promise.allSettled(dataPromises);
      
      const dashboardData: DashboardData[] = [];
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          dashboardData.push(result.value);
        } else {
          console.warn(`Failed to load ${indexFiles[index]}:`, result.status === 'rejected' ? result.reason : 'Unknown error');
        }
      });
      
      if (dashboardData.length === 0) {
        throw new Error('No valid test result files could be loaded.');
      }
      
      this.dashboardData.set(dashboardData);
      this.selectedFiles.set(indexFiles);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  private async loadFileData(baseUrl: string, filename: string): Promise<DashboardData | null> {
    try {
      const fileUrl = `${baseUrl}/${filename}`;
      const response = await fetch(fileUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to load ${filename}: ${response.statusText}`);
      }
      
      const data: CqlTestResults = await response.json();
      
      return {
        filename,
        summary: data.testResultsSummary,
        results: data.results,
        engine: data.cqlengine.description || data.cqlengine.apiUrl,
        timestamp: data.testsRunDateTime
      };
    } catch (error) {
      console.error(`Error loading ${filename}:`, error);
      return null;
    }
  }
  
  private getBaseUrlFromIndexUrl(indexUrl: string): string {
    try {
      const urlObj = new URL(indexUrl);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/'))}`;
    } catch (error) {
      const lastSlashIndex = indexUrl.lastIndexOf('/');
      return lastSlashIndex > 0 ? indexUrl.substring(0, lastSlashIndex) : indexUrl;
    }
  }
  
  onFileSelectionChange(filename: string, checked: boolean): void {
    const selected = this.selectedFiles();
    if (checked) {
      this.selectedFiles.set([...selected, filename]);
    } else {
      this.selectedFiles.set(selected.filter(f => f !== filename));
    }
  }
  
  onSelectAllFiles(): void {
    const allFiles = this.dashboardData().map(item => item.filename);
    this.selectedFiles.set(allFiles);
  }
  
  onDeselectAllFiles(): void {
    this.selectedFiles.set([]);
  }
  
  onStatusFilterChange(status: string): void {
    this.statusFilter.set(status);
  }
  
  onSortChange(sortBy: string): void {
    this.sortBy.set(sortBy);
  }
  
  onSortBy(sortBy: string): void {
    if (this.sortBy() === sortBy) {
      // If clicking the same column, toggle sort order
      this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      // If clicking a different column, set new sort field and default to ascending
      this.sortBy.set(sortBy);
      this.sortOrder.set('asc');
    }
  }
  
  onSortOrderChange(): void {
    this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
  }
  
  onBackToIndex(): void {
    this.router.navigate(['/']);
  }
  
  onViewFile(filename: string): void {
    const indexUrl = sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
    if (indexUrl) {
      const baseUrl = this.getBaseUrlFromIndexUrl(indexUrl);
      const fileUrl = `${baseUrl}/${filename}`;
      this.router.navigate(['/results'], { queryParams: { url: fileUrl } });
    }
  }
}
