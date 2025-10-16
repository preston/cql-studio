// Author: Preston Lee

import { Component, Input, Output, EventEmitter, computed, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AiService, AIConversation, OllamaMessage } from '../../../../services/ai.service';
import { IdeStateService } from '../../../../services/ide-state.service';
import { SettingsService } from '../../../../services/settings.service';

@Component({
  selector: 'app-ai-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-tab.component.html',
  styleUrls: ['./ai-tab.component.scss']
})
export class AiTabComponent implements AfterViewChecked {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  private _cqlContent = signal<string>('');
  @Input() set cqlContent(value: string) {
    this._cqlContent.set(value);
    // Reload suggested commands when CQL content changes
    this.loadSuggestedCommands();
  }
  get cqlContent(): string {
    return this._cqlContent();
  }
  @Output() insertCqlCode = new EventEmitter<string>();
  @Output() replaceCqlCode = new EventEmitter<string>();

  // Component state
  private _isLoading = signal(false);
  private _currentMessage = signal('');
  private _conversations = signal<AIConversation[]>([]);
  private _activeConversationId = signal<string | null>(null);
  private _error = signal<string | null>(null);
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
  public connectionStatus = signal<'unknown' | 'testing' | 'connected' | 'error'>('unknown');
  public availableModels = signal<string[]>([]);
  public connectionError = signal<string>('');
  public streamingResponse = signal<string>('');
  public isStreaming = signal<boolean>(false);
  public suggestedCommands = signal<string[]>([]);
  public isLoadingSuggestions = signal<boolean>(false);

