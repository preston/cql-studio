// Author: Preston Lee

import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('should load the application homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Should show the open component
    await expect(page.locator('app-open')).toBeVisible();
    
    // Should have file input
    await expect(page.locator('input[type="file"]')).toBeVisible();
    
    // Should have URL input for results
    await expect(page.locator('input[placeholder*="results.json"]')).toBeVisible();
    
    // Should have example button
    await expect(page.locator('button:has-text("Load Example Results File")')).toBeVisible();
  });

  test('should navigate to results documentation page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click documentation dropdown
    await page.click('a:has-text("Documentation")');
    
    // Click results documentation link
    await page.click('.dropdown-item:has-text("Results")');
    
    // Should show results documentation content
    await expect(page.locator('h1:has-text("Launching CQL Test Results Viewer")')).toBeVisible();
  });

  test('should navigate to runner documentation page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click documentation dropdown
    await page.click('a:has-text("Documentation")');
    
    // Click runner documentation link
    await page.click('.dropdown-item:has-text("Runner")');
    
    // Should show runner documentation content
    await expect(page.locator('h1:has-text("CQL Test Runner")')).toBeVisible();
  });

  test('should navigate to runner page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click runner link
    await page.click('.nav-link:has-text("Runner")');
    
    // Should show runner content
    await expect(page.locator('h1:has-text("CQL Test Runner")')).toBeVisible();
  });

  test('should navigate to settings page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click settings link
    await page.click('a:has-text("Settings")');
    
    // Should show settings content
    await expect(page.locator('h4:has-text("Preferences")')).toBeVisible();
  });

  test('should load example data', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click load example button
    await page.click('button:has-text("Load Example")');
    
    // Wait for navigation to results page
    await page.waitForSelector('app-results-viewer', { timeout: 10000 });
    
    // Should show results
    await expect(page.locator('app-results-viewer')).toBeVisible();
    
    // Should have test results table
    await expect(page.locator('table')).toBeVisible();
  });

  test('should handle deep linking with URL parameter', async ({ page }) => {
    await page.goto('/?url=/examples/results.json');
    await page.waitForLoadState('networkidle');
    
    // Wait for the results to load (this might take a moment)
    await page.waitForSelector('app-results-viewer', { timeout: 10000 });
    
    // Should navigate directly to results page
    await expect(page.locator('app-results-viewer')).toBeVisible();
    
    // Should show test results
    await expect(page.locator('table')).toBeVisible();
  });

  test('should load runner configuration from URL parameter', async ({ page }) => {
    // Navigate to runner page with URL parameter
    await page.goto('/runner?url=/examples/runner-config.json');
    await page.waitForLoadState('networkidle');
    
    // Should show runner component
    await expect(page.locator('h1:has-text("CQL Test Runner")')).toBeVisible();
    
    // Should load configuration from URL
    await expect(page.locator('input[id="baseUrl"]')).toHaveValue('https://cloud.alphora.com/sandbox/r4/cds/fhir');
    await expect(page.locator('input[id="cqlOperation"]')).toHaveValue('$cql');
    await expect(page.locator('input[id="cqlFileVersion"]')).toHaveValue('1.0.000');
    await expect(page.locator('input[id="cqlOutputPath"]')).toHaveValue('./cql');
    await expect(page.locator('input[id="resultsPath"]')).toHaveValue('./results');
    
    // Should have skip list section visible (skip list items might not be pre-populated)
    await expect(page.locator('h5:has-text("Skip List")')).toBeVisible();
  });
});
