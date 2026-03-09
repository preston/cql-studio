// Author: Preston Lee

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { AiService, MCPTool, MCPResponse } from './ai.service';
import { IdeStateService } from './ide-state.service';
import { SettingsService } from './settings.service';
import { ClipboardService } from './clipboard.service';
import { CqlValidationService } from './cql-validation.service';
import { CqlFormatterService } from './cql-formatter.service';
import { FhirClientService } from './fhir-client.service';
import { BrowserToolsRegistry } from './tools/browser-tools-registry';
import { FhirRequestToolRead, FhirRequestToolWrite, isWriteMethod } from './tools/fhir-request.tool';

export interface ToolCall {
  tool: string;
  params: Record<string, any>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  result?: any;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ToolOrchestratorService {
  private readonly browserTools: ReturnType<typeof BrowserToolsRegistry.createTools>;

  constructor(
    private aiService: AiService,
    private ideStateService: IdeStateService,
    private settingsService: SettingsService,
    private clipboardService: ClipboardService,
    private cqlValidationService: CqlValidationService,
    private cqlFormatterService: CqlFormatterService,
    private fhirClientService: FhirClientService
  ) {
    this.browserTools = BrowserToolsRegistry.createTools({
      ideStateService: this.ideStateService,
      settingsService: this.settingsService,
      clipboardService: this.clipboardService,
      cqlValidationService: this.cqlValidationService,
      cqlFormatterService: this.cqlFormatterService
    });
  }

  private get browserToolsByName(): Map<string, (typeof this.browserTools)[number]> {
    const map = new Map<string, (typeof this.browserTools)[number]>();
    this.browserTools.forEach(t => map.set(t.name, t));
    return map;
  }

  isBrowserNativeTool(toolName: string): boolean {
    return this.browserToolsByName.has(toolName);
  }

  getAvailableTools(): Observable<MCPTool[]> {
    const definitions = BrowserToolsRegistry.getDefinitions() as MCPTool[];
    return this.aiService.getMCPTools().pipe(
      map(serverTools => [...definitions, ...serverTools]),
      catchError(() => of([...definitions]))
    );
  }

  executeToolCall(toolName: string, params: any): Observable<ToolResult> {
    if (toolName === FhirRequestToolRead.id) {
      return this.executeFhirRequestToolRead(toolName, params);
    }
    if (toolName === FhirRequestToolWrite.id) {
      return this.executeFhirRequestToolWrite(toolName, params);
    }
    if (this.isBrowserNativeTool(toolName)) {
      return of(this.executeBrowserTool(toolName, params));
    }
    return this.executeServerTool(toolName, params);
  }

  private executeFhirRequestToolRead(toolName: string, params: any): Observable<ToolResult> {
    const path = params?.path != null ? String(params.path).trim() : '';
    if (!path) {
      return of({
        tool: toolName,
        success: false,
        error: `${toolName} requires 'path' parameter`
      });
    }
    return this.fhirClientService.request('GET', path).pipe(
      map(result => ({ tool: toolName, success: true, result })),
      catchError(err => of({
        tool: toolName,
        success: false,
        error: err?.message ?? err?.error?.message ?? 'FHIR request failed'
      }))
    );
  }

  private executeFhirRequestToolWrite(toolName: string, params: any): Observable<ToolResult> {
    const method = params?.method != null ? String(params.method).trim() : '';
    const path = params?.path != null ? String(params.path).trim() : '';
    if (!method || !path) {
      return of({
        tool: toolName,
        success: false,
        error: `${toolName} requires 'method' and 'path' parameters`
      });
    }
    const methodUpper = method.toUpperCase();
    if (!isWriteMethod(methodUpper)) {
      return of({
        tool: toolName,
        success: false,
        error: `${toolName} only accepts POST, PUT, PATCH, or DELETE`
      });
    }
    if (!this.settingsService.settings().allowAiWriteOperations) {
      return of({
        tool: toolName,
        success: false,
        error: 'AI write operations are disabled. Enable "Allow AI write operations" in Settings to allow write operations.'
      });
    }
    const body = params?.body != null && typeof params.body === 'object' ? params.body : undefined;
    return this.fhirClientService.request(methodUpper as 'POST' | 'PUT' | 'PATCH' | 'DELETE', path, body).pipe(
      map(result => ({ tool: toolName, success: true, result })),
      catchError(err => of({
        tool: toolName,
        success: false,
        error: err?.message ?? err?.error?.message ?? 'FHIR request failed'
      }))
    );
  }

  private executeBrowserTool(toolName: string, params: any): ToolResult {
    const tool = this.browserToolsByName.get(toolName);
    if (!tool) {
      return {
        tool: toolName,
        success: false,
        error: `Unknown browser-native tool: ${toolName}`
      };
    }
    try {
      const result = tool.execute(params ?? {});
      return { tool: toolName, success: true, result };
    } catch (error: any) {
      return {
        tool: toolName,
        success: false,
        error: error?.message ?? 'Tool execution failed'
      };
    }
  }

  private executeServerTool(toolName: string, params: any): Observable<ToolResult> {
    return this.aiService.executeMCPTool(toolName, params).pipe(
      map((response: MCPResponse) => ({
        tool: toolName,
        success: !response.error,
        result: response.result,
        error: response.error?.message
      })),
      catchError(error =>
        of({
          tool: toolName,
          success: false,
          error: error?.message ?? 'Server tool execution failed'
        })
      )
    );
  }
}
