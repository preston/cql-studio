// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { TranslationService, RawTranslationResult } from './translation.service';
import { CqlCompilerException } from '@cqframework/cql/cql-to-elm';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';
import type { CqlValidationDoc } from '../models/cql-validation-doc.model';

export type { CqlValidationDoc } from '../models/cql-validation-doc.model';

export interface ValidationError {
  message: string;
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  line: number | null;
  column: number | null;
}

export interface StructuredError {
  message: string;
  line: number | null;
  column: number | null;
  severity: 'error' | 'warning' | 'info';
  formattedMessage: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationError[];
  messages: ValidationError[];
  hasErrors: boolean;
}

export interface FullValidationResult {
  raw: RawTranslationResult;
  validation: ValidationResult;
  structuredErrors: StructuredError[];
  structuredWarnings: StructuredError[];
}

const EMPTY_RAW: RawTranslationResult = {
  elmXml: null,
  elmJson: null,
  errors: [],
  warnings: [],
  messages: [],
  hasErrors: false
};

const EMPTY_VALIDATION: ValidationResult = {
  errors: [],
  warnings: [],
  messages: [],
  hasErrors: false
};

@Injectable({
  providedIn: 'root'
})
export class CqlValidationService {
  private translationService = inject(TranslationService);
  private locatorUtils = inject(CqlLocatorUtilsService);

  validate(cql: string, doc?: CqlValidationDoc): ValidationResult {
    return this.runFullValidation(cql, doc).validation;
  }

  /** Single translator invocation; prefer this when you need errors and warnings together. */
  runFullValidation(cql: string, doc?: CqlValidationDoc): FullValidationResult {
    if (!cql?.trim()) {
      return {
        raw: EMPTY_RAW,
        validation: EMPTY_VALIDATION,
        structuredErrors: [],
        structuredWarnings: []
      };
    }
    const raw = this.translationService.translateCqlToElmRaw(cql);
    return {
      raw,
      validation: this.validateFromRaw(raw, doc),
      structuredErrors: this.getStructuredErrorsFromRaw(raw),
      structuredWarnings: this.getStructuredWarningsFromRaw(raw)
    };
  }

  formatProblemsPanelMessages(full: FullValidationResult): string[] {
    return [
      ...full.structuredErrors.map(e => `Error: ${e.formattedMessage}`),
      ...full.structuredWarnings.map(w => `Warning: ${w.formattedMessage}`)
    ];
  }

  validateFromRaw(rawResult: RawTranslationResult, doc?: CqlValidationDoc): ValidationResult {
    const errors = this.convertExceptionsToValidationErrors(rawResult.errors, 'error', doc);
    const warnings = this.convertExceptionsToValidationErrors(rawResult.warnings, 'warning', doc);
    const messages = this.convertExceptionsToValidationErrors(rawResult.messages, 'info', doc);

    return {
      errors,
      warnings,
      messages,
      hasErrors: rawResult.hasErrors
    };
  }

  /**
   * Convert CqlCompilerException objects to ValidationError format with positions
   * Uses shared locator utility to extract line/column information
   */
  private convertExceptionsToValidationErrors(
    exceptions: CqlCompilerException[],
    severity: 'error' | 'warning' | 'info',
    doc?: CqlValidationDoc
  ): ValidationError[] {
    return exceptions.map(exception => {
      const message = exception.message || 'Unknown error';
      
      // Extract line/column using shared utility
      const locatorInfo = this.locatorUtils.extractLocatorInfo(exception);
      const lineNumber = locatorInfo.line;
      const columnNumber = locatorInfo.column;
      
      let from = 0;
      let to = 0;
      
      // Calculate CodeMirror positions if we have line/column and document
      if (lineNumber != null && doc) {
        try {
          // Get line info using 1-based line number (CodeMirror uses 1-based)
          const startLine = doc.line(lineNumber);
          
          // Calculate position: line start + column offset
          // Column numbers from TrackBack appear to be 0-based (matches CodeMirror)
          // If columnNumber is null, default to 0 (start of line)
          const columnOffset = columnNumber != null 
            ? Math.max(0, Math.min(columnNumber, startLine.length ?? startLine.to - startLine.from))
            : 0;
          from = startLine.from + columnOffset;
          
          // Since we don't have endLine/endChar, highlight to end of line
          // This provides better visibility than highlighting just one character
          to = startLine.to;
          
          // Ensure to is at least from (should always be true, but safety check)
          if (to < from) {
            to = from + 1;
          }
        } catch (e) {
          // If line doesn't exist (e.g., line number out of range), use start of document
          from = 0;
          to = 0;
        }
      }
      
      return {
        message,
        from,
        to,
        severity,
        line: lineNumber,
        column: columnNumber
      };
    });
  }

  /**
   * Get structured errors with line/column information
   */
  getStructuredErrors(cql: string): StructuredError[] {
    return this.runFullValidation(cql).structuredErrors;
  }

  getStructuredErrorsFromRaw(rawResult: RawTranslationResult): StructuredError[] {
    return rawResult.errors.map(e => {
      const locatorInfo = this.locatorUtils.extractLocatorInfo(e);
      const formattedMessage = this.locatorUtils.formatLocator(locatorInfo);
      return {
        message: e.message || 'Unknown error',
        line: locatorInfo.line,
        column: locatorInfo.column,
        severity: 'error' as const,
        formattedMessage: `${e.message || 'Unknown error'} ${formattedMessage}`.trim()
      };
    });
  }

  getStructuredWarnings(cql: string): StructuredError[] {
    return this.runFullValidation(cql).structuredWarnings;
  }

  getStructuredWarningsFromRaw(rawResult: RawTranslationResult): StructuredError[] {
    return rawResult.warnings.map(e => {
      const locatorInfo = this.locatorUtils.extractLocatorInfo(e);
      const formattedMessage = this.locatorUtils.formatLocator(locatorInfo);
      return {
        message: e.message || 'Unknown warning',
        line: locatorInfo.line,
        column: locatorInfo.column,
        severity: 'warning' as const,
        formattedMessage: `${e.message || 'Unknown warning'} ${formattedMessage}`.trim()
      };
    });
  }

  /**
   * Get formatted error messages (for display in Problems panel)
   * @deprecated Use getStructuredErrors() instead for better structure
   */
  getFormattedErrors(cql: string): string[] {
    return this.getStructuredErrors(cql).map(e => e.formattedMessage);
  }

  /**
   * Get formatted warning messages (for display in Problems panel)
   * @deprecated Use getStructuredWarnings() instead for better structure
   */
  getFormattedWarnings(cql: string): string[] {
    return this.getStructuredWarnings(cql).map(e => e.formattedMessage);
  }
}
