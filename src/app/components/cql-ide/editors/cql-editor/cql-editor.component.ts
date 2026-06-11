// Author: Preston Lee

import { Component, input, output, viewChild, ElementRef, AfterViewInit, OnDestroy, signal, computed, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { linter, lintGutter, Diagnostic } from '@codemirror/lint';
import { CqlGrammarManager } from '../../../../services/cql-grammar-manager.service';
import { createCqlEditorBaseExtensions } from '../../../../services/cql-codemirror-extensions.lib';
import { scanInvalidCqlCharacters } from '../../../../services/cql-character-lint.lib';
import { IdeEditor, EditorState as IdeEditorState } from '../base-editor.interface';
import { IdeStateService } from '../../../../services/ide-state.service';
import { CqlFormatterService } from '../../../../services/cql-formatter.service';
import { CqlValidationService, FullValidationResult, ValidationResult } from '../../../../services/cql-validation.service';
import { LibraryTranslationContextBuilder } from '../../../../services/library-translation-context.lib';
import { DEFAULT_SEND_TERMINOLOGY_ROUTING } from '../../../../services/cql-execution.service';
import { CqlDefinitionIndexService, elmColumnToCodeMirror } from '../../../../services/cql-definition-index.service';
import { CqlDefinitionIndex, CqlReferenceMatch, isReferenceResolvableSync } from '../../../../services/elm-locator.lib';
import { CqlIdeLibraryOpenerService } from '../../../../services/cql-ide-library-opener.service';
import {
  createGoToDefinitionExtension,
  reconfigureDefinitionIndex
} from '../../../../services/cql-codemirror-go-to-definition.lib';

@Component({
  selector: 'app-cql-editor',
  imports: [FormsModule],
  templateUrl: './cql-editor.component.html',

  styleUrls: ['./cql-editor.component.scss']
})
export class CqlEditorComponent implements AfterViewInit, OnDestroy, IdeEditor {
  editorContainer = viewChild<ElementRef<HTMLDivElement>>('editorContainer');
  
  libraryId = input<string>('');
  editorState = input<any>();
  placeholder = input<string>('Enter CQL code here...');
  height = input<string>('500px');
  readonly = input<boolean>(false);
  contentLoading = input<boolean>(false);
  contentLoadError = input<string | null>(null);
  isNewLibrary = input<boolean>(false);
  
  contentChange = output<{ cursorPosition: { line: number; column: number }, wordCount: number, content: string }>();
  cursorChange = output<{ line: number; column: number }>();
  editorStateChange = output<IdeEditorState>();
  syntaxErrors = output<string[]>();
  executeLibrary = output<void>();
  reloadLibrary = output<void>();
  formatCql = output<void>();
  validateCql = output<void>();
  saveLibrary = output<void>();
  sendTerminologyRoutingChange = output<boolean>();

  /** Per-library value from parent (LibraryResource.sendTerminologyRouting ?? default). */
  sendTerminologyRoutingInput = input<boolean>(DEFAULT_SEND_TERMINOLOGY_ROUTING);

  private editor?: EditorView;
  private grammarManager: CqlGrammarManager;
  private _value: string = '';
  private isInitializing: boolean = false;
  private initializationRetries: number = 0;
  private maxRetries: number = 10;
  private resizeObserver?: ResizeObserver;

  // Toolbar properties
  isExecuting: boolean = false;
  
  // Signal for canExecute state
  private _canExecuteSignal = signal(false);
  
  // Computed signal for canExecute
  canExecute = computed(() => this._canExecuteSignal());
  
  // Signal for form validity state
  private _isFormValidSignal = signal(false);
  
  // Computed signal for form validity
  isFormValid = computed(() => this._isFormValidSignal());

  private ideStateService = inject(IdeStateService);
  private cqlFormatterService = inject(CqlFormatterService);
  private cqlValidationService = inject(CqlValidationService);
  private libraryTranslationContextBuilder = inject(LibraryTranslationContextBuilder);
  private definitionIndexService = inject(CqlDefinitionIndexService);
  private libraryOpenerService = inject(CqlIdeLibraryOpenerService);

  private definitionIndex: CqlDefinitionIndex | null = null;

  // Debouncing for validation
  private validationDebounceFrame?: number;
  private readonly VALIDATION_DEBOUNCE_MS = 250;
  private validationGeneration = 0;
  private currentValidationErrors: string[] = [];
  private pendingLintResolvers: Array<(diagnostics: Diagnostic[]) => void> = [];
  
  // Flag to prevent contentChange events during programmatic updates
  private isUpdatingFromReload: boolean = false;

  constructor() {
    this.grammarManager = new CqlGrammarManager();
    
    // Watch for libraryId changes
    effect(() => {
      const libraryId = this.libraryId();
      if (libraryId && this.editor) {
        this.reinitializeEditor();
        this.updateCanExecute();
      }
    });

    // When contentLoading or contentLoadError is set, destroy editor; when both clear, init editor if container is present
    effect(() => {
      const loading = this.contentLoading();
      const loadError = this.contentLoadError();
      if ((loading || loadError) && this.editor) {
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        this.editor.destroy();
        this.editor = undefined;
      }
      if (!loading && !loadError && this.editorContainer()?.nativeElement && !this.editor && !this.isInitializing) {
        this.initializeEditor();
        this.setupResizeObserver();
        this.tryConsumePendingNavigation();
      }
    });
    
    // Watch for reload trigger signal
    effect(() => {
      const pending = this.ideStateService.pendingEditorNavigation();
      const libraryId = this.libraryId();
      if (pending?.libraryId === libraryId && this.editor && !this.contentLoading()) {
        this.tryConsumePendingNavigation();
      }
    });

    effect(() => {
      const reloadTrigger = this.ideStateService.reloadTrigger();
      const libraryId = this.libraryId();
      
      if (!reloadTrigger || !libraryId || !this.editor) {
        return;
      }
      
      // Only act if this reload is for the current library
      if (reloadTrigger.libraryId !== libraryId) {
        return;
      }
      
      // Get the library resource
      const library = this.ideStateService.libraryResources().find(lib => lib.id === libraryId);
      if (!library) {
        return;
      }
      
      // Set flag to prevent contentChange event from triggering parent updates
      this.isUpdatingFromReload = true;
      try {
        this.setValue(library.cqlContent);
        this.updateCanExecute();
      } finally {
        queueMicrotask(() => {
          this.isUpdatingFromReload = false;
        });
      }
    });

    // Re-run canExecute when library resource is updated (e.g. after save)
    effect(() => {
      const libraryId = this.libraryId();
      const resources = this.ideStateService.libraryResources();
      const library = resources.find(lib => lib.id === libraryId);
      if (library) {
        void library.originalContent;
        void library.isDirty;
        this.updateCanExecute();
      }
    });
  }

  // Get content for this specific library
  private getLibraryContent(): string {
    if (!this.libraryId()) return '';
    const library = this.ideStateService.libraryResources().find(lib => lib.id === this.libraryId());
    return library?.cqlContent || '';
  }

  ngAfterViewInit(): void {
    if (this.contentLoading() || this.contentLoadError()) {
      return;
    }
    if (!this.isInitializing && !this.editor && this.editorContainer()?.nativeElement) {
      this.initializeEditor();
      this.setupResizeObserver();
    }
  }

  ngOnDestroy(): void {
    this.cancelValidationDebounce();
    this.editor?.destroy();
    this.resizeObserver?.disconnect();
  }

  private initializeEditor(): void {
    if (this.isInitializing) {
      return;
    }
    
    if (!this.editorContainer()?.nativeElement) {
      return;
    }
    
    if (this.editor) {
      return;
    }
    
    this.isInitializing = true;
    
    const container = this.editorContainer()!.nativeElement;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      this.initializationRetries++;
      
      if (this.initializationRetries >= this.maxRetries) {
        console.error('Max initialization retries reached, forcing initialization with fallback dimensions');
        // Force initialization with fallback dimensions
        container.style.minHeight = '200px';
        container.style.minWidth = '300px';
        // Continue with initialization
      } else {
        this.isInitializing = false;
        // Use ResizeObserver to detect when container becomes available
        this.setupResizeObserver();
        return;
      }
    }
    
    try {
      // Get content for this specific library
      const initialContent = this.getLibraryContent();
      this._value = initialContent; // Sync _value with the actual content
      const startState = EditorState.create({
        doc: initialContent,
        extensions: [
          ...createCqlEditorBaseExtensions(),
          ...this.grammarManager.createExtensions(),
          ...createGoToDefinitionExtension(this.createGoToDefinitionHandlers()),
          lintGutter(),
          linter(this.createLintSource()),
          keymap.of([
            {
              key: 'Tab',
              run: (view) => {
                // Insert tab character at cursor position
                const selection = view.state.selection.main;
                view.dispatch({
                  changes: {
                    from: selection.from,
                    to: selection.to,
                    insert: '\t'
                  },
                  selection: { anchor: selection.from + 1 }
                });
                return true;
              }
            },
            {
              key: 'Ctrl-Shift-f',
              run: () => {
                this.formatCode();
                return true;
              }
            },
            {
              key: 'Ctrl-k',
              run: () => {
                this.clearCode();
                return true;
              }
            }
          ]),
          EditorView.theme({
            '&': {
              height: this.height(),
              fontSize: '14px',
              fontFamily: "'Courier New', Courier, monospace"
            },
            '.cm-content': {
              padding: '12px',
              minHeight: this.height(),
              color: '#ffffff'
            },
            '.cm-focused': {
              outline: 'none'
            },
            '.cm-editor': {
              border: 'none',
              borderRadius: '0.375rem',
              backgroundColor: '#1e1e1e'
            },
            '.cm-editor.cm-focused': {
              borderColor: '#0d6efd',
              boxShadow: '0 0 0 0.2rem rgba(13, 110, 253, 0.25)'
            },
            '.cm-placeholder': {
              color: '#6c757d',
              fontStyle: 'italic'
            },
            '.cm-tooltip': {
              backgroundColor: '#141414',
              border: '1px solid #3a3a3a',
              borderRadius: '4px',
              color: '#f5f5f5',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
            },
            '.cm-tooltip-lint': {
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: '0.85rem',
              lineHeight: '1.4'
            },
            '.cm-diagnostic': {
              backgroundColor: '#141414',
              color: '#f5f5f5',
              padding: '6px 8px'
            },
            '.cm-diagnostic-error': {
              borderLeftColor: '#ef4444'
            },
            '.cm-diagnostic-warning': {
              borderLeftColor: '#f59e0b'
            },
            '.cm-diagnosticText': {
              color: '#f5f5f5'
            },
            '.cm-diagnosticSource': {
              color: '#cfcfcf'
            }
          }, { dark: true }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newValue = update.state.doc.toString();
              this._value = newValue;
              
              // Update form validity signal
              this._isFormValidSignal.set(newValue.trim().length > 0);
              
              // Only emit contentChange if this is not a programmatic update from reload
              if (!this.isUpdatingFromReload) {
                const cursor = this.getCursorPosition();
                const wordCount = this.getWordCount();
                this.contentChange.emit({ 
                  cursorPosition: cursor || { line: 1, column: 1 }, 
                  wordCount: wordCount || 0,
                  content: newValue
                });
                
                // Update canExecute state after content change
                this.updateCanExecute();
              }
              
              // Library resource update will be handled by parent component
              // to avoid change detection issues
            }
            
            if (update.selectionSet) {
              const selection = update.state.selection.main;
              const line = update.state.doc.lineAt(selection.from).number;
              const column = selection.from - update.state.doc.lineAt(selection.from).from;
              this.cursorChange.emit({ line, column });
            }
            
            // Update word count
            const text = update.state.doc.toString();
            const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
            
            // Note: Validation is handled automatically by CodeMirror's lint extension
            // The lint source function will be called automatically when the document changes
            
            // Emit editor state change
            this.editorStateChange.emit({
              cursorPosition: this.getCursorPosition(),
              wordCount: wordCount,
              syntaxErrors: this.getSyntaxErrors(),
              isValidSyntax: this.getIsValidSyntax()
            });
          }),
          EditorView.domEventHandlers({
            focus: () => {}
          })
        ]
      });
      
      this.editor = new EditorView({
        state: startState,
        parent: this.editorContainer()!.nativeElement
      });
      
      this.isInitializing = false;
      this.initializationRetries = 0; // Reset retry counter on success
      this.tryConsumePendingNavigation();
      
      // Update form validity signal after initialization
      this._isFormValidSignal.set(initialContent.trim().length > 0);
      
      // Update canExecute state after initialization
      this.updateCanExecute();
      
    } catch (error) {
      console.error('Failed to initialize CQL editor:', error);
      this.isInitializing = false;
    }
  }

  // IdeEditor interface implementation
  getValue(): string {
    return this.editor?.state.doc.toString() || '';
  }
  
  setValue(value: string): void {
    if (this.isInitializing) {
      return;
    }
    
    this._value = value;
    
    // Update form validity signal
    this._isFormValidSignal.set(value.trim().length > 0);
    
    if (this.editor) {
      this.editor.dispatch({
        changes: {
          from: 0,
          to: this.editor.state.doc.length,
          insert: this._value
        }
      });
    }
  }
  
  focus(): void {
    this.editor?.focus();
  }
  
  blur(): void {
    this.editor?.contentDOM.blur();
  }
  
  insertText(text: string): void {
    if (this.editor) {
      const selection = this.editor.state.selection.main;
      this.editor.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: text
        }
      });
    }
  }
  
  getSelection(): string {
    if (this.editor) {
      const selection = this.editor.state.selection.main;
      return this.editor.state.doc.sliceString(selection.from, selection.to);
    }
    return '';
  }
  
  replaceSelection(text: string): void {
    if (this.editor) {
      const selection = this.editor.state.selection.main;
      this.editor.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: text
        }
      });
    }
  }
  
  formatCode(): void {
    if (!this.editor) {
      return;
    }

    const code = this.getValue();
    if (!code || !code.trim()) {
      return;
    }

    // Save cursor position before formatting
    const cursorPosition = this.getCursorPosition();
    const selection = this.editor.state.selection.main;
    const cursorOffset = selection.from;
    
    // Get the line and column for cursor position tracking
    const cursorLine = cursorPosition?.line || 1;
    const cursorColumn = cursorPosition?.column || 1;

    // Format using the service (simple, reliable formatting)
    const result = this.cqlFormatterService.format(code, {
      indentSize: 2
    });

    if (!result.success) {
      // Show error to user
      console.error('Formatting failed:', result.errors);
      
      // Prepare user-friendly error messages
      const errorMessages = result.errors || [];
      
      if (errorMessages.length > 0) {
        // Emit syntax errors for display in problems panel
        this.syntaxErrors.emit(errorMessages.map(e => `Error: ${e}`));
        
        // Also update editor state
        this.editorStateChange.emit({
          cursorPosition: cursorPosition || { line: 1, column: 1 },
          wordCount: this.getWordCount() || 0,
          syntaxErrors: errorMessages.map(e => `Error: ${e}`),
          isValidSyntax: false
        });
      }
      
      // Don't format if formatting itself failed
      return;
    }

    // Calculate new cursor position
    const newCursorPosition = this.calculateNewCursorPosition(
      code,
      result.formatted,
      cursorLine,
      cursorColumn
    );

    // Set formatted code
    try {
      this.setValue(result.formatted);
      
      // Clear any previous syntax errors since formatting succeeded
      this.syntaxErrors.emit([]);
      
      // Update editor state to reflect successful formatting
      this.editorStateChange.emit({
        cursorPosition: newCursorPosition || cursorPosition || { line: 1, column: 1 },
        wordCount: this.getWordCount() || 0,
        syntaxErrors: [],
        isValidSyntax: true
      });

      requestAnimationFrame(() => {
        if (this.editor && newCursorPosition) {
          try {
            const line = this.editor.state.doc.line(newCursorPosition.line);
            const position = Math.min(
              line.from + newCursorPosition.column - 1,
              line.to
            );
            
            this.editor.dispatch({
              selection: { anchor: position, head: position },
              scrollIntoView: true
            });
            
            this.editor.focus();
          } catch (error) {
            console.warn('Failed to restore cursor position:', error);
            this.editor.focus();
          }
        }
      });
    } catch (error) {
      console.error('Error applying formatted code:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.syntaxErrors.emit([`Failed to apply formatting: ${errorMessage}`]);
    }
  }

  clearCode(): void {
    this.setValue('');
    // setValue already updates the form validity signal
  }

  validateSyntax(code: string): void {
    // Validation is now handled by the lint extension and debounced validation
    // This method is kept for backward compatibility but triggers immediate validation
    this.performValidation(code);
  }

  /**
   * Create lint source function for CodeMirror
   * Uses debouncing to avoid validating on every keystroke
   */
  private createLintSource() {
    return (view: EditorView): Promise<Diagnostic[]> => {
      const code = view.state.doc.toString();
      if (!code || !code.trim()) {
        this.currentValidationErrors = [];
        this.syntaxErrors.emit([]);
        return Promise.resolve([]);
      }

      return new Promise((resolve) => {
        this.pendingLintResolvers.push(resolve);
        this.scheduleValidationDebounce(code);
      });
    };
  }


  /**
   * Perform immediate validation (for manual validation button)
   */
  private performValidation(code: string): void {
    if (!this.editor) {
      return;
    }

    this.cancelValidationDebounce();
    void this.runImmediateValidation(code);
  }

  private async runImmediateValidation(code: string): Promise<void> {
    if (!this.editor) {
      return;
    }

    const generation = ++this.validationGeneration;
    const diagnostics = await this.collectLintDiagnosticsAsync(code, this.editor.state.doc);
    if (generation !== this.validationGeneration) {
      return;
    }

    this.emitValidationUi(diagnostics.compilerResult);
    this.updateDefinitionIndex(diagnostics.compilerResult);
    this.editor.dispatch({ effects: [] });
  }

  private updateDefinitionIndex(full: FullValidationResult): void {
    this.definitionIndex = this.definitionIndexService.buildIndex(full.raw.elmXml);
    if (this.editor) {
      reconfigureDefinitionIndex(this.editor, this.definitionIndex);
    }
  }

  private createGoToDefinitionHandlers() {
    return {
      findReferenceAt: (line: number, column: number): CqlReferenceMatch | null => {
        if (!this.definitionIndex) {
          return null;
        }
        return this.definitionIndexService.findReferenceAt(this.definitionIndex, line, column);
      },
      isResolvableSync: (match: CqlReferenceMatch): boolean => {
        if (!this.definitionIndex) {
          return false;
        }
        return isReferenceResolvableSync(match, this.definitionIndex);
      },
      goToDefinitionAt: async (line: number, column: number): Promise<void> => {
        await this.handleGoToDefinition(line, column);
      }
    };
  }

  private async handleGoToDefinition(line: number, column: number): Promise<void> {
    if (!this.definitionIndex || !this.editor) {
      return;
    }

    const match = this.definitionIndexService.findReferenceAt(this.definitionIndex, line, column);
    if (!match) {
      return;
    }

    const target = await this.definitionIndexService.resolveDefinitionTargetAsync(match, this.definitionIndex);
    if (!target) {
      return;
    }

    if (target.crossLibrary && target.includeRef) {
      const libraryId = await this.libraryOpenerService.openIncludedLibrary(target.includeRef);
      if (!libraryId) {
        return;
      }
      this.ideStateService.requestNavigateToDefinition({
        libraryId,
        line: target.span.startLine,
        column: elmColumnToCodeMirror(target.span.startColumn)
      });
      return;
    }

    this.navigateToPosition(
      target.span.startLine,
      elmColumnToCodeMirror(target.span.startColumn)
    );
  }

  private tryConsumePendingNavigation(): void {
    const pending = this.ideStateService.peekPendingEditorNavigation();
    if (!pending || pending.libraryId !== this.libraryId() || !this.editor) {
      return;
    }

    const resource = this.ideStateService.libraryResources().find(lib => lib.id === pending.libraryId);
    if (resource?.contentLoading || resource?.contentLoadError) {
      return;
    }

    const navigation = this.ideStateService.consumePendingEditorNavigation();
    if (navigation) {
      this.navigateToPosition(navigation.line, navigation.column);
    }
  }

  private getLibraryTranslationContext() {
    const library = this.ideStateService.libraryResources().find(lib => lib.id === this.libraryId());
    return this.libraryTranslationContextBuilder.fromLibraryResource(library);
  }

  private async collectLintDiagnosticsAsync(
    code: string,
    doc: { line: (lineNumber: number) => { from: number; to: number }; lineAt: (pos: number) => { number: number } }
  ): Promise<{ all: Diagnostic[]; compilerResult: FullValidationResult }> {
    const charDiagnostics = scanInvalidCqlCharacters(code, doc);
    const full = await this.cqlValidationService.runFullValidationAsync(code, doc, this.getLibraryTranslationContext());
    const compilerDiagnostics = this.compilerValidationToDiagnostics(full.validation);
    return {
      all: [...charDiagnostics, ...compilerDiagnostics],
      compilerResult: full
    };
  }

  private compilerValidationToDiagnostics(validation: ValidationResult): Diagnostic[] {
    return [
      ...validation.errors.map(err => ({
        from: err.from,
        to: err.to,
        severity: 'error' as const,
        message: err.message
      })),
      ...validation.warnings.map(warn => ({
        from: warn.from,
        to: warn.to,
        severity: 'warning' as const,
        message: warn.message
      }))
    ];
  }

  private cancelValidationDebounce(): void {
    if (this.validationDebounceFrame !== undefined) {
      cancelAnimationFrame(this.validationDebounceFrame);
      this.validationDebounceFrame = undefined;
    }
  }

  private scheduleValidationDebounce(fallbackCode: string): void {
    this.cancelValidationDebounce();
    const deadline = performance.now() + this.VALIDATION_DEBOUNCE_MS;
    const tick = (): void => {
      if (performance.now() >= deadline) {
        this.validationDebounceFrame = undefined;
        this.runDebouncedValidation(fallbackCode);
      } else {
        this.validationDebounceFrame = requestAnimationFrame(tick);
      }
    };
    this.validationDebounceFrame = requestAnimationFrame(tick);
  }

  private runDebouncedValidation(fallbackCode: string): void {
    void this.runDebouncedValidationAsync(fallbackCode);
  }

  private async runDebouncedValidationAsync(fallbackCode: string): Promise<void> {
    const generation = ++this.validationGeneration;
    try {
      const latestCode = this.editor?.state.doc.toString() || fallbackCode;
      const latestDoc = this.editor?.state.doc;

      if (!latestDoc) {
        const resolvers = this.pendingLintResolvers;
        this.pendingLintResolvers = [];
        resolvers.forEach(r => r([]));
        return;
      }

      const diagnostics = await this.collectLintDiagnosticsAsync(latestCode, latestDoc);
      if (generation !== this.validationGeneration) {
        const resolvers = this.pendingLintResolvers;
        this.pendingLintResolvers = [];
        resolvers.forEach(r => r([]));
        return;
      }

      this.emitValidationUi(diagnostics.compilerResult);
      this.updateDefinitionIndex(diagnostics.compilerResult);

      const resolvers = this.pendingLintResolvers;
      this.pendingLintResolvers = [];
      resolvers.forEach(r => r(diagnostics.all));
    } catch (error) {
      console.error('Validation error:', error);
      const resolvers = this.pendingLintResolvers;
      this.pendingLintResolvers = [];
      resolvers.forEach(r => r([]));
    }
  }

  private emitValidationUi(full: FullValidationResult): void {
    this.currentValidationErrors = this.cqlValidationService.formatProblemsPanelMessages(full);
    this.syntaxErrors.emit(this.currentValidationErrors);
    if (this.editor) {
      this.editorStateChange.emit({
        cursorPosition: this.getCursorPosition(),
        wordCount: this.getWordCount(),
        syntaxErrors: this.currentValidationErrors,
        isValidSyntax: full.validation.errors.length === 0
      });
    }
  }

  navigateToLine(lineNumber: number): void {
    this.navigateToPosition(lineNumber, 0);
  }

  navigateToPosition(lineNumber: number, column = 0): void {
    if (!this.editor) {
      console.warn('Editor not available for navigation');
      return;
    }

    try {
      const line = this.editor.state.doc.line(lineNumber);
      const columnOffset = Math.max(0, Math.min(column, line.length));
      const position = line.from + columnOffset;

      this.editor.dispatch({
        selection: { anchor: position, head: position },
        scrollIntoView: true
      });

      this.editor.focus();
    } catch (error) {
      console.error(`Failed to navigate to line ${lineNumber}:`, error);
    }
  }

  // Private helper methods

  private reinitializeEditor(): void {
    if (this.editor && !this.isInitializing) {
      const currentValue = this.getValue();
      this.editor.destroy();
      this.editor = undefined;
      this.isInitializing = false; // Reset flag
      this.initializeEditor();
      // Set value immediately after initialization
      if (this.editor) {
        this.setValue(currentValue);
      }
    }
  }

  /**
   * Calculate new cursor position after formatting
   * Attempts to preserve cursor position relative to the content
   */
  private calculateNewCursorPosition(
    originalCode: string,
    formattedCode: string,
    originalLine: number,
    originalColumn: number
  ): { line: number; column: number } | null {
    try {
      const originalLines = originalCode.split('\n');
      const formattedLines = formattedCode.split('\n');

      // If cursor is beyond the document, place at end
      if (originalLine > originalLines.length) {
        const lastLine = formattedLines[formattedLines.length - 1] || '';
        return {
          line: formattedLines.length,
          column: lastLine.length + 1
        };
      }

      // Get the original line content up to the cursor
      const originalLineContent = originalLines[originalLine - 1] || '';
      const textBeforeCursor = originalLineContent.substring(0, originalColumn - 1);

      // Try to find the same text in the formatted code
      // First, try to find the same line number
      if (originalLine <= formattedLines.length) {
        const formattedLineContent = formattedLines[originalLine - 1];
        
        // Try to find the position in the formatted line
        // Simple approach: find the same text pattern
        const searchText = textBeforeCursor.trim();
        if (searchText) {
          const index = formattedLineContent.indexOf(searchText);
          if (index >= 0) {
            return {
              line: originalLine,
              column: index + searchText.length + 1
            };
          }
        }

        // Fallback: use the same column if line exists
        return {
          line: originalLine,
          column: Math.min(originalColumn, formattedLineContent.length + 1)
        };
      }

      // If line doesn't exist in formatted code, place at end
      const lastLine = formattedLines[formattedLines.length - 1] || '';
      return {
        line: formattedLines.length,
        column: lastLine.length + 1
      };
    } catch (error) {
      console.warn('Error calculating cursor position:', error);
      return null;
    }
  }

  private setupResizeObserver(): void {
    if (!this.editorContainer()?.nativeElement || this.editor) {
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && !this.editor && !this.isInitializing) {
          this.initializeEditor();
          this.resizeObserver?.disconnect();
        }
      }
    });

    this.resizeObserver.observe(this.editorContainer()!.nativeElement);
  }

  private getCursorPosition(): { line: number; column: number } | undefined {
    if (!this.editor) return undefined;
    
    const selection = this.editor.state.selection.main;
    const line = this.editor.state.doc.lineAt(selection.from).number;
    const column = selection.from - this.editor.state.doc.lineAt(selection.from).from;
    return { line, column };
  }

  private getWordCount(): number | undefined {
    if (!this.editor) return undefined;
    
    const text = this.editor.state.doc.toString();
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  private getSyntaxErrors(): string[] {
    return this.currentValidationErrors;
  }

  private getIsValidSyntax(): boolean {
    // Check if there are any errors (warnings don't count as invalid)
    return !this.currentValidationErrors.some(err => err.startsWith('Error:'));
  }

  // Toolbar methods
  
  // Update the canExecute signal
  private updateCanExecute(): void {
    // Get content for this specific library
    const currentContent = this.getLibraryContent();
    const hasContent = currentContent.trim().length > 0;
    if (!hasContent) {
      this._canExecuteSignal.set(false);
      return;
    }
    
    // Get the library resource for this editor
    const library = this.ideStateService.libraryResources().find(lib => lib.id === this.libraryId());
    if (!library) {
      this._canExecuteSignal.set(false);
      return;
    }
    
    // More robust dirty check - normalize whitespace and line endings
    const normalizedCurrent = this.normalizeContent(currentContent);
    const normalizedOriginal = this.normalizeContent(library.originalContent);
    const isDirty = normalizedCurrent !== normalizedOriginal;
    const canExecute = !isDirty;
    
    this._canExecuteSignal.set(canExecute);
  }



  onSendTerminologyRoutingChange(value: boolean): void {
    this.sendTerminologyRoutingChange.emit(value);
  }

  onExecuteLibrary(): void {
    this.executeLibrary.emit();
  }

  onReloadLibrary(): void {
    this.reloadLibrary.emit();
  }

  onFormatCql(): void {
    this.formatCode();
  }

  onValidateCql(): void {
    // Trigger immediate validation
    const code = this.getValue();
    if (code) {
      this.performValidation(code);
    }
    this.validateCql.emit();
  }

  onSaveLibrary(): void {
    this.saveLibrary.emit();
  }


  // Method to manually update the canExecute signal
  invalidateCanExecuteCache(): void {
    this.updateCanExecute();
  }

  // Method to normalize content for comparison (handles whitespace, line endings, etc.)
  private normalizeContent(content: string): string {
    if (!content) return '';
    
    return content
      .replace(/\r\n/g, '\n')  // Normalize line endings to LF
      .replace(/\r/g, '\n')    // Handle old Mac line endings
      .replace(/\n\s*\n/g, '\n') // Remove empty lines
      .trim(); // Remove leading/trailing whitespace
  }
}
