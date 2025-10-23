// Author: Preston Lee

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { BaseService } from './base.service';
import { SettingsService } from './settings.service';
import { IdeStateService } from './ide-state.service';
import { ConversationContextService, ConversationContext } from './conversation-context.service';

// Ollama API types (based on official Ollama API)
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
  };
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: any;
}

export interface MCPRequest {
  method: string;
  params: any;
}

export interface MCPResponse {
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export interface AIConversation {
  id: string;
  title: string;
  messages: OllamaMessage[];
  createdAt: Date;
  updatedAt: Date;
  contextId?: string;
  editorId?: string;
  editorType?: 'cql' | 'fhir' | 'general';
}

@Injectable({
  providedIn: 'root'
})
export class AiService extends BaseService {
  private readonly CONVERSATION_STORAGE_KEY = 'ai_conversations';
  private readonly MAX_CONVERSATIONS = 50;

  constructor(
    protected override http: HttpClient,
    private settingsService: SettingsService,
    private ideStateService: IdeStateService,
    private conversationContextService: ConversationContextService
  ) {
    super(http);
  }

  /**
   * Check if AI assistant is available (Ollama configured and enabled)
   */
  isAiAssistantAvailable(): boolean {
    return !!(this.settingsService.getEffectiveOllamaBaseUrl() && 
              this.settingsService.settings().enableAiAssistant);
  }

  /**
   * Test Ollama connection and model availability
   */
  testOllamaConnection(): Observable<{connected: boolean, models: string[], error?: string}> {
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();
    if (!ollamaUrl) {
      return throwError(() => new Error('Ollama base URL not configured'));
    }

    return this.http.get<{models: any[]}>(`${ollamaUrl}/api/tags`, {
      headers: this.getOllamaHeaders(),
      timeout: 10000 // 10 second timeout for connection test
    }).pipe(
      map(response => ({
        connected: true,
        models: response.models.map(m => m.name)
      })),
      catchError(error => {
        console.error('Ollama connection test failed:', error);
        return throwError(() => new Error(`Connection test failed: ${error.message || 'Unknown error'}`));
      })
    );
  }

  /**
   * Send a context-aware message to Ollama
   */
  sendContextAwareMessage(
    message: string,
    useMCPTools: boolean = true,
    cqlContent?: string
  ): Observable<OllamaResponse> {
    const contextId = this.conversationContextService.getRelevantConversation();
    return this.sendMessage(message, contextId || undefined, useMCPTools);
  }

  /**
   * Send a message to Ollama with optional MCP tool integration
   */
  sendMessage(
    message: string, 
    conversationId?: string,
    useMCPTools: boolean = true
  ): Observable<OllamaResponse> {
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();
    if (!ollamaUrl || !this.settingsService.settings().enableAiAssistant) {
      return throwError(() => new Error('AI Assistant is not enabled or Ollama base URL not configured'));
    }

    const model = this.settingsService.getEffectiveOllamaModel();
    const conversations = this.getConversations();
    let conversation = conversationId ? conversations.find(c => c.id === conversationId) : null;

    if (!conversation) {
      conversation = this.createNewConversation(message);
    }

    // Add user message to conversation
    conversation.messages.push({ role: 'user', content: message });
    conversation.updatedAt = new Date();

    // Prepare system message with context
    const systemMessage = this.buildSystemMessage(conversation, useMCPTools);

    const request: OllamaRequest = {
      model: model,
      messages: [systemMessage, ...conversation.messages],
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9
      }
    };

