// Author: Preston Lee

import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { highlightSpecialChars } from '@codemirror/view';
import { bracketMatching } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { CqlGrammarManager, CqlVersion } from '../../../../services/cql-grammar-manager.service';
import { IdeEditor, EditorState as IdeEditorState } from '../base-editor.interface';

// Custom highlight style for dark theme
const darkHighlightStyle = {
  define: [
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
  ]
};

@Component({
  selector: 'app-cql-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cql-editor.component.html',
  styleUrls: ['./cql-editor.component.scss']
})
export class CqlEditorComponent implements AfterViewInit, OnDestroy, OnChanges, IdeEditor {
  @ViewChild('editorContainer', { static: false }) editorContainer?: ElementRef<HTMLDivElement>;
  
  @Input() editorState: any;
  @Input() content: string = '';
  @Input() placeholder: string = 'Enter CQL code here...';
  @Input() height: string = '500px';
  @Input() readonly: boolean = false;
  @Input() cqlVersion: CqlVersion = '1.5.3';
  
  @Output() contentChange = new EventEmitter<{ cursorPosition: { line: number; column: number }, wordCount: number }>();
  @Output() cursorChange = new EventEmitter<{ line: number; column: number }>();
  @Output() editorStateChange = new EventEmitter<IdeEditorState>();
  @Output() syntaxErrors = new EventEmitter<string[]>();
  @Output() executeLibrary = new EventEmitter<void>();
  @Output() reloadLibrary = new EventEmitter<void>();
  @Output() cqlVersionChange = new EventEmitter<string>();
  @Output() formatCql = new EventEmitter<void>();
  @Output() validateCql = new EventEmitter<void>();
  @Output() saveLibrary = new EventEmitter<void>();

  private editor?: EditorView;
  private grammarManager: CqlGrammarManager;
  private _value: string = '';
  private isInitializingContent: boolean = false;
  private isInitializing: boolean = false;
  private isUpdatingContent: boolean = false;
  private initializationRetries: number = 0;
  private maxRetries: number = 10;
  private resizeObserver?: ResizeObserver;

  // Toolbar properties
  isExecuting: boolean = false;
  isNewLibrary: boolean = false;

  constructor() {
    this.grammarManager = new CqlGrammarManager(this.cqlVersion);
  }

  ngAfterViewInit(): void {
    console.log('Editor ngAfterViewInit called');
    if (!this.isInitializing && !this.editor) {
      // Try immediate initialization first
      setTimeout(() => {
        this.initializeEditor();
      }, 0);
      
      // Also set up ResizeObserver as a fallback
      this.setupResizeObserver();
    } else {
      console.log('Skipping initialization - already initializing or editor exists');
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cqlVersion'] && !changes['cqlVersion'].firstChange) {
      this.grammarManager.setVersion(this.cqlVersion);
      this.reinitializeEditor();
    }
    
    if (changes['content']) {
      // Only process if content actually changed
      if (this.content !== this._value) {
        console.log('Editor content changed:', {
          content: this.content.substring(0, 100) + '...',
          contentLength: this.content.length,
          editorExists: !!this.editor,
          isUpdatingContent: this.isUpdatingContent,
          currentValue: this._value.substring(0, 100) + '...'
        });
        
        if (this.editor && !this.isInitializing) {
          // Force content update even if isUpdatingContent is true
          this.forceContentUpdate(this.content);
        } else {
          // Store the content for when the editor is initialized
          this._value = this.content;
        }
      } else {
        console.log('Content unchanged, skipping update');
      }
    }
  }
  
  ngOnDestroy(): void {
    this.editor?.destroy();
    this.resizeObserver?.disconnect();
  }

  private initializeEditor(): void {
    console.log('initializeEditor called', {
      editorContainer: !!this.editorContainer?.nativeElement,
      currentValue: this._value.substring(0, 100) + '...',
      editorExists: !!this.editor,
      isInitializing: this.isInitializing
    });
    
    if (this.isInitializing) {
      console.log('Already initializing, skipping');
      return;
    }
    
    if (!this.editorContainer?.nativeElement) {
      console.log('Editor container not ready, returning');
      return;
    }
    
    if (this.editor) {
      console.log('Editor already exists, updating content');
      this.forceContentUpdate(this._value);
      return;
    }
    
    this.isInitializing = true;
    
    const container = this.editorContainer.nativeElement;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      this.initializationRetries++;
      console.log(`Container has no dimensions, retry ${this.initializationRetries}/${this.maxRetries}`);
      
      if (this.initializationRetries >= this.maxRetries) {
        console.error('Max initialization retries reached, forcing initialization with fallback dimensions');
        // Force initialization with fallback dimensions
        container.style.minHeight = '200px';
        container.style.minWidth = '300px';
        // Continue with initialization
      } else {
        this.isInitializing = false;
        setTimeout(() => {
          this.initializeEditor();
        }, 100);
        return;
      }
    }
    
