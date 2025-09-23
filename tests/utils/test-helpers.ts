// Author: Preston Lee

import { Page, expect } from '@playwright/test';
import path from 'path';
import { 
  StatusFilter, 
  GroupByOption, 
  SortByOption, 
  SortOrder 
} from '../../src/app/models/query-params.model';

export class TestHelpers {
  constructor(public page: Page) {}

  /**
   * Wait for the application to be fully loaded
   */
  async waitForAppLoad() {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForSelector('app-open, app-results-viewer', { timeout: 10000 });
  }

  /**
   * Navigate to the home page and wait for it to load
   */
  async goToHome() {
    await this.page.goto('/');
    await this.waitForAppLoad();
  }

  /**
   * Upload a test file using the file input
   */
  async uploadTestFile(filename: string) {
    const filePath = path.join(__dirname, '..', 'fixtures', filename);
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);
    
    // Wait for file to be processed
    await this.page.waitForSelector('.alert-success, .alert-danger', { timeout: 10000 });
  }

  /**
   * Load data from URL
   */
  async loadFromUrl(url: string) {
    const urlInput = this.page.locator('#url-input');
    await urlInput.fill(url);
    
    const loadButton = this.page.locator('#url-load-button');
    await loadButton.click();
    
    // Wait for loading to complete
    await this.page.waitForSelector('.alert-success, .alert-danger', { timeout: 10000 });
  }

  /**
   * Load example data
   */
  async loadExample() {
    const exampleButton = this.page.locator('#example-load-button');
    await exampleButton.click();
    
    // Wait for navigation to results page
    await this.page.waitForSelector('app-results-viewer', { timeout: 10000 });
  }

  /**
   * Load from index file
   */
  async loadFromIndex(indexUrl: string) {
    const indexInput = this.page.locator('#index-url-input');
    await indexInput.fill(indexUrl);
    
    const loadIndexButton = this.page.locator('#index-load-button');
    await loadIndexButton.click();
    
    // Wait for index to load
    await this.page.waitForSelector('.list-group-item, .alert-danger', { timeout: 10000 });
  }

  /**
   * Select a file from the index list
   */
  async selectFileFromIndex(filename: string) {
    const fileItem = this.page.locator(`.list-group-item:has-text("${filename}")`);
    await fileItem.click();
    
    // Wait for file to load
    await this.page.waitForSelector('.alert-success, .alert-danger', { timeout: 10000 });
  }

  /**
   * Check if we're on the results viewer page
   */
  async isOnResultsPage() {
    return await this.page.locator('app-results-viewer').isVisible();
  }

  /**
   * Check if we're on the home page
   */
  async isOnHomePage() {
    return await this.page.locator('app-open').isVisible();
  }

  /**
   * Get the current URL with query parameters
   */
  getCurrentUrl() {
    return this.page.url();
  }

  /**
   * Wait for results to be displayed
   */
  async waitForResults() {
    await this.page.waitForSelector('.table, .card', { timeout: 10000 });
  }

  /**
   * Get the test results summary
   */
  async getTestSummary() {
    const summary = await this.page.locator('.card-body').first().textContent();
    return summary;
  }

  /**
   * Check if error message is displayed
   */
  async hasErrorMessage() {
    return await this.page.locator('.alert-danger').isVisible();
  }

  /**
   * Get error message text
   */
  async getErrorMessage() {
    return await this.page.locator('.alert-danger').textContent();
  }

  /**
   * Check if success message is displayed
   */
  async hasSuccessMessage() {
    return await this.page.locator('.alert-success').isVisible();
  }

  /**
   * Get success message text
   */
  async getSuccessMessage() {
    return await this.page.locator('.alert-success').textContent();
  }

  /**
   * Apply status filter
   */
  async filterByStatus(status: StatusFilter) {
    const statusSelect = this.page.locator('#status-filter');
    await statusSelect.selectOption(status);
    
    // Trigger change event to ensure Angular picks up the change
    await statusSelect.dispatchEvent('change');
    
    // Wait for filter to apply
    await this.page.waitForTimeout(500);
  }

  /**
   * Apply search filter
   */
  async searchFor(term: string) {
    const searchInput = this.page.locator('#search-input');
    await searchInput.fill(term);
    
    // Trigger change event to ensure Angular picks up the change
    await searchInput.dispatchEvent('change');
    
    // Wait for search to apply
    await this.page.waitForTimeout(500);
  }

  /**
   * Set grouping option
   */
  async setGroupBy(groupBy: GroupByOption) {
    const groupSelect = this.page.locator('#group-by-filter');
    await groupSelect.selectOption(groupBy);
    
    // Wait for grouping to apply
    await this.page.waitForTimeout(500);
  }

  /**
   * Set sorting option
   */
  async setSortBy(sortBy: SortByOption) {
    const sortSelect = this.page.locator('#sort-by-filter');
    await sortSelect.click(); // Click first to ensure focus
    await sortSelect.selectOption(sortBy);
    await sortSelect.dispatchEvent('change'); // Trigger change event
    await this.page.waitForTimeout(500);
  }

  /**
   * Set sort order
   */
  async setSortOrder(order: SortOrder) {
    const orderSelect = this.page.locator('#sort-order-filter');
    await orderSelect.click(); // Click first to ensure focus
    await orderSelect.selectOption(order);
    await orderSelect.dispatchEvent('change'); // Trigger change event
    await this.page.waitForTimeout(500);
  }

  /**
   * Get the number of displayed test results
   */
  async getTestResultCount() {
    const rows = await this.page.locator('[data-testid="test-result-row"]').count();
    return rows;
  }

  /**
   * Get all test result rows (excluding group headers)
   */
  async getTestRows() {
    return this.page.locator('[data-testid="test-result-row"]');
  }

  /**
   * Get all status cell values
   */
  async getStatusCells() {
    return this.page.locator('[data-testid="status-cell"]').allTextContents();
  }

  /**
   * Get all test name cell values
   */
  async getTestNameCells() {
    return this.page.locator('[data-testid="test-name-cell"]').allTextContents();
  }

  /**
   * Get all group cell values
   */
  async getGroupCells() {
    return this.page.locator('[data-testid="group-cell"]').allTextContents();
  }

  /**
   * Get all expression cell values
   */
  async getExpressionCells() {
    return this.page.locator('[data-testid="expression-cell"]').allTextContents();
  }


  /**
   * Check if validation errors are displayed
   */
  async hasValidationErrors() {
    return await this.page.locator('.alert-warning').isVisible();
  }

  /**
   * Get validation error messages
   */
  async getValidationErrors() {
    return await this.page.locator('.alert-warning').textContent();
  }

  /**
   * Clear all filters
   */
  async clearFilters() {
    // Reset status filter
    await this.filterByStatus(StatusFilter.ALL);
    
    // Clear search
    const searchInput = this.page.locator('#search-input');
    await searchInput.clear();
    
    // Reset grouping
    await this.setGroupBy(GroupByOption.NONE);
    
    // Reset sorting
    await this.setSortBy(SortByOption.NAME);
    await this.setSortOrder(SortOrder.ASC);
  }

  /**
   * Navigate to documentation page
   */
  async goToDocumentation() {
    const docLink = this.page.locator('a:has-text("Documentation")');
    await docLink.click();
    await this.page.waitForSelector('h1:has-text("Launching CQL Test Results Viewer")');
  }

  /**
   * Navigate to settings page
   */
  async goToSettings() {
    const settingsLink = this.page.locator('a:has-text("Settings")');
    await settingsLink.click();
    await this.page.waitForSelector('h4:has-text("Preferences")');
  }

  /**
   * Toggle schema validation setting
   */
  async toggleSchemaValidation() {
    const validationCheckbox = this.page.locator('#validate-schema-switch');
    await validationCheckbox.click();
  }

  /**
   * Check if schema validation is enabled
   */
  async isSchemaValidationEnabled() {
    const validationCheckbox = this.page.locator('#validate-schema-switch');
    return await validationCheckbox.isChecked();
  }
}
