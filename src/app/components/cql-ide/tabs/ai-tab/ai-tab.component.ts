// Author: Preston Lee

import { Component, Input, Output, EventEmitter, computed, signal, ViewChild, ElementRef, AfterViewChecked, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MarkdownComponent } from 'ngx-markdown';
import { AiService, AIConversation, OllamaMessage } from '../../../../services/ai.service';
import { IdeStateService } from '../../../../services/ide-state.service';
import { SettingsService } from '../../../../services/settings.service';
import { ConversationContextService, ConversationContext } from '../../../../services/conversation-context.service';

@Component({
  selector: 'app-ai-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownComponent],
  templateUrl: './ai-tab.component.html',
  styleUrls: ['./ai-tab.component.scss']
})
export class AiTabComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  private _cqlContent = signal<string>('');
  @Input() set cqlContent(value: string) {
    this._cqlContent.set(value);
    // Reload suggested commands when CQL content changes
    this.loadSuggestedCommands();
    // Update context when CQL content changes
    this.updateContextForContentChange();
  }
  get cqlContent(): string {
    return this._cqlContent();
  }
  @Output() insertCqlCode = new EventEmitter<string>();
  @Output() replaceCqlCode = new EventEmitter<string>();

  // Component state signals
  private _isLoading = signal(false);
  private _currentMessage = signal('');
  private _conversations = signal<AIConversation[]>([]);
  private _activeConversationId = signal<string | null>(null);
  private _error = signal<string | null>(null);
  private _currentContext = signal<ConversationContext | null>(null);
  private _contextualConversations = signal<AIConversation[]>([]);
  private _lastProcessedEditorId = signal<string | null>(null);
  private _contextSwitchingSetup = false;
  
  // Connection state signals
  private _connectionStatus = signal<'unknown' | 'testing' | 'connected' | 'error'>('unknown');
  private _availableModels = signal<string[]>([]);
  private _connectionError = signal<string>('');
  
  // Streaming state signals
  private _streamingResponse = signal<string>('');
  private _isStreaming = signal<boolean>(false);
  
  // Suggestions state signals
  private _suggestedCommands = signal<string[]>([]);
  private _isLoadingSuggestions = signal<boolean>(false);

  // Computed properties
  public isLoading = computed(() => this._isLoading());
  public currentMessage = computed(() => this._currentMessage());
  public conversations = computed(() => this._conversations());
  public activeConversationId = computed(() => this._activeConversationId());
  public error = computed(() => this._error());
  public useMCPTools = computed(() => this.settingsService.settings().useMCPTools);
  public activeConversation = computed(() => {
    const id = this._activeConversationId();
    return id ? this._conversations().find(c => c.id === id) : null;
  });
  public hasActiveConversation = computed(() => !!this.activeConversation());
  public canSendMessage = computed(() => 
    !this._isLoading() && this._currentMessage().trim().length > 0
  );
  public isAiAvailable = computed(() => this.aiService.isAiAssistantAvailable());
  public currentContext = computed(() => this._currentContext());
  public contextualConversations = computed(() => this._contextualConversations());
  
  // Connection computed properties
  public connectionStatus = computed(() => this._connectionStatus());
  public availableModels = computed(() => this._availableModels());
  public connectionError = computed(() => this._connectionError());
  
  // Streaming computed properties
  public streamingResponse = computed(() => this._streamingResponse());
  public isStreaming = computed(() => this._isStreaming());
  
  // Suggestions computed properties
  public suggestedCommands = computed(() => this._suggestedCommands());
  public isLoadingSuggestions = computed(() => this._isLoadingSuggestions());

  constructor(
    private aiService: AiService,
    public ideStateService: IdeStateService,
    public settingsService: SettingsService,
    private conversationContextService: ConversationContextService,
    private router: Router
  ) {
    console.log('AiTabComponent constructor called');
    this.loadConversations();
    this.loadSuggestedCommands();
    this.loadCurrentContext();
  }

  ngOnInit(): void {
    console.log('ngOnInit called, setting up context switching');
    this.setupContextSwitching();
  }

  onMessageChange(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    const value = target?.value || '';
    this._currentMessage.set(value);
    this._error.set(null);
    
    // Auto-resize textarea
    this.autoResizeTextarea(target);
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 120; // max-height from CSS
    const minHeight = 36; // min-height from CSS
    
    if (scrollHeight > maxHeight) {
      textarea.style.height = maxHeight + 'px';
      textarea.style.overflowY = 'auto';
    } else if (scrollHeight < minHeight) {
      textarea.style.height = minHeight + 'px';
      textarea.style.overflowY = 'hidden';
    } else {
      textarea.style.height = scrollHeight + 'px';
      textarea.style.overflowY = 'hidden';
    }
  }


  onSendMessage(): void {
    console.log('onSendMessage called');
    const message = this._currentMessage().trim();
    console.log('Message to send:', message);
    console.log('Is loading:', this._isLoading());
    
    if (!message || this._isLoading()) {
      console.log('Not sending message - empty message or already loading');
      return;
    }

    // Clear suggested commands when starting a conversation
    this._suggestedCommands.set([]);

    this._isLoading.set(true);
    this._error.set(null);
    this._isStreaming.set(true);
    this._streamingResponse.set('');
    
    console.log('Starting streaming - isStreaming set to:', this.isStreaming());
    console.log('AI Assistant available:', this.isAiAvailable());
    console.log('Use MCP Tools:', this.useMCPTools());
    console.log('CQL Content length:', this.cqlContent.length);

    // Use context-aware message sending
    let conversationId = this._activeConversationId();
    
    // If no active conversation, try to get relevant one for current context
    if (!conversationId) {
      conversationId = this.aiService.getRelevantConversation();
    }
    
    console.log('Sending message with conversation ID:', conversationId);
    
    this.aiService.sendStreamingMessage(
      message,
      conversationId || undefined,
      this.useMCPTools(),
      this.cqlContent
    ).subscribe({
      next: (event) => {
        console.log('Streaming event received:', event);
        if (event.type === 'start') {
          console.log('Streaming started');
          // Start of streaming response
          this._streamingResponse.set('');
        } else if (event.type === 'chunk') {
          console.log('Streaming chunk:', event.content);
          
          // Add chunk to streaming response
          this._streamingResponse.set(this._streamingResponse() + (event.content || ''));
          console.log('Updated streaming response:', this._streamingResponse());
        } else if (event.type === 'end') {
          console.log('Streaming ended');
          // End of streaming response
          this._isLoading.set(false);
          this._currentMessage.set('');
          this._isStreaming.set(false);
          this._streamingResponse.set('');
          
          // Update conversations
          this.loadConversations();
          
          // If this was a new conversation, set it as active and associate with current context
          if (!this._activeConversationId()) {
            const conversations = this._conversations();
            if (conversations.length > 0) {
              const newConversationId = conversations[conversations.length - 1].id;
              this._activeConversationId.set(newConversationId);
              
              // Associate the new conversation with the current context
              this.conversationContextService.createOrGetContext(newConversationId);
              this.loadCurrentContext();
            }
          }
        }
      },
      error: (error) => {
        console.error('Streaming error:', error);
        this._isLoading.set(false);
        this._isStreaming.set(false);
        this._streamingResponse.set('');
        this._error.set(error.message || 'Failed to send message');
      }
    });
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSendMessage();
    }
  }

  onSelectConversation(conversationId: string): void {
    this._activeConversationId.set(conversationId);
    this._error.set(null);
  }

  onNewConversation(): void {
    this._activeConversationId.set(null);
    this._currentMessage.set('');
    this._error.set(null);
    // Reload suggested commands when starting a new conversation
    this.loadSuggestedCommands();
  }

  onDeleteConversation(conversationId: string): void {
    this.aiService.deleteConversation(conversationId);
    this.loadConversations();
    
    // If we deleted the active conversation, clear it
    if (this._activeConversationId() === conversationId) {
      this._activeConversationId.set(null);
    }
  }


  onInsertCode(code: string): void {
    this.insertCqlCode.emit(code);
  }

  onReplaceCode(code: string): void {
    this.replaceCqlCode.emit(code);
  }

  onCopyMessage(content: string): void {
    navigator.clipboard.writeText(content).then(() => {
      // Could show a toast notification here
    });
  }

  onRegenerateResponse(): void {
    const conversation = this.activeConversation();
    if (!conversation || conversation.messages.length < 2) return;

    // Remove the last assistant message and resend
    const messages = conversation.messages;
    const lastUserMessage = messages[messages.length - 2];
    
    if (lastUserMessage.role === 'user') {
      this._currentMessage.set(lastUserMessage.content);
      this.onSendMessage();
    }
  }


  onClearAllConversations(): void {
    if (confirm('Are you sure you want to clear all conversations? This action cannot be undone.')) {
      this.aiService.clearAllConversations();
      this._conversations.set([]);
      this._activeConversationId.set(null);
      this._streamingResponse.set('');
    }
  }

  private loadConversations(): void {
    this._conversations.set(this.aiService.getConversations());
    this.loadContextualConversations();
  }

  private loadCurrentContext(): void {
    const context = this.conversationContextService.activeContext();
    this._currentContext.set(context || null);
    
    if (context) {
      // Load conversation for this context
      const conversation = this.aiService.getConversation(context.conversationId);
      if (conversation) {
        this._activeConversationId.set(conversation.id);
      }
    }
  }

  private loadContextualConversations(): void {
    const currentContext = this._currentContext();
    if (currentContext) {
      const contextualConversations = this.aiService.getConversationsForContext(currentContext.editorId);
      this._contextualConversations.set(contextualConversations);
    } else {
      this._contextualConversations.set([]);
    }
  }

  private loadSuggestedCommands(): void {
    // Only load suggestions if no active conversation and CQL content exists
    if (this.hasActiveConversation() || !this.cqlContent?.trim()) {
      this._suggestedCommands.set([]);
      return;
    }

    this._isLoadingSuggestions.set(true);
    this._suggestedCommands.set([]);

    // Use AI-generated suggestions based on current content
    this.aiService.generateSuggestedCommands(this.cqlContent).subscribe({
      next: (commands) => {
        this._suggestedCommands.set(commands);
        this._isLoadingSuggestions.set(false);
      },
      error: (error) => {
        console.warn('Failed to load suggested commands:', error);
        this._suggestedCommands.set([]);
        this._isLoadingSuggestions.set(false);
      }
    });
  }

  onSuggestedCommandClick(command: string): void {
    console.log('Suggested command clicked:', command);
    // Set the command as the current message and send it
    this._currentMessage.set(command);
    console.log('Current message set to:', this._currentMessage());
    this.onSendMessage();
  }

  onRefreshSuggestions(): void {
    this.loadSuggestedCommands();
  }


  onNavigateToSettings(): void {
    this.router.navigate(['/settings']);
  }

  testConnection(): void {
    this._connectionStatus.set('testing');
    this._connectionError.set('');
    
    this.aiService.testOllamaConnection().subscribe({
      next: (result) => {
        this._connectionStatus.set('connected');
        this._availableModels.set(result.models);
        this._connectionError.set('');
      },
      error: (error) => {
        this._connectionStatus.set('error');
        this._connectionError.set(error.message);
        this._availableModels.set([]);
      }
    });
  }

  testContextSwitching(): void {
    console.log('Manual context switching test');
    console.log('Current library ID:', this.ideStateService.activeLibraryId());
    console.log('Current panel state:', this.ideStateService.panelState());
    console.log('Last processed editor ID:', this._lastProcessedEditorId());
    console.log('Current context:', this._currentContext());
    console.log('Active conversation ID:', this._activeConversationId());
    
    // Test manual context change
    this.onEditorContextChanged('test_editor_123');
  }


  ngAfterViewChecked(): void {
    // Auto-scroll to bottom when new messages arrive or streaming
    if (this.messagesContainer) {
      const element = this.messagesContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  /**
   * Update context when CQL content changes
   */
  private updateContextForContentChange(): void {
    const activeConversationId = this._activeConversationId();
    if (activeConversationId) {
      const contentSummary = this.generateContentSummary();
      this.conversationContextService.updateContextForContentChange(activeConversationId, contentSummary);
    }
  }

  /**
   * Generate a summary of the current content for context
   */
  private generateContentSummary(): string {
    const content = this.cqlContent;
    if (!content || content.trim().length === 0) {
      return 'Empty content';
    }

    // Generate a brief summary of the content
    const lines = content.split('\n');
    const firstLine = lines[0]?.trim() || '';
    const lineCount = lines.length;
    
    if (firstLine.includes('library')) {
      return `CQL Library (${lineCount} lines): ${firstLine.substring(0, 50)}...`;
    } else if (firstLine.includes('define')) {
      return `CQL Expression (${lineCount} lines): ${firstLine.substring(0, 50)}...`;
    } else {
      return `CQL Content (${lineCount} lines): ${firstLine.substring(0, 50)}...`;
    }
  }

  /**
   * Switch to a different editor context
   */
  onSwitchToEditorContext(editorId: string): void {
    const conversationId = this.aiService.switchToEditorContext(editorId);
    if (conversationId) {
      this._activeConversationId.set(conversationId);
      this.loadCurrentContext();
      this.loadContextualConversations();
    }
  }

  /**
   * Get context history for current editor
   */
  getContextHistory(): ConversationContext[] {
    const currentContext = this._currentContext();
    if (currentContext) {
      return this.conversationContextService.getContextHistory(currentContext.editorId);
    }
    return [];
  }

  /**
   * Get context display name
   */
  getContextDisplayName(context: ConversationContext): string {
    if (context.libraryName) {
      return `CQL: ${context.libraryName}`;
    } else if (context.fileName) {
      return `File: ${context.fileName}`;
    } else {
      return context.contextSummary;
    }
  }

  /**
   * Setup automatic context switching when IDE state changes
   */
  private setupContextSwitching(): void {
    console.log('setupContextSwitching called, already setup:', this._contextSwitchingSetup);
    if (this._contextSwitchingSetup) {
      return; // Already setup
    }
    this._contextSwitchingSetup = true;
    console.log('Setting up context switching effects');
    
    // Test effect to verify effects are working
    effect(() => {
      console.log('Test effect triggered - effects are working!');
    });
    
    // Watch for changes in active library using effect
    effect(() => {
      try {
        const libraryId = this.ideStateService.activeLibraryId();
        console.log('Library effect triggered, libraryId:', libraryId);
        console.log('IDE State Service available:', !!this.ideStateService);
        console.log('activeLibraryId method available:', typeof this.ideStateService.activeLibraryId);
        if (libraryId) {
          const editorId = `library_${libraryId}`;
          console.log('Processing library editorId:', editorId, 'lastProcessed:', this._lastProcessedEditorId());
          if (this._lastProcessedEditorId() !== editorId) {
            this._lastProcessedEditorId.set(editorId);
            this.onEditorContextChanged(editorId);
          }
        }
      } catch (error) {
        console.error('Error in library effect:', error);
      }
    });

    // Watch for changes in panel tabs to detect editor changes
    effect(() => {
      try {
        const panelState = this.ideStateService.panelState();
        console.log('Panel effect triggered, panelState:', panelState);
        if (!panelState) return;
        
        const leftPanel = panelState.left;
        const rightPanel = panelState.right;
        const bottomPanel = panelState.bottom;
        
        if (!leftPanel || !rightPanel || !bottomPanel) return;
        
        // Check for active tabs in each panel, but only for relevant tab types
        const activeTabs = [
          ...(leftPanel.tabs || []).filter(tab => tab.isActive && this.isRelevantTabType(tab.type)),
          ...(rightPanel.tabs || []).filter(tab => tab.isActive && this.isRelevantTabType(tab.type)),
          ...(bottomPanel.tabs || []).filter(tab => tab.isActive && this.isRelevantTabType(tab.type))
        ];
        
        console.log('Active tabs found:', activeTabs);
        
        if (activeTabs.length > 0) {
          const activeTab = activeTabs[0]; // Get the first active tab
          const editorId = `tab_${activeTab.id}`;
          console.log('Processing tab editorId:', editorId, 'lastProcessed:', this._lastProcessedEditorId());
          
          if (this._lastProcessedEditorId() !== editorId) {
            this._lastProcessedEditorId.set(editorId);
            this.onEditorContextChanged(editorId);
          }
        }
      } catch (error) {
        console.error('Error in panel effect:', error);
      }
    });
  }

  /**
   * Check if a tab type is relevant for context switching
   */
  private isRelevantTabType(tabType: string): boolean {
    // Only switch contexts for tabs that contain actual content/editors
    const relevantTypes = ['fhir', 'elm', 'problems', 'output', 'ai'];
    return relevantTypes.includes(tabType);
  }

  /**
   * Handle editor context changes
   */
  private onEditorContextChanged(editorId: string): void {
    try {
      console.log('onEditorContextChanged called with:', editorId);
      // Switch to the relevant conversation for this editor
      const relevantConversationId = this.aiService.switchToEditorContext(editorId);
      const currentConversationId = this._activeConversationId();
      
      console.log('Context change - relevant:', relevantConversationId, 'current:', currentConversationId);
      
      // Only update if there's an actual change
      if (relevantConversationId !== currentConversationId) {
        if (relevantConversationId) {
          console.log('Switching to conversation:', relevantConversationId);
          this._activeConversationId.set(relevantConversationId);
          this.loadCurrentContext();
          this.loadContextualConversations();
          this.loadSuggestedCommands();
        } else {
          console.log('Clearing active conversation');
          this._activeConversationId.set(null);
          this.loadCurrentContext();
          this.loadContextualConversations();
          this.loadSuggestedCommands();
        }
      } else {
        console.log('No change needed for context');
      }
    } catch (error) {
      console.error('Error in context change:', error);
    }
  }
}