    try {
      const startState = EditorState.create({
        doc: this._value,
        extensions: [
          basicSetup,
          ...this.grammarManager.createExtensions(),
          highlightSpecialChars(),
          bracketMatching(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
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
              backgroundColor: '#1e1e1e'
            },
            '.cm-editor.cm-focused': {
              borderColor: '#0d6efd',
              boxShadow: '0 0 0 0.2rem rgba(13, 110, 253, 0.25)'
            },
            '.cm-placeholder': {
              color: '#6c757d',
              fontStyle: 'italic'
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newValue = update.state.doc.toString();
              this._value = newValue;
              const cursor = this.getCursorPosition();
              const wordCount = this.getWordCount();
              this.contentChange.emit({ 
                cursorPosition: cursor || { line: 1, column: 1 }, 
                wordCount: wordCount || 0 
              });
            }
            
            if (update.selectionSet) {
              const selection = update.state.selection.main;
              const line = update.state.doc.lineAt(selection.from).number;
              const column = selection.from - update.state.doc.lineAt(selection.from).from;
              this.cursorChange.emit({ line, column });
            }
            
            // Update word count and validate syntax
            const text = update.state.doc.toString();
            const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
            this.validateSyntax(text);
            
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
        parent: this.editorContainer.nativeElement
      });
      
      this.isInitializing = false;
      this.initializationRetries = 0; // Reset retry counter on success
      console.log('Editor initialization completed');
      
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
    if (this.isUpdatingContent || this.isInitializing) {
      console.log('Skipping setValue - already updating or initializing');
      return;
    }
    
    this._value = value;
    if (this.editor) {
      this.isInitializingContent = true;
      
      this.editor.dispatch({
        changes: {
          from: 0,
          to: this.editor.state.doc.length,
          insert: this._value
        }
      });
      
      setTimeout(() => {
        this.isInitializingContent = false;
      }, 100);
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
    // This would be implemented with the grammar manager
    // For now, just emit the validation result
    this.editorStateChange.emit({
      cursorPosition: this.getCursorPosition(),
      wordCount: this.getWordCount(),
      syntaxErrors: this.getSyntaxErrors(),
      isValidSyntax: this.getIsValidSyntax()
    });
  }

  navigateToLine(lineNumber: number): void {
    if (!this.editor) {
      console.warn('Editor not available for navigation');
      return;
    }

    try {
      const line = this.editor.state.doc.line(lineNumber);
      const position = line.from;
      
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
  private forceContentUpdate(content: string): void {
    if (this.editor) {
      this.isInitializingContent = true;
      
      this.editor.dispatch({
        changes: {
          from: 0,
          to: this.editor.state.doc.length,
          insert: content
        }
      });
      this._value = content;
      
      setTimeout(() => {
        this.isInitializingContent = false;
      }, 100);
    }
  }

  private reinitializeEditor(): void {
    if (this.editor && !this.isInitializing) {
      console.log('Reinitializing editor');
      const currentValue = this.getValue();
      this.editor.destroy();
      this.editor = undefined;
      this.isInitializing = false; // Reset flag
      this.initializeEditor();
      // Use setTimeout to prevent immediate content update during reinitialization
      setTimeout(() => {
        if (this.editor) {
          this.setValue(currentValue);
        }
      }, 100);
    }
  }

  private formatCqlCode(code: string): string {
    // Enhanced CQL formatting logic would go here
    return code;
  }

  private setupResizeObserver(): void {
    if (!this.editorContainer?.nativeElement || this.editor) {
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && !this.editor && !this.isInitializing) {
          console.log('ResizeObserver detected container dimensions, initializing editor');
          this.initializeEditor();
          this.resizeObserver?.disconnect();
        }
      }
    });

    this.resizeObserver.observe(this.editorContainer.nativeElement);
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
    // This would be implemented with the grammar manager
    return [];
  }

  private getIsValidSyntax(): boolean {
    // This would be implemented with the grammar manager
    return true;
  }

  // Toolbar methods
  canExecute(): boolean {
    return this._value.trim().length > 0;
  }

  isFormValid(): boolean {
    return this._value.trim().length > 0;
  }

  onExecuteLibrary(): void {
    this.executeLibrary.emit();
  }

  onReloadLibrary(): void {
    this.reloadLibrary.emit();
  }

  onCqlVersionChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target && target.value) {
      this.cqlVersionChange.emit(target.value);
    }
  }

  onFormatCql(): void {
    this.formatCql.emit();
  }

  onValidateCql(): void {
    this.validateCql.emit();
  }

  onSaveLibrary(): void {
    this.saveLibrary.emit();
  }
}
