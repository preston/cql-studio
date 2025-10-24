// Author: Preston Lee

import { Injectable, signal, computed } from '@angular/core';
import { AIConversation } from './ai.service';
import { IdeStateService } from './ide-state.service';

export interface ConversationContext {
  id: string;
  editorId: string;
  editorType: 'cql' | 'fhir' | 'general';
  libraryName?: string;
  fileName?: string;
  lastAccessed: Date;
  conversationId: string;
  contextSummary: string;
}

export interface ContextualConversation extends AIConversation {
  context: ConversationContext;
  isActive: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ConversationContextService {
  private readonly CONTEXT_STORAGE_KEY = 'ai_conversation_contexts';
  private readonly MAX_CONTEXTS = 100;
  
  private _contexts = signal<ConversationContext[]>([]);
  private _activeContextId = signal<string | null>(null);
  private _contextualConversations = signal<ContextualConversation[]>([]);

  public contexts = computed(() => this._contexts());
  public activeContextId = computed(() => this._activeContextId());
  public contextualConversations = computed(() => this._contextualConversations());
  public activeContext = computed(() => {
    const id = this._activeContextId();
    return id ? this._contexts().find(c => c.id === id) : null;
  });

  constructor(private ideStateService: IdeStateService) {
    this.loadContexts();
  }

  /**
   * Create or get a conversation context for the current editor state
   */
  createOrGetContext(conversationId: string): ConversationContext {
    const currentEditor = this.getCurrentEditorContext();
    const existingContext = this.findContextForEditor(currentEditor);
    
    if (existingContext) {
      // Update existing context
      existingContext.conversationId = conversationId;
      existingContext.lastAccessed = new Date();
      this.updateContext(existingContext);
      return existingContext;
    }

    // Create new context
    const context: ConversationContext = {
      id: this.generateContextId(),
      editorId: currentEditor.id,
      editorType: currentEditor.type,
      libraryName: currentEditor.libraryName,
      fileName: currentEditor.fileName,
      lastAccessed: new Date(),
      conversationId,
      contextSummary: this.generateContextSummary(currentEditor)
    };

    this.addContext(context);
    return context;
  }

  /**
   * Get the most relevant conversation for the current editor context
   */
  getRelevantConversation(conversationId?: string): string | null {
    if (conversationId) {
      return conversationId;
    }

    const currentEditor = this.getCurrentEditorContext();
    const relevantContext = this.findMostRelevantContext(currentEditor);
    
    if (relevantContext) {
      this._activeContextId.set(relevantContext.id);
      return relevantContext.conversationId;
    }

    return null;
  }

  /**
   * Switch to a different editor context and restore its conversation
   */
  switchToEditorContext(editorId: string): string | null {
    const context = this._contexts().find(c => c.editorId === editorId);
    if (context) {
      this._activeContextId.set(context.id);
      context.lastAccessed = new Date();
      this.updateContext(context);
      return context.conversationId;
    }
    
    // If no context exists for this editor, try to find the most relevant one
    const currentEditor = this.getCurrentEditorContext();
    if (currentEditor.id === editorId) {
      const relevantContext = this.findMostRelevantContext(currentEditor);
      if (relevantContext) {
        this._activeContextId.set(relevantContext.id);
        return relevantContext.conversationId;
      }
    }
    
    return null;
  }

  /**
   * Update conversation context when editor content changes
   */
  updateContextForContentChange(conversationId: string, contentSummary?: string): void {
    const context = this._contexts().find(c => c.conversationId === conversationId);
    if (context) {
      context.lastAccessed = new Date();
      if (contentSummary) {
        context.contextSummary = contentSummary;
      }
      this.updateContext(context);
    }
  }


  /**
   * Clean up old contexts and conversations
   */
  cleanupOldContexts(): void {
    const contexts = this._contexts();
    if (contexts.length <= this.MAX_CONTEXTS) return;

    // Sort by last accessed and remove oldest
    const sortedContexts = contexts.sort((a, b) => 
      a.lastAccessed.getTime() - b.lastAccessed.getTime()
    );

    const toRemove = sortedContexts.slice(0, contexts.length - this.MAX_CONTEXTS + 1);
    toRemove.forEach(context => this.removeContext(context.id));
  }

  /**
   * Get context history for the current editor
   */
  getContextHistory(editorId: string): ConversationContext[] {
    return this._contexts()
      .filter(c => c.editorId === editorId)
      .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
  }

  /**
   * Merge conversations from different contexts
   */
  mergeContextConversations(sourceContextId: string, targetContextId: string): void {
    const sourceContext = this._contexts().find(c => c.id === sourceContextId);
    const targetContext = this._contexts().find(c => c.id === targetContextId);
    
    if (!sourceContext || !targetContext) return;

    // Update target context to use source conversation
    targetContext.conversationId = sourceContext.conversationId;
    targetContext.lastAccessed = new Date();
    this.updateContext(targetContext);

    // Remove source context
    this.removeContext(sourceContextId);
  }

  private getCurrentEditorContext(): { id: string; type: 'cql' | 'fhir' | 'general'; libraryName?: string; fileName?: string } {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    const activeFile = this.ideStateService.activeFileId();
    
    if (activeLibrary) {
      return {
        id: `library_${activeLibrary.id}`,
        type: 'cql',
        libraryName: activeLibrary.name,
        fileName: activeLibrary.name // Use name as fileName for libraries
      };
    }
    
    if (activeFile) {
      return {
        id: `file_${activeFile}`,
        type: 'general',
        fileName: activeFile
      };
    }

    return {
      id: 'general',
      type: 'general'
    };
  }

  private findContextForEditor(editor: { id: string; type: string }): ConversationContext | null {
    return this._contexts().find(c => c.editorId === editor.id) || null;
  }

  private findMostRelevantContext(editor: { id: string; type: string }): ConversationContext | null {
    // First try exact match
    let context = this._contexts().find(c => c.editorId === editor.id);
    if (context) return context;

    // Then try type match
    context = this._contexts()
      .filter(c => c.editorType === editor.type)
      .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())[0];
    
    if (context) return context;

    // Finally, return most recent
    return this._contexts()
      .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())[0] || null;
  }

  private generateContextSummary(editor: { type: string; libraryName?: string; fileName?: string }): string {
    if (editor.type === 'cql' && editor.libraryName) {
      return `CQL Library: ${editor.libraryName}`;
    } else if (editor.fileName) {
      return `File: ${editor.fileName}`;
    } else {
      return `General ${editor.type.toUpperCase()} context`;
    }
  }

  private addContext(context: ConversationContext): void {
    this._contexts.update(contexts => [...contexts, context]);
    this.saveContexts();
    this.cleanupOldContexts();
  }

  private updateContext(context: ConversationContext): void {
    this._contexts.update(contexts => 
      contexts.map(c => c.id === context.id ? context : c)
    );
    this.saveContexts();
  }

  private removeContext(contextId: string): void {
    this._contexts.update(contexts => 
      contexts.filter(c => c.id !== contextId)
    );
    this.saveContexts();
  }

  private loadContexts(): void {
    const stored = localStorage.getItem(this.CONTEXT_STORAGE_KEY);
    if (!stored) return;
    
    try {
      const contexts = JSON.parse(stored);
      this._contexts.set(contexts.map((c: any) => ({
        ...c,
        lastAccessed: new Date(c.lastAccessed)
      })));
    } catch {
      this._contexts.set([]);
    }
  }

  private saveContexts(): void {
    localStorage.setItem(this.CONTEXT_STORAGE_KEY, JSON.stringify(this._contexts()));
  }


  private generateContextId(): string {
    return `ctx_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