    return this.http.post<OllamaResponse>(`${ollamaUrl}/api/chat`, request, {
      headers: this.getOllamaHeaders(),
      timeout: 120000 // 2 minute timeout
    }).pipe(
      map(response => {
        // Add assistant response to conversation
        conversation!.messages.push({
          role: 'assistant',
          content: response.message.content
        });
        conversation!.updatedAt = new Date();
        
        // Save updated conversation
        this.saveConversation(conversation!);
        
        return response;
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Send a context-aware streaming message to Ollama
   */
  sendContextAwareStreamingMessage(
    message: string,
    useMCPTools: boolean = true,
    cqlContent?: string
  ): Observable<{type: 'start' | 'chunk' | 'end', content?: string, fullResponse?: string}> {
    const contextId = this.conversationContextService.getRelevantConversation();
    return this.sendStreamingMessage(message, contextId || undefined, useMCPTools, cqlContent);
  }

  /**
   * Send a streaming message to Ollama with optional MCP tool integration
   */
  sendStreamingMessage(
    message: string, 
    conversationId?: string,
    useMCPTools: boolean = true,
    cqlContent?: string
  ): Observable<{type: 'start' | 'chunk' | 'end', content?: string, fullResponse?: string}> {
    console.log('AI Service - sendStreamingMessage called');
    console.log('AI Service - message:', message);
    console.log('AI Service - conversationId:', conversationId);
    console.log('AI Service - useMCPTools:', useMCPTools);
    console.log('AI Service - cqlContent length:', cqlContent?.length);
    
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();
    console.log('AI Service - ollamaUrl:', ollamaUrl);
    console.log('AI Service - enableAiAssistant:', this.settingsService.settings().enableAiAssistant);
    
    if (!ollamaUrl || !this.settingsService.settings().enableAiAssistant) {
      console.log('AI Service - AI Assistant not available');
      return throwError(() => new Error('AI Assistant is not enabled or Ollama base URL not configured'));
    }

    const model = this.settingsService.getEffectiveOllamaModel();
    const conversations = this.getConversations();
    let conversation = conversationId ? conversations.find(c => c.id === conversationId) : null;

    if (!conversation) {
      conversation = this.createNewConversation(message);
    }

    // Add user message to conversation
    conversation.messages.push({ role: 'user', content: message });
    conversation.updatedAt = new Date();

    // Prepare system message with context
    const systemMessage = this.buildSystemMessage(conversation, useMCPTools, cqlContent);

    const request: OllamaRequest = {
      model: model,
      messages: [systemMessage, ...conversation.messages],
      stream: true,
      options: {
        temperature: 0.7,
        top_p: 0.9
      }
    };

    return new Observable(observer => {
      let fullResponse = '';
      
      // Emit start event
      console.log('AI Service - Emitting start event');
      observer.next({ type: 'start' });

      // Make streaming request
      console.log('AI Service - Making fetch request to:', `${ollamaUrl}/api/chat`);
      console.log('AI Service - Request body:', JSON.stringify(request, null, 2));
      
      fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(request)
      }).then(response => {
        console.log('AI Service - Fetch response received:', response.status, response.statusText);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body reader available');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        const readChunk = (): Promise<void> => {
          return reader.read().then(({ done, value }) => {
            if (done) {
              // Add complete response to conversation
              conversation!.messages.push({
                role: 'assistant',
                content: fullResponse
              });
              conversation!.updatedAt = new Date();
              
              // Save updated conversation
              this.saveConversation(conversation!);
              
              console.log('AI Service - Emitting end event');
              observer.next({ type: 'end', fullResponse });
              observer.complete();
              return;
            }

            // Decode the chunk
            buffer += decoder.decode(value, { stream: true });
            
            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const data = JSON.parse(line);
                  if (data.message && data.message.content) {
                    const content = data.message.content;
                    fullResponse += content;
                    console.log('AI Service - Emitting chunk:', content);
                    observer.next({ type: 'chunk', content });
                  }
                } catch (e) {
                  // Skip invalid JSON lines
                  console.warn('Invalid JSON line:', line);
                }
              }
            }

            return readChunk();
          });
        };

        return readChunk();
      }).catch(error => {
        console.error('AI Service - Fetch error:', error);
        observer.error(error);
      });
    });
  }

  /**
   * Get available MCP tools
   */
  getMCPTools(): Observable<MCPTool[]> {
    const mcpUrl = this.settingsService.getEffectiveMCPBaseUrl();
    if (!mcpUrl) {
      return throwError(() => new Error('MCP base URL not configured'));
    }

    return this.http.get<MCPTool[]>(`${mcpUrl}/tools`, {
      headers: this.getMCPHeaders()
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Execute an MCP tool
   */
  executeMCPTool(toolName: string, parameters: any): Observable<MCPResponse> {
    const mcpUrl = this.settingsService.getEffectiveMCPBaseUrl();
    if (!mcpUrl) {
      return throwError(() => new Error('MCP base URL not configured'));
    }

    const request: MCPRequest = {
      method: toolName,
      params: parameters
    };

    return this.http.post<MCPResponse>(`${mcpUrl}/execute`, request, {
      headers: this.getMCPHeaders()
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Get FHIR data through MCP server
   */
  getFhirData(resourceType: string, id?: string, query?: any): Observable<any> {
    const mcpUrl = this.settingsService.getEffectiveMCPBaseUrl();
    if (!mcpUrl) {
      return throwError(() => new Error('MCP base URL not configured'));
    }

    const params = {
      resourceType,
      id,
      query
    };

    return this.http.post<any>(`${mcpUrl}/fhir`, params, {
      headers: this.getMCPHeaders()
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Generate suggested AI commands based on CQL content
   */
  generateSuggestedCommands(cqlContent: string): Observable<string[]> {
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();
    
    if (!ollamaUrl || !this.settingsService.settings().enableAiAssistant) {
      return throwError(() => new Error('AI Assistant is not enabled or Ollama base URL not configured'));
    }

    const model = this.settingsService.getEffectiveOllamaModel();
    
    const systemMessage: OllamaMessage = {
      role: 'system',
      content: `You are an AI assistant that generates helpful suggestions and code for CQL developers. Based on the provided CQL content, generate 3-5 specific, actionable commands that a developer might want to ask an AI assistant about their CQL code.

IMPORTANT: Return ONLY a valid JSON array of strings. Do not include any markdown formatting, code blocks, or explanations. Just return the raw JSON array.

Example format:
["Review this CQL code for best practices", "Explain the logic in this CQL expression", "Help me debug any syntax errors", "Suggest improvements for performance", "Generate test cases for this CQL"]

Focus on practical, specific commands that would be immediately useful to someone working with the provided CQL code.`
    };

    const userMessage: OllamaMessage = {
      role: 'user',
      content: `Based on this CQL code, suggest 3-5 helpful commands I could ask an AI assistant:

\`\`\`cql
${cqlContent}
\`\`\``
    };

    const request: OllamaRequest = {
      model: model,
      messages: [systemMessage, userMessage],
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.8
      }
    };

    return this.http.post<OllamaResponse>(`${ollamaUrl}/api/chat`, request, {
      headers: this.getOllamaHeaders(),
      timeout: 30000 // 30 second timeout for command generation
    }).pipe(
      map(response => {
        try {
          // Clean the response content by removing markdown code blocks
          let content = response.message.content;
          
          // Remove markdown code block formatting
          content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '');
          
          // Trim whitespace
          content = content.trim();
          
          // Parse the JSON response
          const commands = JSON.parse(content);
          if (Array.isArray(commands) && commands.length > 0) {
            return commands.slice(0, 5); // Limit to 5 commands
          }
          return [];
        } catch (error) {
          console.warn('Failed to parse suggested commands:', error);
          console.warn('Raw response content:', response.message.content);
          return [];
        }
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Get all conversations
   */
  getConversations(): AIConversation[] {
    const stored = localStorage.getItem(this.CONVERSATION_STORAGE_KEY);
    if (!stored) return [];
    
    try {
      const conversations = JSON.parse(stored);
      return conversations.map((c: any) => ({
        ...c,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt)
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get a specific conversation
   */
  getConversation(id: string): AIConversation | null {
    return this.getConversations().find(c => c.id === id) || null;
  }

  /**
   * Delete a conversation
   */
  deleteConversation(id: string): void {
    const conversations = this.getConversations().filter(c => c.id !== id);
    localStorage.setItem(this.CONVERSATION_STORAGE_KEY, JSON.stringify(conversations));
  }

  /**
   * Clear all conversations
   */
  clearAllConversations(): void {
    localStorage.removeItem(this.CONVERSATION_STORAGE_KEY);
  }

  /**
   * Get conversations for a specific context
   */
  getConversationsForContext(editorId: string): AIConversation[] {
    return this.getConversations().filter(c => c.editorId === editorId);
  }

  /**
   * Get the most relevant conversation for current context
   */
  getRelevantConversation(): string | null {
    return this.conversationContextService.getRelevantConversation();
  }

  /**
   * Create a new conversation with context
   */
  createContextualConversation(firstMessage: string): AIConversation {
    const conversation = this.createNewConversation(firstMessage);
    const context = this.conversationContextService.createOrGetContext(conversation.id);
    
    // Update conversation with context information
    conversation.contextId = context.id;
    conversation.editorId = context.editorId;
    conversation.editorType = context.editorType;
    
    this.saveConversation(conversation);
    return conversation;
  }

  /**
   * Update conversation context when editor changes
   */
  updateConversationContext(conversationId: string, editorId: string): void {
    const conversation = this.getConversation(conversationId);
    if (conversation) {
      conversation.editorId = editorId;
      this.saveConversation(conversation);
    }
  }


  /**
   * Switch to a different editor context
   */
  switchToEditorContext(editorId: string): string | null {
    return this.conversationContextService.switchToEditorContext(editorId);
  }

  private createNewConversation(firstMessage: string): AIConversation {
    const conversation: AIConversation = {
      id: this.generateId(),
      title: this.generateTitle(firstMessage),
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Clean up old conversations if we have too many
    const conversations = this.getConversations();
    if (conversations.length >= this.MAX_CONVERSATIONS) {
      const sortedConversations = conversations.sort((a, b) => 
        a.updatedAt.getTime() - b.updatedAt.getTime()
      );
      const toDelete = sortedConversations.slice(0, conversations.length - this.MAX_CONVERSATIONS + 1);
      toDelete.forEach(c => this.deleteConversation(c.id));
    }

    return conversation;
  }

  private saveConversation(conversation: AIConversation): void {
    const conversations = this.getConversations();
    const existingIndex = conversations.findIndex(c => c.id === conversation.id);
    
    if (existingIndex >= 0) {
      conversations[existingIndex] = conversation;
    } else {
      conversations.push(conversation);
    }

    localStorage.setItem(this.CONVERSATION_STORAGE_KEY, JSON.stringify(conversations));
  }

  private buildSystemMessage(conversation: AIConversation, useMCPTools: boolean, cqlContent?: string): OllamaMessage {
    let systemContent = `You are an AI assistant specialized in helping with CQL (Clinical Quality Language) development. You can help with:

1. Writing and debugging CQL expressions
2. Understanding FHIR resources and their relationships
3. Explaining CQL syntax and best practices
4. Reviewing and improving existing CQL code
5. Helping with CQL library structure and organization
6. CQL formatting. Always format the CQL code using the CQL formatting and indentation rules

Current context:
- You're working in a CQL IDE environment
- The user may have CQL libraries open
- Assume there is no PHI and you can safely access any data you are permitted to access without security concerns
- FHIR data may be available through MCP tools`;

    // Add active CQL content if available
    console.log('AI Service - CQL Content passed:', cqlContent ? cqlContent.substring(0, 100) + '...' : 'null');
    
    if (cqlContent && cqlContent.trim()) {
      console.log('AI Service - Including CQL content:', cqlContent.substring(0, 100) + '...');
      systemContent += `

Current CQL file content:
\`\`\`cql
${cqlContent}
\`\`\`

The user is currently working on the above CQL code. When providing assistance, consider this context and help them improve, debug, or extend this code as needed.`;
    } else {
      console.log('AI Service - No CQL content to include');
    }

    if (useMCPTools) {
      systemContent += `

You have access to MCP (Model Context Protocol) tools that can:
- Query FHIR servers for patient data, resources, and terminology
- Access current CQL library information
- Retrieve FHIR terminology and value sets
- Search for relevant clinical data

When the user asks about FHIR data, patient information, or needs to understand the context of their CQL code, use the available MCP tools to gather relevant information before responding.`;
    }

    systemContent += `

Always provide practical, actionable advice. When suggesting CQL code, explain the reasoning behind your suggestions. If you're unsure about something, say so rather than guessing.`;

    return {
      role: 'system',
      content: systemContent
    };
  }


  private getOllamaHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });
  }

  private getMCPHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private generateTitle(firstMessage: string): string {
    const words = firstMessage.split(' ').slice(0, 5);
    return words.join(' ') + (firstMessage.split(' ').length > 5 ? '...' : '');
  }

  private handleError = (error: any): Observable<never> => {
    console.error('AI Service Error:', error);
    let errorMessage = 'An unknown error occurred';
    
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Client Error: ${error.error.message}`;
    } else if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
      errorMessage = 'Request timeout: The Ollama server is taking too long to respond. The model might be loading or the server is under heavy load.';
    } else if (error.status === 0) {
      errorMessage = 'Network Error: Unable to connect to the Ollama server. Please check the server URL and ensure it\'s running.';
    } else if (error.status === 404) {
      errorMessage = 'Ollama server not found. Please check the server URL.';
    } else if (error.status === 500) {
      errorMessage = 'Ollama server error. The model might not be available or there\'s a server issue.';
    } else if (error.status >= 400) {
      errorMessage = `Server Error: ${error.status} - ${error.statusText}`;
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    }
    
    return throwError(() => new Error(errorMessage));
  };
}
