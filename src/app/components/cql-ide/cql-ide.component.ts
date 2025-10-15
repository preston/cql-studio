// Author: Preston Lee

import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnDestroy, OnChanges, SimpleChanges, forwardRef, HostListener } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { Library, Bundle, Patient, Parameters } from 'fhir/r4';
import { LibraryService } from '../../services/library.service';
import { PatientService } from '../../services/patient.service';
import { SettingsService } from '../../services/settings.service';
import { TranslationService } from '../../services/translation.service';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { highlightSpecialChars } from '@codemirror/view';
import { bracketMatching } from '@codemirror/language';
import { tags } from '@lezer/highlight';
// import { javascript } from '@codemirror/lang-javascript';
import { CqlGrammarManager, CqlVersion } from '../../services/cql-grammar-manager.service';

// Re-export CqlVersion for external use
export type { CqlVersion };

// Custom highlight style for dark theme
const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.comment, color: '#6a9955' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.typeName, color: '#4ec9b0' },
  { tag: tags.operator, color: '#ffffff' },
  { tag: tags.punctuation, color: '#ffffff' },
  { tag: tags.propertyName, color: '#9cdcfe' },
  { tag: tags.attributeName, color: '#92c5f8' },
  { tag: tags.tagName, color: '#569cd6' },
  { tag: tags.name, color: '#dcdcaa' },
  { tag: tags.literal, color: '#4fc1ff' },
  { tag: tags.meta, color: '#569cd6' },
  { tag: tags.heading, color: '#569cd6' },
  { tag: tags.quote, color: '#6a9955' },
  { tag: tags.link, color: '#569cd6' },
  { tag: tags.url, color: '#ce9178' },
  { tag: tags.strong, color: '#ffffff', fontWeight: 'bold' },
  { tag: tags.emphasis, color: '#ffffff', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: '#ffffff', textDecoration: 'line-through' }
]);

interface EditorFile {
  id: string;
  name: string;
  content: string;
  isDirty: boolean;
  isActive: boolean;
}

interface PanelState {
  sidebar: { visible: boolean; width: number; activeTab: 'outline' | 'navigation' };
  bottom: { visible: boolean; height: number; activeTab: 'problems' | 'output' | 'dashboard' | 'results' | 'runner' | 'settings' };
  right: { visible: boolean; width: number; activeTab: 'fhir' | 'elm' | 'none' };
}

interface LibraryResource {
  id: string;
  name: string;
  version: string;
  description: string;
  cqlContent: string;
  originalContent: string;
  isActive: boolean;
  isDirty: boolean;
  library: Library | null;
}

@Component({
  selector: 'app-cql-ide',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cql-ide.component.html',
  styleUrls: ['./cql-ide.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CqlIdeComponent),
      multi: true
    }
  ]
})
export class CqlIdeComponent implements AfterViewInit, OnDestroy, OnChanges, ControlValueAccessor {
  @ViewChild('editorContainer', { static: false }) editorContainer?: ElementRef<HTMLDivElement>;
  
  @Input() placeholder: string = 'Enter CQL code here...';
  @Input() height: string = '500px';
  @Input() readonly: boolean = false;
  // IDE always uses dark theme
  @Input() cqlVersion: CqlVersion = '1.5.3';
  
  @Output() contentChange = new EventEmitter<string>();
  @Output() cursorChange = new EventEmitter<{ line: number; column: number }>();
  
  // IDE State
  public files: EditorFile[] = [];
  public libraryResources: LibraryResource[] = [];
  public activeLibraryId: string = '';
  public panelState: PanelState = {
    sidebar: { visible: true, width: 350, activeTab: 'navigation' },
    bottom: { visible: true, height: 300, activeTab: 'output' },
    right: { visible: false, width: 350, activeTab: 'fhir' }
  };
  
  // Editor State
  public cursorPosition?: { line: number; column: number };
  public wordCount?: number;
  public syntaxErrors: string[] = [];
  public isValidSyntax: boolean = true;
  
  // Platform detection
  public isMac: boolean = false;
  
  // Keyboard shortcuts - now as getter methods for reactivity
  public get keyboardShortcuts() {
    return {
      general: [
        { key: this.getKeyCombo('S'), description: 'Save library' },
        { key: this.getKeyCombo('R'), description: 'Reload from server' }
      ],
      editor: [],
      execution: [
        { key: this.getKeyCombo('Enter'), description: 'Execute current library' },
        { key: this.getKeyCombo('Shift+Enter'), description: 'Execute all libraries' }
      ],
      navigation: []
    };
  }
  
  // IDE Features
  public outlineItems: Array<{ name: string; type: string; line: number }> = [];
  public filteredOutlineItems: Array<{ name: string; type: string; line: number }> = [];
  public outlineSearchTerm: string = '';
  public outlineSortBy: 'name' | 'type' | 'line' = 'line';
  public outlineSortOrder: 'asc' | 'desc' = 'asc';
  
  // Execution State
  public isExecuting: boolean = false;
  public executionResults: any = null;
  public outputSections: Array<{
    title: string;
    content: string;
    status: 'success' | 'error' | 'pending';
    executionTime?: number;
    expanded: boolean;
  }> = [];
  public allSectionsExpanded: boolean = false;
  public executionProgress: number = 0;
  public executionStatus: string = '';
  public preserveLogs: boolean = false;

  // FHIR Integration
  public library: Library | null = null;
  public libraryVersion: string = '0.0.0';
  public libraryDescription: string = '';
  public isNewLibrary: boolean = false;
  public hasSelectedLibrary: boolean = false;
  public hasSelectedPatients: boolean = false;
  public evaluationResults: Parameters | null = null;
  public isEvaluating: boolean = false;
  public elmTranslationResults: string | null = null;
  public isTranslating: boolean = false;

  // FHIR Search functionality
  public librarySearchTerm: string = '';
  public librarySearchResults: Library[] = [];
  public isSearchingLibraries: boolean = false;
  public showLibrarySearchResults: boolean = false;
  private librarySearchSubject = new Subject<string>();

  // Paginated Library List functionality
  public paginatedLibraries: Library[] = [];
  public currentPage: number = 1;
  public totalPages: number = 0;
  public totalLibraries: number = 0;
  public pageSize: number = 10;
  public librarySortBy: 'name' | 'version' | 'date' = 'name';
  public librarySortOrder: 'asc' | 'desc' = 'asc';
  public isLoadingLibraries: boolean = false;

  // Expose Math for template use
  public Math = Math;

  public patientSearchTerm: string = '';
  public patientSearchResults: Patient[] = [];
  public isSearchingPatients: boolean = false;
  public showPatientSearchResults: boolean = false;
  private patientSearchSubject = new Subject<string>();

  private editor?: EditorView;
  public _value: string = '';
  private _onChange = (value: string) => {};
  private _onTouched = () => {};
  private grammarManager: CqlGrammarManager;
  private currentFileId: string = '';
  private fileCounter: number = 1;
  private isResizing: boolean = false;
  private resizeType: 'sidebar' | 'bottom' | 'right' | null = null;
  private startX: number = 0;
  private startY: number = 0;
  private startWidth: number = 0;
  private startHeight: number = 0;
  private resizeAnimationFrame: number | null = null;
  
  constructor(
    public router: Router,
    public libraryService: LibraryService,
    public patientService: PatientService,
    public settingsService: SettingsService,
    private translationService: TranslationService
  ) {
    this.grammarManager = new CqlGrammarManager(this.cqlVersion);
    this.setupRouteListener();
    this.setupFhirSearch();
    this.detectPlatform();
  }

