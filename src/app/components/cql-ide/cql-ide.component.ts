// Author: Preston Lee

import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { IdeStateService } from '../../services/ide-state.service';
import { IdeTabRegistryService } from '../../services/ide-tab-registry.service';
import { LibraryService } from '../../services/library.service';
import { PatientService } from '../../services/patient.service';
import { TranslationService } from '../../services/translation.service';
import { CqlExecutionService } from '../../services/cql-execution.service';
import { SettingsService } from '../../services/settings.service';
import { KeyboardShortcut } from './shared/ide-types';

// Import all the new components
import { IdeStatusBarComponent } from './ide-status-bar/ide-status-bar.component';
import { IdePanelComponent } from './panels/ide-panel.component';
import { CqlEditorComponent } from './editors/cql-editor/cql-editor.component';
import { EditorTabsComponent } from './editors/editor-tabs/editor-tabs.component';

@Component({
  selector: 'app-cql-ide',
  standalone: true,
  imports: [
    CommonModule,
    IdeStatusBarComponent,
    IdePanelComponent,
    CqlEditorComponent,
    EditorTabsComponent
  ],
  templateUrl: './cql-ide.component.html',
  styleUrls: ['./cql-ide.component.scss']
})
export class CqlIdeComponent implements OnInit, OnDestroy {
  // Simple state properties
  leftPanelVisible = true;
  rightPanelVisible = true;
  bottomPanelVisible = true;
  activeLibraryId: string | null = null;
  libraryResources: any[] = [];
  selectedPatients: any[] = [];
  