  constructor(
    private aiService: AiService,
    public ideStateService: IdeStateService,
    public settingsService: SettingsService,
    private router: Router
  ) {
    this.loadConversations();
    this.loadSuggestedCommands();
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
    this.suggestedCommands.set([]);

    this._isLoading.set(true);
    this._error.set(null);
    this.isStreaming.set(true);
    this.streamingResponse.set('');
    
    console.log('Starting streaming - isStreaming set to:', this.isStreaming());
    console.log('AI Assistant available:', this.isAiAvailable());
    console.log('Use MCP Tools:', this.useMCPTools());
    console.log('CQL Content length:', this.cqlContent.length);

    this.aiService.sendStreamingMessage(
      message,
      this._activeConversationId() || undefined,
      this.useMCPTools(),
      this.cqlContent
    ).subscribe({
      next: (event) => {
        console.log('Streaming event received:', event);
        if (event.type === 'start') {
          console.log('Streaming started');
          // Start of streaming response
          this.streamingResponse.set('');
        } else if (event.type === 'chunk') {
          console.log('Streaming chunk:', event.content);
          
          // Add chunk to streaming response
          this.streamingResponse.set(this.streamingResponse() + (event.content || ''));
          console.log('Updated streaming response:', this.streamingResponse());
        } else if (event.type === 'end') {
          console.log('Streaming ended');
          // End of streaming response
          this._isLoading.set(false);
          this._currentMessage.set('');
          this.isStreaming.set(false);
          this.streamingResponse.set('');
          
          // Update conversations
          this.loadConversations();
          
          // If this was a new conversation, set it as active
          if (!this._activeConversationId()) {
            const conversations = this._conversations();
            if (conversations.length > 0) {
              this._activeConversationId.set(conversations[conversations.length - 1].id);
            }
          }
        }
      },
      error: (error) => {
        console.error('Streaming error:', error);
        this._isLoading.set(false);
        this.isStreaming.set(false);
        this.streamingResponse.set('');
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

  onGetFhirData(resourceType: string, id?: string): void {
    this._isLoading.set(true);
    this._error.set(null);

    this.aiService.getFhirData(resourceType, id).subscribe({
      next: (data) => {
        this._isLoading.set(false);
        // Could display the FHIR data in a modal or expand the message
        console.log('FHIR Data:', data);
      },
      error: (error) => {
        this._isLoading.set(false);
        this._error.set(error.message || 'Failed to fetch FHIR data');
      }
    });
  }

  onGetMCPTools(): void {
    this._isLoading.set(true);
    this._error.set(null);

    this.aiService.getMCPTools().subscribe({
      next: (tools) => {
        this._isLoading.set(false);
        console.log('Available MCP Tools:', tools);
        // Could display tools in a modal or sidebar
      },
      error: (error) => {
        this._isLoading.set(false);
        this._error.set(error.message || 'Failed to fetch MCP tools');
      }
    });
  }

  onClearAllConversations(): void {
    if (confirm('Are you sure you want to clear all conversations? This action cannot be undone.')) {
      this.aiService.clearAllConversations();
      this._conversations.set([]);
      this._activeConversationId.set(null);
      this.streamingResponse.set('');
    }
  }

  private loadConversations(): void {
    this._conversations.set(this.aiService.getConversations());
  }

  private loadSuggestedCommands(): void {
    // Only load suggestions if no active conversation and CQL content exists
    if (this.hasActiveConversation() || !this.cqlContent?.trim()) {
      this.suggestedCommands.set([]);
      return;
    }

    this.isLoadingSuggestions.set(true);
    this.suggestedCommands.set([]);

    this.aiService.generateSuggestedCommands(this.cqlContent).subscribe({
      next: (commands) => {
        this.suggestedCommands.set(commands);
        this.isLoadingSuggestions.set(false);
      },
      error: (error) => {
        console.warn('Failed to load suggested commands:', error);
        this.suggestedCommands.set([]);
        this.isLoadingSuggestions.set(false);
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

  getMessageDisplayName(message: OllamaMessage): string {
    switch (message.role) {
      case 'user':
        return 'You';
      case 'assistant':
        return 'AI Assistant';
      case 'system':
        return 'System';
      default:
        return 'Unknown';
    }
  }

  getMessageIcon(message: OllamaMessage): string {
    switch (message.role) {
      case 'user':
        return 'bi-person';
      case 'assistant':
        return 'bi-robot';
      case 'system':
        return 'bi-gear';
      default:
        return 'bi-question';
    }
  }

  formatMessageContent(content: string): string {
    // Basic markdown-like formatting
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const blocks: Array<{ language: string; code: string }> = [];
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2].trim()
      });
    }

    return blocks;
  }

  getConversationTitle(conversation: AIConversation): string {
    return conversation.title || `Conversation ${conversation.id.slice(0, 8)}`;
  }

  getConversationPreview(conversation: AIConversation): string {
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (!lastMessage) return 'No messages';
    
    const preview = lastMessage.content.slice(0, 100);
    return preview.length < lastMessage.content.length ? preview + '...' : preview;
  }

  trackByConversationId(index: number, conversation: AIConversation): string {
    return conversation.id;
  }

  trackByMessageIndex(index: number, message: OllamaMessage): number {
    return index;
  }

  onNavigateToSettings(): void {
    this.router.navigate(['/settings']);
  }

  testConnection(): void {
    this.connectionStatus.set('testing');
    this.connectionError.set('');
    
    this.aiService.testOllamaConnection().subscribe({
      next: (result) => {
        this.connectionStatus.set('connected');
        this.availableModels.set(result.models);
        this.connectionError.set('');
      },
      error: (error) => {
        this.connectionStatus.set('error');
        this.connectionError.set(error.message);
        this.availableModels.set([]);
      }
    });
  }

  getStatusButtonClass(): string {
    const baseClass = 'btn btn-sm';
    switch (this.connectionStatus()) {
      case 'connected':
        return `${baseClass} btn-success`;
      case 'error':
        return `${baseClass} btn-danger`;
      case 'testing':
        return `${baseClass} btn-warning`;
      default:
        return `${baseClass} btn-light`;
    }
  }

  getStatusText(): string {
    switch (this.connectionStatus()) {
      case 'connected':
        return 'Connected';
      case 'error':
        return 'Error';
      case 'testing':
        return 'Testing...';
      default:
        return 'Unknown';
    }
  }

  getStatusTooltip(): string {
    switch (this.connectionStatus()) {
      case 'connected':
        return `Ollama server is connected. Available models: ${this.availableModels().join(', ')}`;
      case 'error':
        return `Connection failed: ${this.connectionError()}`;
      case 'testing':
        return 'Testing connection to Ollama server...';
      default:
        return 'Click to test connection to Ollama server';
    }
  }

  ngAfterViewChecked(): void {
    // Auto-scroll to bottom when new messages arrive or streaming
    if (this.messagesContainer) {
      const element = this.messagesContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }
}