  ngAfterViewInit(): void {
    // Use setTimeout to ensure the view is fully rendered
    setTimeout(() => {
      console.log('ngAfterViewInit: libraryResources.length =', this.libraryResources.length);
      console.log('ngAfterViewInit: activeLibraryId =', this.activeLibraryId);
      // Only initialize editor if there are library resources
      if (this.libraryResources.length > 0) {
        console.log('ngAfterViewInit: Initializing editor...');
        this.initializeEditor();
      }
    }, 0);
    this.setupEventListeners();
    this.loadPaginatedLibraries();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cqlVersion'] && !changes['cqlVersion'].firstChange) {
      this.grammarManager.setVersion(this.cqlVersion);
      this.reinitializeEditor();
    }
    // Theme is always dark, no theme change handling needed
  }
  
  ngOnDestroy(): void {
    this.editor?.destroy();
    this.removeEventListeners();
    
    // Cancel any pending animation frame
    if (this.resizeAnimationFrame !== null) {
      cancelAnimationFrame(this.resizeAnimationFrame);
      this.resizeAnimationFrame = null;
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (this.isResizing) {
      // Cancel any pending animation frame
      if (this.resizeAnimationFrame !== null) {
        cancelAnimationFrame(this.resizeAnimationFrame);
      }
      
      // Schedule resize update for next frame
      this.resizeAnimationFrame = requestAnimationFrame(() => {
        this.handleResize(event);
        this.resizeAnimationFrame = null;
      });
    }
  }

  @HostListener('window:mouseup', ['$event'])
  onMouseUp(event: MouseEvent): void {
    if (this.isResizing) {
      this.stopResize();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // IDE keyboard shortcuts
    const isMac = this.isMac;
    const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey;
    const isAlt = event.altKey;
    
    // Only handle shortcuts with Ctrl/Cmd + Alt modifier to avoid conflicts
    if (isCtrlOrCmd && isAlt) {
      switch (event.key.toLowerCase()) {
        case 's':
          event.preventDefault();
          this.saveCql();
          break;
        case 'r':
          event.preventDefault();
          this.reloadLibraryFromServer();
          break;
        case 'enter':
          event.preventDefault();
          if (event.shiftKey) {
            this.executeAll();
          } else {
            this.executeLibrary();
          }
          break;
      }
    }
  }
  
  private initializeEditor(): void {
    console.log('initializeEditor called', {
      hasContainer: !!this.editorContainer?.nativeElement,
      hasEditor: !!this.editor,
      containerDimensions: this.editorContainer?.nativeElement ? {
        width: this.editorContainer.nativeElement.offsetWidth,
        height: this.editorContainer.nativeElement.offsetHeight
      } : null,
      libraryResources: this.libraryResources.length,
      activeLibraryId: this.activeLibraryId,
      value: this._value
    });
    
    if (!this.editorContainer?.nativeElement || this.editor) {
      console.log('initializeEditor: early return', { hasContainer: !!this.editorContainer?.nativeElement, hasEditor: !!this.editor });
      return;
    }
    
    // Ensure the container is visible and has dimensions
    const container = this.editorContainer.nativeElement;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      console.log('initializeEditor: container not ready, retrying...');
      // Retry after a short delay if container is not ready
      setTimeout(() => {
        this.initializeEditor();
      }, 100);
      return;
    }
    
    try {
      console.log('Creating editor with value:', this._value);
      const startState = EditorState.create({
        doc: this._value,
        extensions: [
          basicSetup,
          ...this.grammarManager.createExtensions(), // Use version-aware CQL extensions
          highlightSpecialChars(),
          bracketMatching(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            // Custom CQL shortcuts
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
              height: this.height,
              fontSize: '14px',
              fontFamily: "'Courier New', Courier, monospace"
            },
            '.cm-content': {
              padding: '12px',
              minHeight: this.height,
              color: '#ffffff'
            },
            '.cm-focused': {
              outline: 'none'
            },
            '.cm-editor': {
              border: 'none',
              borderRadius: '0.375rem',
              backgroundColor: '#1e1e1e' // Always dark theme
            },
            '.cm-editor.cm-focused': {
              borderColor: '#0d6efd',
              boxShadow: '0 0 0 0.2rem rgba(13, 110, 253, 0.25)'
            },
            '.cm-placeholder': {
              color: '#6c757d',
              fontStyle: 'italic'
            },
            // Syntax highlighting is now handled by HighlightStyle in the grammar manager
            '.cm-property': {
              color: '#9cdcfe !important'
            },
            '.cm-attribute': {
              color: '#92c5f8 !important'
            },
            '.cm-tag': {
              color: '#569cd6 !important'
            },
            '.cm-builtin': {
              color: '#dcdcaa !important'
            },
            '.cm-constant': {
              color: '#4fc1ff !important'
            },
            '.cm-meta': {
              color: '#569cd6 !important'
            },
            '.cm-def': {
              color: '#dcdcaa !important'
            },
            '.cm-variable-2': {
              color: '#9cdcfe !important'
            },
            '.cm-variable-3': {
              color: '#4ec9b0 !important'
            },
            '.cm-qualifier': {
              color: '#dcdcaa !important'
            },
            '.cm-header': {
              color: '#569cd6 !important'
            },
            '.cm-quote': {
              color: '#6a9955 !important'
            },
            '.cm-hr': {
              color: '#ffffff !important'
            },
            '.cm-link': {
              color: '#569cd6 !important'
            },
            '.cm-url': {
              color: '#ce9178 !important'
            },
            '.cm-strong': {
              color: '#ffffff !important',
              fontWeight: 'bold'
            },
            '.cm-em': {
              color: '#ffffff !important',
              fontStyle: 'italic'
            },
            '.cm-strikethrough': {
              color: '#ffffff !important',
              textDecoration: 'line-through'
            },
            '.cm-error': {
              color: '#f44747 !important',
              backgroundColor: 'rgba(244, 71, 71, 0.1)'
            },
            '.cm-warning': {
              color: '#ffcc02 !important',
              backgroundColor: 'rgba(255, 204, 2, 0.1)'
            },
            '.cm-info': {
              color: '#75beff !important',
              backgroundColor: 'rgba(117, 190, 255, 0.1)'
            },
            '.cm-hint': {
              color: '#6a9955 !important',
              backgroundColor: 'rgba(106, 153, 85, 0.1)'
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newValue = update.state.doc.toString();
              this._value = newValue;
              this._onChange(newValue);
              this.contentChange.emit(newValue);
            }
            
            if (update.selectionSet) {
              const selection = update.state.selection.main;
              const line = update.state.doc.lineAt(selection.from).number;
              const column = selection.from - update.state.doc.lineAt(selection.from).from;
              this.cursorPosition = { line, column };
              this.cursorChange.emit({ line, column });
            }
            
            // Update word count
            const text = update.state.doc.toString();
            this.wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
            
            // Update current file content and dirty state
            const currentFile = this.files.find(f => f.id === this.currentFileId);
            if (currentFile) {
              currentFile.content = text;
              currentFile.isDirty = text !== this.placeholder;
            }
            
            // Update active library resource content and dirty state
            const activeLibrary = this.libraryResources.find(lib => lib.id === this.activeLibraryId);
            if (activeLibrary) {
              activeLibrary.cqlContent = text;
              activeLibrary.isDirty = text !== activeLibrary.originalContent;
            }
            
            // Update outline
            this.updateOutline();
            
            // Validate syntax using official parser
            this.validateSyntax(text);
          }),
          EditorView.domEventHandlers({
            focus: () => this._onTouched()
          })
        ]
      });
      
      this.editor = new EditorView({
        state: startState,
        parent: this.editorContainer.nativeElement
      });
      
      console.log('Editor created successfully:', this.editor);
      
      // Placeholder is set in the editor configuration
      
    } catch (error) {
      console.error('Failed to initialize CQL editor:', error);
    }
  }
  
  // ControlValueAccessor implementation
  writeValue(value: string): void {
    this._value = value || '';
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
  
  registerOnChange(fn: (value: string) => void): void {
    this._onChange = fn;
  }
  
  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }
  
  setDisabledState(isDisabled: boolean): void {
    this.readonly = isDisabled;
    // Disabled state is handled by the readonly property
  }
  
  // Public methods for external control
  getValue(): string {
    return this.editor?.state.doc.toString() || '';
  }
  
  setValue(value: string): void {
    this.writeValue(value);
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
  
  focus(): void {
    this.editor?.focus();
  }
  
  blur(): void {
    this.editor?.contentDOM.blur();
  }
  
  // Formatting methods
  formatCode(): void {
    if (this.editor) {
      const code = this.getValue();
      const formatted = this.formatCqlCode(code);
      this.setValue(formatted);
    }
  }

  clearCode(): void {
    this.setValue('');
  }

  validateSyntax(code: string): void {
    if (!code.trim()) {
      this.syntaxErrors = [];
      this.isValidSyntax = true;
      return;
    }

    const validation = this.grammarManager.validateSyntax(code);
    this.isValidSyntax = validation.isValid;
    this.syntaxErrors = validation.errors;
  }

  private reinitializeEditor(): void {
    if (this.editor) {
      console.log('Reinitializing editor...');
      const currentValue = this.getValue();
      this.editor.destroy();
      this.editor = undefined; // Clear the reference
      this.initializeEditor();
      this.setValue(currentValue);
    }
  }
  
  private formatCqlCode(code: string): string {
    // Enhanced CQL formatting
    let formatted = code;
    
    // Remove extra whitespace and normalize line endings
    formatted = formatted.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Add proper indentation
    const lines = formatted.split('\n');
    const formattedLines: string[] = [];
    let indentLevel = 0;
    const indentSize = 2;
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      // Skip empty lines
      if (!line) {
        formattedLines.push('');
        continue;
      }
      
      // Decrease indent level for closing braces and 'end' keywords
      if (line.startsWith('}') || line.startsWith('end')) {
        indentLevel = Math.max(0, indentLevel - 1);
      }
      
      // Add indentation
      const indent = ' '.repeat(indentLevel * indentSize);
      formattedLines.push(indent + line);
      
      // Increase indent level for opening braces and certain keywords
      if (line.endsWith('{') || 
          line.startsWith('define') || 
          line.startsWith('function') ||
          line.startsWith('if') ||
          line.startsWith('then') ||
          line.startsWith('else') ||
          line.startsWith('where') ||
          line.startsWith('return')) {
        indentLevel++;
      }
    }
    
    formatted = formattedLines.join('\n');
    
    // Add line breaks after semicolons (but not if already on new line)
    formatted = formatted.replace(/;(\s*)(?![ \t]*\n)/g, ';\n$1');
    
    // Add line breaks after opening braces
    formatted = formatted.replace(/\{(\s*)(?![ \t]*\n)/g, '{\n$1');
    
    // Add line breaks before closing braces
    formatted = formatted.replace(/(?<!\n)(\s*)\}/g, '\n$1}');
    
    // Add line breaks after commas in parameter lists (but be careful with strings)
    formatted = formatted.replace(/,(\s*)(?![ \t]*\n)(?![^"]*"[^"]*$)/g, ',\n$1');
    
    // Format library statements
    formatted = formatted.replace(/library\s+([^"]+)\s+version\s+([^"]+)/g, 'library $1 version $2');
    
    // Format define statements
    formatted = formatted.replace(/define\s+([^:]+):\s*/g, 'define $1:\n  ');
    
    // Format function definitions
    formatted = formatted.replace(/define\s+function\s+([^(]+)\(([^)]*)\)\s*:\s*/g, 'define function $1($2):\n  ');
    
    // Format parameter statements
    formatted = formatted.replace(/parameter\s+([^:]+):\s*/g, 'parameter $1: ');
    
    // Format valueset statements
    formatted = formatted.replace(/valueset\s+([^:]+):\s*/g, 'valueset $1: ');
    
    // Format codesystem statements
    formatted = formatted.replace(/codesystem\s+([^:]+):\s*/g, 'codesystem $1: ');
    
    // Format using statements
    formatted = formatted.replace(/using\s+([^"]+)\s+version\s+([^"]+)/g, 'using $1 version $2');
    
    // Format include statements
    formatted = formatted.replace(/include\s+([^"]+)\s+version\s+([^"]+)\s+called\s+([^"]+)/g, 'include $1 version $2 called $3');
    
    // Format context statements
    formatted = formatted.replace(/context\s+([^"]+)/g, 'context $1');
    
    // Clean up multiple consecutive newlines
    formatted = formatted.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Remove trailing whitespace from lines
    formatted = formatted.split('\n').map(line => line.trimEnd()).join('\n');
    
    // Trim overall whitespace
    formatted = formatted.trim();
    
    return formatted;
  }
  
  // Search and replace
  findText(text: string): boolean {
    if (this.editor) {
      const doc = this.editor.state.doc.toString();
      return doc.includes(text);
    }
    return false;
  }
  
  replaceText(searchText: string, replaceText: string): void {
    if (this.editor) {
      const doc = this.editor.state.doc.toString();
      const newDoc = doc.replace(new RegExp(searchText, 'g'), replaceText);
      this.setValue(newDoc);
    }
  }


  // Panel Management
  toggleSidebar(): void {
    this.panelState.sidebar.visible = !this.panelState.sidebar.visible;
  }

  toggleBottomPanel(): void {
    this.panelState.bottom.visible = !this.panelState.bottom.visible;
  }


  setSidebarTab(tab: 'outline' | 'navigation'): void {
    this.panelState.sidebar.activeTab = tab;
  }

  setBottomTab(tab: 'problems' | 'output' | 'dashboard' | 'results' | 'runner' | 'settings'): void {
    this.panelState.bottom.activeTab = tab;
  }

  setRightTab(tab: 'fhir' | 'elm' | 'none'): void {
    this.panelState.right.activeTab = tab;
    if (tab !== 'none') {
      this.panelState.right.visible = true;
    }
  }

  toggleRightPanel(): void {
    this.panelState.right.visible = !this.panelState.right.visible;
  }


  // Theme is always dark, no theme update method needed

  // Resize Handling
  startResize(type: 'sidebar' | 'bottom' | 'right', event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing = true;
    this.resizeType = type;
    this.startX = event.clientX;
    this.startY = event.clientY;
    
    if (type === 'sidebar') {
      this.startWidth = this.panelState.sidebar.width;
    } else if (type === 'right') {
      this.startWidth = this.panelState.right.width;
    } else {
      this.startHeight = this.panelState.bottom.height;
    }
  }

  private handleResize(event: MouseEvent): void {
    if (!this.isResizing || !this.resizeType) return;

    if (this.resizeType === 'sidebar') {
      const deltaX = event.clientX - this.startX;
      const newWidth = Math.max(200, Math.min(800, this.startWidth + deltaX));
      this.panelState.sidebar.width = newWidth;
    } else if (this.resizeType === 'right') {
      const deltaX = this.startX - event.clientX; // Inverted for right panel
      const newWidth = Math.max(200, Math.min(800, this.startWidth + deltaX));
      this.panelState.right.width = newWidth;
    } else if (this.resizeType === 'bottom') {
      const deltaY = this.startY - event.clientY; // Inverted for bottom panel
      const maxHeight = Math.min(window.innerHeight * 0.8, window.innerHeight - 200); // Leave space for header and other UI
      const newHeight = Math.max(100, Math.min(maxHeight, this.startHeight + deltaY));
      this.panelState.bottom.height = newHeight;
    }
  }

  private stopResize(): void {
    this.isResizing = false;
    this.resizeType = null;
    
    // Cancel any pending animation frame
    if (this.resizeAnimationFrame !== null) {
      cancelAnimationFrame(this.resizeAnimationFrame);
      this.resizeAnimationFrame = null;
    }
  }



  // Outline Generation
  private updateOutline(): void {
    this.outlineItems = [];
    const activeLibrary = this.libraryResources.find(lib => lib.id === this.activeLibraryId);
    if (!activeLibrary) {
      // Clear filtered items when no active library
      this.filteredOutlineItems = [];
      return;
    }

    const lines = activeLibrary.cqlContent.split('\n');
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const lineNumber = index + 1; // Convert 0-based index to 1-based line number
      
      if (trimmed.startsWith('library ')) {
        this.outlineItems.push({ name: trimmed, type: 'library', line: lineNumber });
      } else if (trimmed.startsWith('define ')) {
        const name = trimmed.replace('define ', '').split(':')[0].trim();
        this.outlineItems.push({ name, type: 'define', line: lineNumber });
      } else if (trimmed.startsWith('function ')) {
        const name = trimmed.replace('function ', '').split('(')[0].trim();
        this.outlineItems.push({ name, type: 'function', line: lineNumber });
      } else if (trimmed.startsWith('parameter ')) {
        const name = trimmed.replace('parameter ', '').split(':')[0].trim();
        this.outlineItems.push({ name, type: 'parameter', line: lineNumber });
      } else if (trimmed.startsWith('valueset ')) {
        const name = trimmed.replace('valueset ', '').split(':')[0].trim();
        this.outlineItems.push({ name, type: 'valueset', line: lineNumber });
      } else if (trimmed.startsWith('codesystem ')) {
        const name = trimmed.replace('codesystem ', '').split(':')[0].trim();
        this.outlineItems.push({ name, type: 'codesystem', line: lineNumber });
      }
    });
    
    // Update filtered items after generating outline
    this.updateFilteredOutlineItems();
  }

  // Outline Search and Sort
  onOutlineSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.outlineSearchTerm = target.value;
    this.updateFilteredOutlineItems();
  }

  changeOutlineSorting(sortBy: 'name' | 'type' | 'line'): void {
    if (this.outlineSortBy === sortBy) {
      this.outlineSortOrder = this.outlineSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.outlineSortBy = sortBy;
      this.outlineSortOrder = 'asc';
    }
    this.updateFilteredOutlineItems();
  }

  private updateFilteredOutlineItems(): void {
    let filtered = [...this.outlineItems];
    
    // Apply search filter
    if (this.outlineSearchTerm.trim()) {
      const searchTerm = this.outlineSearchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.name.toLowerCase().includes(searchTerm) ||
        item.type.toLowerCase().includes(searchTerm)
      );
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (this.outlineSortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'line':
          comparison = a.line - b.line;
          break;
      }
      
      return this.outlineSortOrder === 'asc' ? comparison : -comparison;
    });
    
    this.filteredOutlineItems = filtered;
  }

  // Route-based Panel Switching
  private setupRouteListener(): void {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.handleRouteChange(event.url);
      });
    
    // Handle initial route
    this.handleRouteChange(this.router.url);
  }

  private handleRouteChange(url: string): void {
    // Remove '/ide' prefix for route mapping
    const cleanUrl = url.replace('/ide', '');
    
    // Map routes to panel tabs
    if (cleanUrl.includes('/dashboard')) {
      this.setBottomTab('dashboard');
    } else if (cleanUrl.includes('/results')) {
      this.setBottomTab('results');
    } else if (cleanUrl.includes('/runner')) {
      this.setBottomTab('runner');
    } else if (cleanUrl.includes('/settings')) {
      this.setBottomTab('settings');
    } else if (cleanUrl.includes('/ide')) {
      this.setRightTab('fhir');
      // Auto-open right panel for FHIR
      this.panelState.right.visible = true;
      // Also open bottom panel for evaluation results
      this.panelState.bottom.visible = true;
      this.setBottomTab('dashboard');
      // Open sidebar for better navigation
      this.panelState.sidebar.visible = true;
    } else if (cleanUrl.includes('/elm')) {
      this.setRightTab('elm');
      this.panelState.right.visible = true;
    } else {
      // Default to dashboard for root path
      this.setBottomTab('dashboard');
    }
  }

  // FHIR Search Setup
  private setupFhirSearch(): void {
    // Set up library search with debouncing
    this.librarySearchSubject.pipe(
      debounceTime(100),
      distinctUntilChanged(),
      switchMap(searchTerm => {
        if (searchTerm.trim()) {
          this.isSearchingLibraries = true;
          return this.libraryService.search(searchTerm);
        } else {
          this.isSearchingLibraries = false;
          this.showLibrarySearchResults = false;
          this.librarySearchResults = [];
          return [];
        }
      })
    ).subscribe({
      next: (bundle: Bundle<Library>) => {
        this.isSearchingLibraries = false;
        if (bundle.entry && bundle.entry.length > 0) {
          this.librarySearchResults = bundle.entry.map(entry => entry.resource!);
          this.showLibrarySearchResults = true;
        } else if (this.librarySearchTerm.trim()) {
          this.librarySearchResults = [];
          this.showLibrarySearchResults = true;
        }
      },
      error: (error: any) => {
        this.isSearchingLibraries = false;
        console.error('Error searching libraries:', error);
      }
    });

    // Set up patient search with debouncing
    this.patientSearchSubject.pipe(
      debounceTime(100),
      distinctUntilChanged(),
      switchMap(searchTerm => {
        if (searchTerm.trim()) {
          this.isSearchingPatients = true;
          return this.patientService.search(searchTerm);
        } else {
          this.isSearchingPatients = false;
          this.showPatientSearchResults = false;
          this.patientSearchResults = [];
          return [];
        }
      })
    ).subscribe({
      next: (bundle: Bundle<Patient>) => {
        this.isSearchingPatients = false;
        if (bundle.entry && bundle.entry.length > 0) {
          this.patientSearchResults = bundle.entry.map(entry => entry.resource!);
          this.showPatientSearchResults = true;
        } else if (this.patientSearchTerm.trim()) {
          this.patientSearchResults = [];
          this.showPatientSearchResults = true;
        }
      },
      error: (error: any) => {
        this.isSearchingPatients = false;
        console.error('Error searching patients:', error);
      }
    });
  }

  // Library Resource Management
  trackByLibraryId(index: number, library: LibraryResource): string {
    return library.id;
  }

  trackByPatientId(index: number, patient: Patient): string {
    return patient.id || index.toString();
  }

  trackByOutlineItem(index: number, item: { name: string; type: string; line: number }): string {
    return `${item.type}-${item.line}-${item.name}`;
  }

  selectLibraryResource(libraryId: string): void {
    console.log('selectLibraryResource called with:', libraryId);
    
    // Update active library
    this.libraryResources.forEach(lib => lib.isActive = lib.id === libraryId);
    this.activeLibraryId = libraryId;
    
    // Update editor content
    const library = this.libraryResources.find(lib => lib.id === libraryId);
    if (library) {
      console.log('Library found:', library);
      this._value = library.cqlContent;
      this.libraryService.libraryId = library.name;
      this.libraryVersion = library.version;
      this.libraryDescription = library.description;
      this.library = library.library;
      this.hasSelectedLibrary = true;
      this.isNewLibrary = !library.library;
      
      // Update editor if it exists, or initialize if it doesn't
      if (this.editor) {
        console.log('Editor exists, setting value');
        this.setValue(library.cqlContent);
      } else {
        console.log('Editor does not exist, initializing...');
        // Ensure editor initializes if it hasn't yet
        setTimeout(() => {
          this.initializeEditor();
        }, 100);
      }
      
      // Update outline for the new library
      this.updateOutline();
    } else {
      console.log('Library not found for ID:', libraryId);
    }
  }

  addLibraryFromSearch(library: Library): void {
    if (library.id && !this.libraryResources.find(lib => lib.id === library.id)) {
      // Extract CQL content from the FHIR library
      let cqlContent = '';
      if (library.content) {
        for (const content of library.content) {
          if (content.contentType === 'text/cql' && content.data) {
            try {
              cqlContent = atob(content.data);
              break; // Use the first CQL content found
            } catch (e) {
              console.error('Error decoding CQL content:', e);
            }
          }
        }
      }
      
      const libraryResource: LibraryResource = {
        id: library.id,
        name: library.name || library.id,
        version: library.version || '1.0.0',
        description: library.description || `Library ${library.name || library.id}`,
        cqlContent: cqlContent,
        originalContent: cqlContent,
        isActive: false,
        isDirty: false,
        library: library
      };
      
      this.libraryResources.push(libraryResource);
      this.selectLibraryResource(library.id);
      this.clearLibrarySearch();
    }
  }

  createNewLibraryResource(): void {
    console.log('createNewLibraryResource called');
    const newId = `new-library-${Date.now()}`;
    const libraryResource: LibraryResource = {
      id: newId,
      name: 'New Library',
      version: '1.0.0',
      description: 'New library',
      cqlContent: '',
      originalContent: '',
      isActive: false,
      isDirty: false,
      library: null
    };
    
    this.libraryResources.push(libraryResource);
    console.log('Library resource added, selecting...');
    this.selectLibraryResource(newId);
    
    // Ensure editor initializes after library is created
    setTimeout(() => {
      if (!this.editor) {
        console.log('Editor still not initialized, forcing initialization...');
        this.initializeEditor();
      }
    }, 100);
  }

  removeLibraryResource(libraryId: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    
    const index = this.libraryResources.findIndex(lib => lib.id === libraryId);
    if (index !== -1) {
      this.libraryResources.splice(index, 1);
      
      // If we removed the active library, select another one or clear
      if (libraryId === this.activeLibraryId) {
        if (this.libraryResources.length > 0) {
          this.selectLibraryResource(this.libraryResources[0].id);
        } else {
          this.clearActiveLibrary();
        }
      } else {
        // If we removed a different library, update outline for current active library
        this.updateOutline();
      }
    }
  }

  private clearActiveLibrary(): void {
    this.activeLibraryId = '';
    this._value = '';
    this.libraryService.libraryId = '';
    this.libraryVersion = '1.0.0';
    this.libraryDescription = '';
    this.library = null;
    this.hasSelectedLibrary = false;
    this.isNewLibrary = false;
    
    if (this.editor) {
      this.editor.dispatch({
        changes: {
          from: 0,
          to: this.editor.state.doc.length,
          insert: ''
        }
      });
    }
    
    // Clear outline when no library is active
    this.updateOutline();
  }

  // FHIR Library Methods
  onLibrarySearchInput(event: any): void {
    const searchTerm = event.target.value;
    this.librarySearchTerm = searchTerm;
    this.librarySearchSubject.next(searchTerm);
  }

  selectLibrary(library: Library): void {
    if (library.id) {
      this.libraryService.libraryId = library.id;
      this.showLibrarySearchResults = false;
      this.librarySearchTerm = '';
      this.librarySearchResults = [];
      
      this.isNewLibrary = false;
      this.hasSelectedLibrary = true;
      this.library = library;
      
      this.reloadLibraryFromServer();
    }
  }

  clearLibrarySearch(): void {
    this.librarySearchTerm = '';
    this.librarySearchResults = [];
    this.showLibrarySearchResults = false;
    this.isSearchingLibraries = false;
    this.librarySearchSubject.next('');
  }

  // Paginated Library List Methods
  loadPaginatedLibraries(): void {
    this.isLoadingLibraries = true;
    this.libraryService.getAll(this.currentPage, this.pageSize, this.librarySortBy, this.librarySortOrder).subscribe({
      next: (bundle: Bundle<Library>) => {
        this.isLoadingLibraries = false;
        this.paginatedLibraries = bundle.entry ? bundle.entry.map(entry => entry.resource!) : [];
        
        // Calculate total pages from total count
        if (bundle.total) {
          this.totalLibraries = bundle.total;
          this.totalPages = Math.ceil(bundle.total / this.pageSize);
        } else {
          this.totalLibraries = this.paginatedLibraries.length;
          this.totalPages = 1;
        }
      },
      error: (error: any) => {
        this.isLoadingLibraries = false;
        console.error('Error loading paginated libraries:', error);
        this.paginatedLibraries = [];
        this.totalPages = 0;
        this.totalLibraries = 0;
      }
    });
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.currentPage = page;
      this.loadPaginatedLibraries();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.goToPage(this.currentPage + 1);
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.goToPage(this.currentPage - 1);
    }
  }

  changePageSize(newPageSize: number): void {
    this.pageSize = newPageSize;
    this.currentPage = 1;
    this.loadPaginatedLibraries();
  }

  changeSorting(sortBy: 'name' | 'version' | 'date'): void {
    if (this.librarySortBy === sortBy) {
      // Toggle order if same sort field
      this.librarySortOrder = this.librarySortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      // Change sort field and reset to ascending
      this.librarySortBy = sortBy;
      this.librarySortOrder = 'asc';
    }
    this.currentPage = 1;
    this.loadPaginatedLibraries();
  }

  addLibraryFromPaginatedList(library: Library): void {
    if (library.id && !this.libraryResources.find(lib => lib.id === library.id)) {
      // Extract CQL content from the FHIR library
      let cqlContent = '';
      if (library.content) {
        for (const content of library.content) {
          if (content.contentType === 'text/cql' && content.data) {
            try {
              cqlContent = atob(content.data);
              break; // Use the first CQL content found
            } catch (e) {
              console.error('Error decoding CQL content:', e);
            }
          }
        }
      }
      
      const libraryResource: LibraryResource = {
        id: library.id,
        name: library.name || library.id,
        version: library.version || '1.0.0',
        description: library.description || `Library ${library.name || library.id}`,
        cqlContent: cqlContent,
        originalContent: cqlContent,
        isActive: false,
        isDirty: false,
        library: library
      };
      
      this.libraryResources.push(libraryResource);
      this.selectLibraryResource(library.id);
    }
  }

  getLibraryDisplayName(library: Library): string {
    return library.name || library.id || 'Unknown';
  }

  getLibraryVersion(library: Library): string {
    return library.version || 'N/A';
  }

  getLibraryDescription(library: Library): string {
    return library.description || 'No description available';
  }

  getPageNumbers(): (number | string)[] {
    const pages: (number | string)[] = [];
    const maxVisiblePages = 5;
    
    if (this.totalPages <= maxVisiblePages) {
      // Show all pages if total is small
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show first page
      pages.push(1);
      
      if (this.currentPage > 3) {
        pages.push('...');
      }
      
      // Show pages around current page
      const start = Math.max(2, this.currentPage - 1);
      const end = Math.min(this.totalPages - 1, this.currentPage + 1);
      
      for (let i = start; i <= end; i++) {
        if (i !== 1 && i !== this.totalPages) {
          pages.push(i);
        }
      }
      
      if (this.currentPage < this.totalPages - 2) {
        pages.push('...');
      }
      
      // Show last page
      if (this.totalPages > 1) {
        pages.push(this.totalPages);
      }
    }
    
    return pages;
  }

  onPageClick(page: number | string): void {
    if (typeof page === 'number') {
      this.goToPage(page);
    }
  }

  createNewLibrary(): void {
    this.libraryService.libraryId = '';
    this.libraryVersion = '0.0.0';
    this.libraryDescription = '';
    this._value = '';
    
    this.library = {
      resourceType: 'Library',
      type: {},
      id: '',
      version: this.libraryVersion,
      name: '',
      title: '',
      status: 'draft',
      description: this.libraryDescription,
      url: '',
      content: []
    };
    
    this.isNewLibrary = true;
    this.hasSelectedLibrary = true;
    this.clearLibrarySearch();
  }

  clearLibrarySelection(): void {
    this.library = null;
    this.libraryService.libraryId = '';
    this.libraryVersion = '0.0.0';
    this.libraryDescription = '';
    this._value = '';
    this.isNewLibrary = false;
    this.hasSelectedLibrary = false;
    this.clearLibrarySearch();
  }

  reloadLibraryFromServer(): void {
    this.libraryService.get(this.libraryService.libraryId).subscribe({
      next: (library: Library) => {
        this.library = library;
        this.decodeLibraryData();
        console.log('Library loaded:', library);
        
        // Update the active library resource to reflect reloaded state
        const activeLibrary = this.libraryResources.find(lib => lib.id === this.activeLibraryId);
        if (activeLibrary) {
          activeLibrary.originalContent = this._value;
          activeLibrary.isDirty = false;
          activeLibrary.library = library;
        }
      },
      error: (error: any) => {
        this.library = null;
        console.error('Error loading library:', error);
      }
    });
  }

  decodeLibraryData(): void {
    if (this.library?.name) {
      this.libraryService.libraryId = this.library.name;
    } else {
      this.libraryService.libraryId = '';
    }
    if (this.library?.version) {
      this.libraryVersion = this.library.version;
    } else {
      this.libraryVersion = '0.0.0';
    }
    if (this.library?.description) {
      this.libraryDescription = this.library.description;
    } else {
      this.libraryDescription = `Logic Library for ${this.libraryService.libraryId}`;
    }
    if (this.library && this.library.content) {
      for (const content of this.library.content) {
        if (content.contentType === 'text/cql' && content.data) {
          try {
            this._value = atob(content.data);
            if (this.editor) {
              this.editor.dispatch({
                changes: {
                  from: 0,
                  to: this.editor.state.doc.length,
                  insert: this._value
                }
              });
            }
          } catch (e) {
            console.error('Error decoding CQL:', e);
          }
        }
      }
    }
  }

  // FHIR Patient Methods
  onPatientSearchInput(event: any): void {
    const searchTerm = event.target.value;
    this.patientSearchTerm = searchTerm;
    this.patientSearchSubject.next(searchTerm);
  }

  selectPatient(patient: Patient): void {
    if (patient.id) {
      this.patientService.addPatient(patient);
      this.showPatientSearchResults = false;
      this.patientSearchTerm = '';
      this.patientSearchResults = [];
      this.hasSelectedPatients = this.patientService.selectedPatients.length > 0;
    }
  }

  clearPatientSearch(): void {
    this.patientSearchTerm = '';
    this.patientSearchResults = [];
    this.showPatientSearchResults = false;
    this.isSearchingPatients = false;
    this.patientSearchSubject.next('');
  }

  clearPatientSelection(): void {
    this.patientService.clearSelection();
    this.hasSelectedPatients = false;
    this.clearPatientSearch();
    this.evaluationResults = null;
  }

  removePatient(patientId: string): void {
    this.patientService.removePatient(patientId);
    this.hasSelectedPatients = this.patientService.selectedPatients.length > 0;
    if (!this.hasSelectedPatients) {
      this.evaluationResults = null;
    }
  }

  getPatientDisplayName(patient: Patient): string {
    if (patient.name && patient.name.length > 0) {
      const name = patient.name[0];
      const given = name.given ? name.given.join(' ') : '';
      const family = name.family || '';
      return `${given} ${family}`.trim() || patient.id || 'Unknown';
    }
    return patient.id || 'Unknown';
  }

  getCurrentFhirUrl(): string {
    return this.settingsService.getEffectiveFhirBaseUrl();
  }

  get enableElmTranslation(): boolean {
    return this.settingsService.settings().enableElmTranslation;
  }

  // Evaluation Methods
  canEvaluate(): boolean {
    return this.hasSelectedLibrary && this.hasSelectedPatients && !this.isNewLibrary;
  }

  canShowEvaluationUI(): boolean {
    return this.libraryResources.length > 0;
  }

  canExecuteAll(): boolean {
    return this.libraryResources.length > 0;
  }

  evaluateLibrary(): void {
    if (!this.canEvaluate()) {
      console.error('Please select both a library and at least one patient before evaluating.');
      return;
    }

    if (!this.libraryService.libraryId || this.patientService.selectedPatients.length === 0) {
      console.error('Missing library ID or patient selection for evaluation.');
      return;
    }

    this.isEvaluating = true;
    this.evaluationResults = null;

    // Create parameters for evaluation with patient context
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: [
        {
          name: 'subject',
          valueString: `Patient/${this.patientService.selectedPatients[0].id}`
        }
      ]
    };

    this.libraryService.evaluate(
      this.libraryService.libraryId,
      parameters
    ).subscribe({
      next: (results: Parameters) => {
        this.isEvaluating = false;
        this.evaluationResults = results;
      },
      error: (error: any) => {
        this.isEvaluating = false;
        console.error('Error evaluating library:', error);
      }
    });
  }

  executeAll(): void {
    if (!this.canExecuteAll()) {
      console.error('Please ensure you have at least one library selected.');
      return;
    }

    this.isEvaluating = true;
    this.evaluationResults = null;
    
    // Switch to output tab to show results
    this.setBottomTab('output');
    
    // Clear previous output if preserve logs is disabled
    if (!this.preserveLogs) {
      this.clearOutput();
    }
    
    // Get all selected patients
    const patients = this.patientService.selectedPatients;
    

    // Execute all library-patient combinations
    this.executeAllCombinations(patients);
  }

  private executeAllCombinations(patients: Patient[]): void {
    const allResults: Array<{
      libraryId: string;
      libraryName: string;
      patientId: string;
      patientName: string;
      result?: any;
      error?: any;
      executionTime: number;
    }> = [];

    let completedExecutions = 0;
    const totalExecutions = this.libraryResources.length * Math.max(patients.length, 1);
    const startTime = Date.now();


    this.libraryResources.forEach((library, libraryIndex) => {
      if (patients.length > 0) {
        // Execute with patients
        patients.forEach((patient, patientIndex) => {
          const executionStartTime = Date.now();
          
          const parameters: Parameters = {
            resourceType: 'Parameters',
            parameter: [
              {
                name: 'subject',
                valueString: `Patient/${patient.id}`
              }
            ]
          };

          this.executeLibraryWithParameters(library, parameters, patient, executionStartTime, allResults, () => {
            completedExecutions++;
            this.updateExecutionProgress(completedExecutions, totalExecutions, allResults);
            
            if (completedExecutions === totalExecutions) {
              this.finalizeExecutionResults(allResults, Date.now() - startTime);
            }
          });
        });
      } else {
        // Execute without patients
        const executionStartTime = Date.now();
        
        const parameters: Parameters = {
          resourceType: 'Parameters',
          parameter: []
        };

        this.executeLibraryWithParameters(library, parameters, null, executionStartTime, allResults, () => {
          completedExecutions++;
          this.updateExecutionProgress(completedExecutions, totalExecutions, allResults);
          
          if (completedExecutions === totalExecutions) {
            this.finalizeExecutionResults(allResults, Date.now() - startTime);
          }
        });
      }
    });
  }

  private executeLibraryWithParameters(
    library: LibraryResource, 
    parameters: Parameters, 
    patient: Patient | null, 
    executionStartTime: number, 
    allResults: any[], 
    onComplete: () => void
  ): void {
    // Use the library's name as the library ID for evaluation
    this.libraryService.evaluate(
      library.name || library.id,
      parameters
    ).subscribe({
      next: (response: any) => {
        const executionTime = Date.now() - executionStartTime;
        allResults.push({
          libraryId: library.id,
          libraryName: library.name || library.id,
          patientId: patient?.id || 'no-patient',
          patientName: patient ? this.getPatientDisplayName(patient) : 'No Patient',
          result: response,
          executionTime: executionTime
        });
        
        onComplete();
      },
      error: (error: any) => {
        const executionTime = Date.now() - executionStartTime;
        allResults.push({
          libraryId: library.id,
          libraryName: library.name || library.id,
          patientId: patient?.id || 'no-patient',
          patientName: patient ? this.getPatientDisplayName(patient) : 'No Patient',
          error: error,
          executionTime: executionTime
        });
        
        onComplete();
      }
    });
  }

  private updateExecutionProgress(completed: number, total: number, results: any[]): void {
    const progress = Math.round((completed / total) * 100);
    this.executionProgress = progress;
    this.executionStatus = `Executing: ${completed}/${total} (${progress}%)`;
    
    // Update output sections with current progress
    this.createOutputSections(results);
  }

  private finalizeExecutionResults(results: any[], totalTime: number): void {
    this.isEvaluating = false;
    this.evaluationResults = {
      resourceType: 'Parameters',
      parameter: results
    };
    this.executionProgress = 100;
    this.executionStatus = 'Execution Complete';
    
    // Create final output sections
    this.createOutputSections(results);
  }

  private formatAllExecutionResults(results: any[], totalTime: number): string {
    let output = '';
    
    output += `=== EXECUTION COMPLETE ===\n`;
    output += `Total Time: ${totalTime}ms\n`;
    output += `Libraries: ${this.libraryResources.length}\n`;
    output += `Patients: ${results.length > 0 ? new Set(results.map(r => r.patientId)).size : 0}\n`;
    output += `Combinations: ${results.length}\n\n`;
    
    // Group results by library
    const resultsByLibrary = results.reduce((acc: Record<string, any[]>, result: any) => {
      if (!acc[result.libraryName]) {
        acc[result.libraryName] = [];
      }
      acc[result.libraryName].push(result);
      return acc;
    }, {} as Record<string, any[]>);
    
    Object.keys(resultsByLibrary).forEach((libraryName: string, libraryIndex: number) => {
      const libraryResults = resultsByLibrary[libraryName];
      const successCount = libraryResults.filter((r: any) => !r.error).length;
      const errorCount = libraryResults.filter((r: any) => r.error).length;
      
      output += `LIBRARY ${libraryIndex + 1}: ${libraryName}\n`;
      output += `   Results: ${successCount} success, ${errorCount} errors\n`;
      output += `   Average Time: ${Math.round(libraryResults.reduce((sum: number, r: any) => sum + r.executionTime, 0) / libraryResults.length)}ms\n\n`;
      
      libraryResults.forEach((result: any, resultIndex: number) => {
        output += `   PATIENT ${resultIndex + 1}: ${result.patientName} (${result.patientId})\n`;
        output += `      Time: ${result.executionTime}ms\n`;
        
        if (result.error) {
          output += `      Status: ERROR\n`;
          output += `      Error: ${JSON.stringify(result.error, null, 6).split('\n').map(line => '         ' + line).join('\n')}\n`;
        } else {
          output += `      Status: SUCCESS\n`;
          output += `      Result: ${JSON.stringify(result.result, null, 6).split('\n').map(line => '         ' + line).join('\n')}\n`;
        }
        output += `\n`;
      });
      
      output += `\n`;
    });
    
    output += `Execution completed at: ${new Date().toLocaleString()}\n`;
    
    return output;
  }

  // Output Panel Methods
  clearOutput(): void {
    this.outputSections = [];
    this.executionProgress = 0;
    this.executionStatus = '';
  }

  copyOutput(): void {
    const outputText = this.outputSections.map(section => 
      `${section.title}\n${section.content}\n`
    ).join('\n---\n\n');
    
    navigator.clipboard.writeText(outputText).then(() => {
      console.log('Output copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy output:', err);
    });
  }

  toggleAllSections(): void {
    this.allSectionsExpanded = !this.allSectionsExpanded;
    this.outputSections.forEach(section => {
      section.expanded = this.allSectionsExpanded;
    });
  }

  toggleSection(index: number): void {
    if (index >= 0 && index < this.outputSections.length) {
      this.outputSections[index].expanded = !this.outputSections[index].expanded;
    }
  }

  private createOutputSections(results: any[]): void {
    this.outputSections = [];
    
    // Group results by library-patient combinations
    const resultsByCombination = results.reduce((acc: Record<string, any[]>, result: any) => {
      const key = `${result.libraryName}|${result.patientId}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(result);
      return acc;
    }, {} as Record<string, any[]>);
    
    Object.keys(resultsByCombination).forEach((combinationKey: string) => {
      const combinationResults = resultsByCombination[combinationKey];
      const [libraryName, patientId] = combinationKey.split('|');
      const hasErrors = combinationResults.some((r: any) => r.error);
      
      // Create a single section for each library-patient combination
      const title = patientId === 'no-patient' 
        ? `Library: ${libraryName} (No Patient)`
        : `Library: ${libraryName} - Patient: ${combinationResults[0].patientName} (${patientId})`;
      
      this.outputSections.push({
        title: title,
        content: this.createCombinationContent(libraryName, combinationResults),
        status: hasErrors ? 'error' : 'success',
        executionTime: combinationResults.reduce((sum: number, r: any) => sum + r.executionTime, 0),
        expanded: false
      });
    });
  }


  private createCombinationContent(libraryName: string, results: any[]): string {
    // Check if this is a no-patient execution
    const hasNoPatient = results.some((r: any) => r.patientId === 'no-patient');
    
    let content = '';
    
    if (hasNoPatient) {
      content = results.map((r: any, i: number) => {
        if (r.error) {
          return `Error:
${JSON.stringify(r.error, null, 2)}`;
        } else {
          return `Result:
${JSON.stringify(r.result, null, 2)}`;
        }
      }).join('\n\n');
    } else {
      const patientName = results[0].patientName;
      const patientId = results[0].patientId;
      
      content = results.map((r: any, i: number) => {
        if (r.error) {
          return `Error:
${JSON.stringify(r.error, null, 2)}`;
        } else {
          return `Result:
${JSON.stringify(r.result, null, 2)}`;
        }
      }).join('\n\n');
    }
    
    return content;
  }

  private createPatientContent(result: any): string {
    if (result.error) {
      return `Patient: ${result.patientName} (${result.patientId})
Library: ${result.libraryName}
Status: ERROR
Execution Time: ${result.executionTime}ms

Error Details:
${JSON.stringify(result.error, null, 2)}`;
    } else {
      return `Patient: ${result.patientName} (${result.patientId})
Library: ${result.libraryName}
Status: SUCCESS
Execution Time: ${result.executionTime}ms

Result:
${JSON.stringify(result.result, null, 2)}`;
    }
  }

  evaluationResultsAsString(): string {
    return this.evaluationResults ? JSON.stringify(this.evaluationResults, null, 2) : '';
  }

  patientAsString(patient?: Patient): string {
    const targetPatient = patient || this.patientService.selectedPatient;
    if (targetPatient) {
      return JSON.stringify(targetPatient, null, 2);
    }
    return '';
  }

  // Library Management Methods
  libraryAsString(): string {
    let s = '';
    if (this.library) {
      // Create a copy of the library object with current form values
      const libraryCopy = { ...this.library };
      libraryCopy.id = this.libraryService.libraryId || '';
      libraryCopy.name = this.libraryService.libraryId || '';
      libraryCopy.title = this.libraryService.libraryId || '';
      libraryCopy.version = this.libraryVersion || '';
      libraryCopy.description = this.libraryDescription || '';
      libraryCopy.url = this.libraryService.urlFor(this.libraryService.libraryId || '');
      
      // Update content if CQL is present
      if (this._value && this._value.trim()) {
        libraryCopy.content = [{
          contentType: 'text/cql',
          data: btoa(this._value)
        }];
      } else {
        libraryCopy.content = [];
      }
      
      s = JSON.stringify(libraryCopy, null, 2);
    }
    return s;
  }

  extractVersionFromCql(cql: string): string | null {
    const versionRegex = /library.*version\s+['"]([^'"]+)['"]/; // Match version in single or double quotes
    const match = cql.match(versionRegex);
    let version = null;
    if (match?.length && match.length >= 2) {
      version = match[1];
    }
    return version;
  }

  saveCql(): void {
    if (this._value) {
      let bundle = this.buildFHIRBundle(
        this.libraryService.libraryId,
        this.libraryVersion,
        this.libraryDescription,
        this._value);
      this.libraryService.put(bundle).subscribe({
        next: (response: any) => {
          console.log('Library saved successfully:', response);
          this.library = response; // Update the local library reference
          this.isNewLibrary = false; // After saving, it's no longer a new library
          
          // Update the active library resource to reflect saved state
          const activeLibrary = this.libraryResources.find(lib => lib.id === this.activeLibraryId);
          if (activeLibrary) {
            activeLibrary.originalContent = this._value;
            activeLibrary.isDirty = false;
            activeLibrary.library = response;
          }
        }, error: (error: any) => {
          console.error('Error saving library:', error);
        }
      });
    }
  }

  deleteCql(): void {
    if (this.library) {
      this.libraryService.delete(this.library).subscribe({
        next: (response: any) => {
          console.log('Library deleted successfully:', response);
          this.library = null; // Clear the local library reference
          this.hasSelectedLibrary = false; // Reset selection state
          this.isNewLibrary = false; // Reset new library state
          this.decodeLibraryData(); // Reset the decoded data to defaults
        }, error: (error: any) => {
          console.error('Error deleting library:', error);
        }
      });
    } else {
      console.error('No library ID set. Please provide a valid library ID before deleting.');
    }
  }

  buildFHIRBundle(libraryName: string, version: string, description: string, cql: string) {
    let encoded = btoa(cql); // Ensure cql is base64 encoded
    const libraryResource: Library = {
      resourceType: 'Library',
      type: {},
      id: libraryName,
      version: version,
      name: libraryName,
      title: libraryName,
      status: 'active',
      description: description,
      url: this.libraryService.urlFor(libraryName),
      content: [
        {
          contentType: 'text/cql',
          data: encoded, // Use base64 encoded CQL
        },
      ],
    };
    return libraryResource;
  }

  isFormValid(): boolean {
    return !!(
      this.libraryService.libraryId?.trim() &&
      this.libraryVersion?.trim() &&
      this.libraryDescription?.trim() &&
      this._value?.trim()
    );
  }

  // ELM Translation Methods
  translateCqlToElm(): void {
    if (!this._value || !this._value.trim()) {
      console.error('No CQL content to translate.');
      return;
    }

    const translationBaseUrl = this.settingsService.getEffectiveTranslationBaseUrl();
    
    this.isTranslating = true;
    this.elmTranslationResults = null;

    this.translationService.translateCqlToElm(this._value, translationBaseUrl).subscribe({
      next: (elmXml: string) => {
        this.isTranslating = false;
        this.elmTranslationResults = elmXml;
        console.log('CQL translated to ELM successfully');
      },
      error: (error: any) => {
        this.isTranslating = false;
        console.error('Error translating CQL to ELM:', error);
      }
    });
  }

  elmTranslationResultsAsString(): string {
    return this.elmTranslationResults || '';
  }

  clearElmTranslation(): void {
    this.elmTranslationResults = null;
  }

  // CQL Editor Methods
  onCqlContentChange(content: string): void {
    this._value = content;
  }

  onCqlVersionChange(version: CqlVersion): void {
    this.cqlVersion = version;
    this.grammarManager.setVersion(this.cqlVersion);
    this.reinitializeEditor();
  }

  formatCqlCodeInEditor(): void {
    if (this.editor) {
      this.formatCode();
    }
  }


  validateCqlCodeInEditor(): void {
    if (this.editor) {
      this.validateSyntax(this._value || '');
    }
  }

  // Public method to force editor initialization (for debugging)
  forceInitializeEditor(): void {
    console.log('Force initializing editor...');
    if (this.editor) {
      this.editor.destroy();
      this.editor = undefined;
    }
    this.initializeEditor();
  }

  // Navigate to a specific line in the editor
  navigateToLine(lineNumber: number): void {
    if (!this.editor) {
      console.warn('Editor not available for navigation');
      return;
    }

    try {
      // Convert 1-based line number to 0-based position
      const line = this.editor.state.doc.line(lineNumber);
      const position = line.from;
      
      // Set cursor position and scroll to line
      this.editor.dispatch({
        selection: { anchor: position, head: position },
        scrollIntoView: true
      });
      
      // Focus the editor
      this.editor.focus();
      
      console.log(`Navigated to line ${lineNumber}`);
    } catch (error) {
      console.error(`Failed to navigate to line ${lineNumber}:`, error);
    }
  }

  // Handle outline item click
  onOutlineItemClick(item: { name: string; type: string; line: number }): void {
    console.log('Outline item clicked:', item);
    this.navigateToLine(item.line);
  }

  // Execution Methods
  canExecute(): boolean {
    return !!(this._value && this._value.trim() && this.libraryService.libraryId);
  }

  executeLibrary(): void {
    if (!this.canExecute() || this.isExecuting) {
      return;
    }

    this.isExecuting = true;
    this.executionResults = null;
    
    // Switch to output tab to show results
    this.setBottomTab('output');
    
    // Clear previous output if preserve logs is disabled
    if (!this.preserveLogs) {
      this.clearOutput();
    }
    
    // Get selected patient
    const selectedPatient = this.patientService.selectedPatient;
    
    if (!selectedPatient) {
      // Execute without patient context
      this.executeLibraryWithoutPatient();
    } else {
      // Execute for the selected patient
      this.executeLibraryForPatients([selectedPatient]);
    }
  }

  private executeLibraryWithoutPatient(): void {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };

    const executionStartTime = Date.now();
    const sectionId = `execution-${Date.now()}`;
    
    // Add execution section
    this.outputSections.push({
      title: `Library Execution (${this.libraryService.libraryId})`,
      content: 'Executing library without patient context...',
      status: 'pending',
      expanded: true
    });

    this.libraryService.evaluate(
      this.libraryService.libraryId,
      parameters
    ).subscribe({
      next: (response: any) => {
        this.isExecuting = false;
        this.executionResults = response;
        const executionTime = Date.now() - executionStartTime;
        
        // Update the section with results
        const sectionIndex = this.outputSections.findIndex(s => s.title.includes('Library Execution'));
        if (sectionIndex !== -1) {
          this.outputSections[sectionIndex] = {
            title: `Library Execution (${this.libraryService.libraryId})`,
            content: this.formatExecutionResults(response, null),
            status: 'success',
            executionTime: executionTime,
            expanded: true
          };
        }
      },
      error: (error: any) => {
        this.isExecuting = false;
        const executionTime = Date.now() - executionStartTime;
        
        // Update the section with error
        const sectionIndex = this.outputSections.findIndex(s => s.title.includes('Library Execution'));
        if (sectionIndex !== -1) {
          this.outputSections[sectionIndex] = {
            title: `Library Execution (${this.libraryService.libraryId})`,
            content: `Execution failed:\n${JSON.stringify(error, null, 2)}`,
            status: 'error',
            executionTime: executionTime,
            expanded: true
          };
        }
        console.error('Library execution error:', error);
      }
    });
  }

  private executeLibraryForPatients(patients: Patient[]): void {
    let completedExecutions = 0;
    const totalExecutions = patients.length;
    const allResults: any[] = [];
    const executionStartTime = Date.now();

    // Add execution section
    this.outputSections.push({
      title: `Library Execution (${this.libraryService.libraryId}) - ${totalExecutions} patient(s)`,
      content: `Executing library for ${totalExecutions} patient(s)...`,
      status: 'pending',
      expanded: true
    });

    patients.forEach((patient, index) => {
      const parameters: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          {
            name: 'subject',
            valueString: `Patient/${patient.id}`
          }
        ]
      };

      this.libraryService.evaluate(
        this.libraryService.libraryId,
        parameters
      ).subscribe({
        next: (response: any) => {
          allResults.push({
            patientId: patient.id,
            patientName: this.getPatientDisplayName(patient),
            result: response
          });
          
          completedExecutions++;
          
          if (completedExecutions === totalExecutions) {
            this.isExecuting = false;
            this.executionResults = allResults;
            const executionTime = Date.now() - executionStartTime;
            
            // Update the section with results
            const sectionIndex = this.outputSections.findIndex(s => s.title.includes('Library Execution'));
            if (sectionIndex !== -1) {
              this.outputSections[sectionIndex] = {
                title: `Library Execution (${this.libraryService.libraryId}) - ${totalExecutions} patient(s)`,
                content: this.formatExecutionResults(allResults, patients),
                status: 'success',
                executionTime: executionTime,
                expanded: true
              };
            }
          }
        },
        error: (error: any) => {
          allResults.push({
            patientId: patient.id,
            patientName: this.getPatientDisplayName(patient),
            error: error
          });
          
          completedExecutions++;
          
          if (completedExecutions === totalExecutions) {
            this.isExecuting = false;
            this.executionResults = allResults;
            const executionTime = Date.now() - executionStartTime;
            
            // Update the section with error
            const sectionIndex = this.outputSections.findIndex(s => s.title.includes('Library Execution'));
            if (sectionIndex !== -1) {
              this.outputSections[sectionIndex] = {
                title: `Library Execution (${this.libraryService.libraryId}) - ${totalExecutions} patient(s)`,
                content: this.formatExecutionResults(allResults, patients),
                status: 'error',
                executionTime: executionTime,
                expanded: true
              };
            }
          }
        }
      });
    });
  }

  private formatExecutionResults(results: any, patients: Patient[] | null): string {
    let output = '';
    
    if (patients && patients.length > 0) {
      // Multiple patients
      output += `=== Library Execution Results for ${patients.length} Patient(s) ===\n\n`;
      
      if (Array.isArray(results)) {
        results.forEach((result, index) => {
          output += `--- Patient ${index + 1}: ${result.patientName} (${result.patientId}) ---\n`;
          
          if (result.error) {
            output += `ERROR: ${JSON.stringify(result.error, null, 2)}\n\n`;
          } else {
            output += `RESULT: ${JSON.stringify(result.result, null, 2)}\n\n`;
          }
        });
      }
    } else {
      // Single execution without patient
      output += `=== Library Execution Results ===\n\n`;
      output += `RESULT: ${JSON.stringify(results, null, 2)}\n\n`;
    }
    
    output += `Execution completed at: ${new Date().toLocaleString()}\n`;
    
    return output;
  }

  // Event Listeners
  private setupEventListeners(): void {
    // Add any additional event listeners here
  }

  private removeEventListeners(): void {
    // Remove event listeners here
  }

  private detectPlatform(): void {
    // Detect if running on macOS with more comprehensive checks
    const platform = navigator.platform || '';
    const userAgent = navigator.userAgent || '';
    
    // Check for various Mac indicators
    this.isMac = platform.toUpperCase().includes('MAC') || 
                 platform.toUpperCase().includes('MACINTOSH') ||
                 userAgent.toUpperCase().includes('MAC OS X') ||
                 userAgent.toUpperCase().includes('MACINTOSH') ||
                 userAgent.toUpperCase().includes('MAC OS') ||
                 // Check for iOS devices (also use Mac shortcuts)
                 /iPad|iPhone|iPod/.test(userAgent) ||
                 // Check for modern Mac detection
                 navigator.maxTouchPoints > 1 && /Mac/.test(platform);
    
    console.log('Platform detection:', {
      platform: platform,
      userAgent: userAgent,
      isMac: this.isMac,
      maxTouchPoints: navigator.maxTouchPoints
    });
  }

  private getKeyCombo(key: string): string {
    if (this.isMac) {
      // Mac-specific key mappings - only for the 4 essential shortcuts
      switch (key) {
        case 'S': return '⌘+Option+S'; // Save - avoid conflict with standard Save
        case 'R': return '⌘+Option+R'; // Reload - avoid conflict with Refresh
        case 'Enter': return '⌘+Option+Enter'; // Execute - avoid conflict with default action
        case 'Shift+Enter': return '⌘+Option+Shift+Enter'; // Execute all - avoid conflict with default action
        default: return `⌘+Option+${key}`;
      }
    } else {
      // Windows/Linux key mappings - only for the 4 essential shortcuts
      switch (key) {
        case 'S': return 'Ctrl+Alt+S'; // Save - avoid conflict with standard Save
        case 'R': return 'Ctrl+Alt+R'; // Reload - avoid conflict with Refresh
        case 'Enter': return 'Ctrl+Alt+Enter'; // Execute - avoid conflict with default action
        case 'Shift+Enter': return 'Ctrl+Alt+Shift+Enter'; // Execute all - avoid conflict with default action
        default: return `Ctrl+Alt+${key}`;
      }
    }
  }

  public getExecutionAndNavigationShortcuts(): Array<{ key: string; description: string }> {
    return [...this.keyboardShortcuts.execution, ...this.keyboardShortcuts.navigation];
  }

  public getGeneralAndEditorShortcuts(): Array<{ key: string; description: string }> {
    return [...this.keyboardShortcuts.general, ...this.keyboardShortcuts.editor];
  }

  public getAllShortcuts(): Array<{ key: string; description: string }> {
    return [
      ...this.keyboardShortcuts.general,
      ...this.keyboardShortcuts.editor,
      ...this.keyboardShortcuts.execution,
      ...this.keyboardShortcuts.navigation
    ];
  }

}