  // Cached content to prevent loops
  private _cachedContent: string = '';
  private _lastActiveLibraryId: string | null = null;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    public ideStateService: IdeStateService,
    public ideTabRegistryService: IdeTabRegistryService,
    private libraryService: LibraryService,
    private patientService: PatientService,
    private translationService: TranslationService,
    private cqlExecutionService: CqlExecutionService,
    public settingsService: SettingsService
  ) {}

  ngOnInit(): void {
    console.log('CQL IDE Component initialized');
    this.initializeDefaultTabs();
  }

  ngOnDestroy(): void {
    console.log('CQL IDE Component destroyed');
    // Clean up tabs and state when component is destroyed
    this.cleanupTabs();
  }

  private initializeDefaultTabs(): void {
    // Check if tabs already exist to prevent duplicates
    const leftPanel = this.ideStateService.getPanel('left');
    const rightPanel = this.ideStateService.getPanel('right');
    const bottomPanel = this.ideStateService.getPanel('bottom');
    
    if (leftPanel && leftPanel.tabs.length > 0 && 
        rightPanel && rightPanel.tabs.length > 0 && 
        bottomPanel && bottomPanel.tabs.length > 0) {
      console.log('Default tabs already exist, skipping initialization');
      return;
    }

    // Add default tabs to panels
    const navigationTab = {
      id: 'navigation-tab',
      title: 'Navigation',
      icon: 'bi-list',
      type: 'navigation',
      isActive: true,
      isClosable: false,
      component: null
    };

    const outlineTab = {
      id: 'outline-tab',
      title: 'Outline',
      icon: 'bi-diagram-3',
      type: 'outline',
      isActive: false,
      isClosable: true,
      component: null
    };

    const fhirTab = {
      id: 'fhir-tab',
      title: 'FHIR',
      icon: 'bi-heart-pulse',
      type: 'fhir',
      isActive: true,
      isClosable: false,
      component: null
    };

    const elmTab = {
      id: 'elm-tab',
      title: 'ELM',
      icon: 'bi-code-slash',
      type: 'elm',
      isActive: false,
      isClosable: true,
      component: null
    };

    const outputTab = {
      id: 'output-tab',
      title: 'Output',
      icon: 'bi-terminal',
      type: 'output',
      isActive: true,
      isClosable: true,
      component: null
    };

    const problemsTab = {
      id: 'problems-tab',
      title: 'Problems',
      icon: 'bi-exclamation-triangle',
      type: 'problems',
      isActive: false,
      isClosable: false,
      component: null
    };


    // Add tabs to panels
    this.ideStateService.addTabToPanel('left', navigationTab);
    this.ideStateService.addTabToPanel('left', outlineTab);
    this.ideStateService.addTabToPanel('right', fhirTab);
    this.ideStateService.addTabToPanel('right', elmTab);
    this.ideStateService.addTabToPanel('bottom', outputTab);
    this.ideStateService.addTabToPanel('bottom', problemsTab);
  }

  private cleanupTabs(): void {
    // Clear all tabs from all panels
    this.ideStateService.clearPanelTabs('left');
    this.ideStateService.clearPanelTabs('right');
    this.ideStateService.clearPanelTabs('bottom');
    
    // Clear output sections
    this.ideStateService.clearOutputSections();
    
    // Reset execution state
    this.ideStateService.setExecuting(false);
    this.ideStateService.setExecutionProgress(0);
    this.ideStateService.setExecutionStatus('');
  }

  // Panel management
  onTogglePanel(panelId: string): void {
    switch (panelId) {
      case 'left':
        this.leftPanelVisible = !this.leftPanelVisible;
        break;
      case 'right':
        this.rightPanelVisible = !this.rightPanelVisible;
        break;
      case 'bottom':
        this.bottomPanelVisible = !this.bottomPanelVisible;
        break;
    }
    this.ideStateService.togglePanel(panelId);
  }

  onSetActiveTab(panelId: string, tabId: string): void {
    this.ideStateService.setActiveTab(panelId, tabId);
  }

  // Tab management
  onMoveTab(event: { tabId: string, fromPanelId: string, toPanelId: string }): void {
    // Implementation for moving tabs between panels
    console.log('Moving tab:', event);
  }

  // Drag and drop handlers
  onTabDrop(event: { tab: any, targetPanelId: string }): void {
    console.log('Tab dropped:', event);
  }

  onDragOver(panelId: string): void {
    this.ideStateService.setDragOverPanel(panelId);
  }

  onDragLeave(panelId: string): void {
    if (this.ideStateService.dragOverPanel() === panelId) {
      this.ideStateService.setDragOverPanel(null);
    }
  }

  // Library management
  onLibraryIdChange(libraryId: string): void {
    this.activeLibraryId = libraryId;
    this.ideStateService.selectLibraryResource(libraryId);
    // Invalidate cache when library changes
    this._lastActiveLibraryId = null;
    // Force content refresh by clearing cached content
    this._cachedContent = '';
  }

  getActiveLibraryContent(): string {
    const currentActiveLibraryId = this.ideStateService.activeLibraryId();
    
    // Only update cache if the active library has changed
    if (currentActiveLibraryId !== this._lastActiveLibraryId) {
      const activeLibrary = this.ideStateService.getActiveLibraryResource();
      this._cachedContent = activeLibrary?.cqlContent || '';
      this._lastActiveLibraryId = currentActiveLibraryId;
      console.log('getActiveLibraryContent updated cache:', { 
        activeLibraryId: currentActiveLibraryId,
        content: this._cachedContent.substring(0, 100) + '...',
        contentLength: this._cachedContent.length 
      });
    }
    
    return this._cachedContent;
  }

  onLibraryVersionChange(version: string): void {
    // Handle library version change
    console.log('Library version changed:', version);
  }

  onLibraryDescriptionChange(description: string): void {
    // Handle library description change
    console.log('Library description changed:', description);
  }

  onSaveLibrary(): void {
    // Handle save library
    console.log('Saving library');
  }

  onDeleteLibrary(libraryId: string): void {
    // If this was the active library, clear the active library first
    if (this.ideStateService.activeLibraryId() === libraryId) {
      this.ideStateService.selectLibraryResource('');
    }
    
    // Remove library from the state service
    this.ideStateService.removeLibraryResource(libraryId);
  }

  // Translation
  onTranslateCqlToElm(): void {
    this.ideStateService.setTranslating(true);
    // Implementation for CQL to ELM translation
    console.log('Translating CQL to ELM');
  }

  onClearElmTranslation(): void {
    this.ideStateService.setElmTranslationResults(null);
  }

  // Execution
  onExecuteAll(): void {
    this.ideStateService.setExecuting(true);
    
    // Get all library resources
    const libraries = this.ideStateService.libraryResources();
    if (libraries.length === 0) {
      console.log('No libraries to execute');
      this.ideStateService.setExecuting(false);
      return;
    }
    
    // Get selected patient IDs
    const patientIds = this.patientService.selectedPatients.map(p => p.id).filter(id => id) as string[];
    
    // Prepare libraries for execution
    const librariesToExecute = libraries.map(lib => ({
      id: lib.id,
      name: lib.name || lib.id
    }));
    
    // Execute all libraries using CQL execution service
    this.cqlExecutionService.executeAllLibraries(librariesToExecute, patientIds).subscribe({
      next: (results) => {
        console.log('All libraries execution completed:', results);
        this.ideStateService.setExecuting(false);
        
        // Format and add results to output sections
        this.formatAndAddExecutionResults(results, 'Execute All Libraries');
      },
      error: (error) => {
        console.error('All libraries execution failed:', error);
        this.ideStateService.setExecuting(false);
        
        // Add error to output sections
        this.addErrorToOutput('Execute All Libraries', error);
      }
    });
  }

  // Settings
  onPreserveLogsChange(preserveLogs: boolean): void {
    // Handle preserve logs setting change
    console.log('Preserve logs changed:', preserveLogs);
  }

  // Additional methods needed for the template
  onStartResize(event: { type: string; event: MouseEvent; newSize?: number }): void {
    if (event.newSize !== undefined) {
      this.ideStateService.setPanelSize(event.type, event.newSize);
    }
  }

  onReorderEditorTabs(event: { fromIndex: number; toIndex: number }): void {
    console.log('Reorder editor tabs:', event);
  }

  onEditorContentChange(event: { cursorPosition: { line: number; column: number }, wordCount: number }): void {
    this.ideStateService.updateEditorState({
      cursorPosition: event.cursorPosition,
      wordCount: event.wordCount
    });
    // Invalidate cache when content changes
    this._lastActiveLibraryId = null;
  }

  onEditorSyntaxErrors(errors: string[]): void {
    this.ideStateService.updateEditorState({
      syntaxErrors: errors,
      isValidSyntax: errors.length === 0
    });
  }

  // Editor toolbar methods
  onExecuteLibrary(): void {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    if (!activeLibrary) {
      console.log('No active library to execute');
      return;
    }
    
    this.ideStateService.setExecuting(true);
    
    // Get selected patient IDs
    const patientIds = this.patientService.selectedPatients.map(p => p.id).filter(id => id) as string[];
    
    // Execute single library using CQL execution service
    this.cqlExecutionService.executeLibrary(
      activeLibrary.id, 
      patientIds
    ).subscribe({
      next: (result) => {
        console.log('Library execution completed:', result);
        this.ideStateService.setExecuting(false);
        
        // Format and add results to output sections
        this.formatAndAddExecutionResults(result, `Library: ${activeLibrary.name || activeLibrary.id}`);
      },
      error: (error) => {
        console.error('Library execution failed:', error);
        this.ideStateService.setExecuting(false);
        
        // Add error to output sections
        this.addErrorToOutput(`Library: ${activeLibrary.name || activeLibrary.id}`, error);
      }
    });
  }

  onReloadLibrary(): void {
    console.log('Reload library');
    // TODO: Implement library reload
  }

  onCqlVersionChange(version: string): void {
    console.log('CQL version changed:', version);
    // TODO: Update CQL version
  }

  onFormatCql(): void {
    console.log('Format CQL');
    // TODO: Implement CQL formatting
  }

  onValidateCql(): void {
    console.log('Validate CQL');
    // TODO: Implement CQL validation
  }

  // Helper methods for output formatting
  private formatAndAddExecutionResults(results: any[], title: string): void {
    const content = this.formatExecutionResults(results);
    const status = results.some(r => r.error) ? 'error' : 'success';
    const executionTime = results.reduce((total, r) => total + (r.executionTime || 0), 0);
    
    this.ideStateService.addOutputSection({
      title: title,
      content: content,
      status: status,
      executionTime: executionTime,
      expanded: true
    });
  }

  private addErrorToOutput(title: string, error: any): void {
    const content = `Execution failed:\n${JSON.stringify(error, null, 2)}`;
    
    this.ideStateService.addOutputSection({
      title: title,
      content: content,
      status: 'error',
      executionTime: 0,
      expanded: true
    });
  }

  private formatExecutionResults(results: any[]): string {
    let output = '';
    
    if (results.length === 0) {
      output += 'No execution results.\n';
      return output;
    }

    // Check if we have patient-specific results
    const hasPatientResults = results.some(r => r.patientId);
    
    if (hasPatientResults) {
      // Multiple patients
      output += `=== Library Execution Results for ${results.length} Patient(s) ===\n\n`;
      
      results.forEach((result, index) => {
        output += `--- Patient ${index + 1}: ${result.patientName || result.patientId} (${result.patientId}) ---\n`;
        
        if (result.error) {
          output += `ERROR: ${JSON.stringify(result.error, null, 2)}\n\n`;
        } else {
          output += `RESULT: ${JSON.stringify(result.result, null, 2)}\n\n`;
        }
      });
    } else {
      // Single execution without patient
      output += `=== Library Execution Results ===\n\n`;
      
      results.forEach((result, index) => {
        if (result.error) {
          output += `ERROR: ${JSON.stringify(result.error, null, 2)}\n\n`;
        } else {
          output += `RESULT: ${JSON.stringify(result.result, null, 2)}\n\n`;
        }
      });
    }
    
    output += `Execution completed at: ${new Date().toLocaleString()}\n`;
    
    return output;
  }

  // Keyboard shortcuts for the welcome message
  getAllShortcuts(): KeyboardShortcut[] {
    return [
      // Core CQL IDE shortcuts - Apple-friendly
      { key: 'F5', description: 'Execute Active Library' },
      { key: '⌘+F5', description: 'Execute All Libraries' },
      { key: '⌘+W', description: 'Close Active Editor' }
    ];
  }

  // Keyboard shortcut handler
  @HostListener('document:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {
    // Prevent default behavior for our shortcuts
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmdKey = isMac ? event.metaKey : event.ctrlKey;
    
    // F5 - Execute Active Library
    if (event.key === 'F5' && !isCmdKey) {
      event.preventDefault();
      this.onExecuteLibrary();
      return;
    }
    
    // Cmd+F5 (Mac) or Ctrl+F5 (PC) - Execute All Libraries
    if (event.key === 'F5' && isCmdKey) {
      event.preventDefault();
      this.onExecuteAll();
      return;
    }
    
    // Cmd+W (Mac) or Ctrl+W (PC) - Close Active Editor
    if (event.key === 'w' && isCmdKey) {
      event.preventDefault();
      this.onCloseActiveEditor();
      return;
    }
  }

  // Close active editor method
  private onCloseActiveEditor(): void {
    const activeLibraryId = this.ideStateService.activeLibraryId();
    if (activeLibraryId) {
      this.onDeleteLibrary(activeLibraryId);
    }
  }

}