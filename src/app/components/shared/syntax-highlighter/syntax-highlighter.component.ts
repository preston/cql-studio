// Author: Preston Lee

import { Component, Input, AfterViewInit, OnChanges, SimpleChanges, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import PrismJS dynamically to avoid CommonJS issues
declare const Prism: any;

@Component({
  selector: 'app-syntax-highlighter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './syntax-highlighter.component.html',
  styleUrls: ['./syntax-highlighter.component.scss']
})
export class SyntaxHighlighterComponent implements AfterViewInit, OnChanges {
  @Input() code: string = '';
  @Input() language: string = 'json';
  @ViewChild('codeElement') codeElement!: ElementRef;
  @ViewChild('preElement') preElement!: ElementRef;

  ngAfterViewInit(): void {
    this.highlightCode();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['code'] || changes['language']) {
      this.highlightCode();
    }
  }

  private highlightCode(): void {
    if (this.preElement && this.code) {
      if (typeof Prism !== 'undefined') {
        // Auto-detect language if not specified
        const detectedLanguage = this.detectLanguage();
        const languageClass = `language-${detectedLanguage}`;
        
        // Set the language class on the code element
        if (this.codeElement) {
          this.codeElement.nativeElement.className = languageClass;
        }
        
        // Use PrismJS to highlight and apply line numbers
        Prism.highlightAllUnder(this.preElement.nativeElement);
      } else {
        // PrismJS not loaded yet, retry after a short delay
        setTimeout(() => {
          this.highlightCode();
        }, 100);
      }
    }
  }

  private detectLanguage(): string {
    if (this.language && this.language !== 'auto') {
      return this.language;
    }

    // Auto-detect based on content
    const trimmedCode = this.code.trim();
    
    // Check for JSON
    if (trimmedCode.startsWith('{') || trimmedCode.startsWith('[')) {
      try {
        JSON.parse(trimmedCode);
        return 'json';
      } catch {
        // Not valid JSON, continue detection
      }
    }
    
    // Check for XML
    if (trimmedCode.startsWith('<')) {
      return 'xml-doc';
    }
    
    // Check for JavaScript
    if (trimmedCode.includes('function') || trimmedCode.includes('=>')) {
      return 'javascript';
    }
    
    // Default to JSON for most cases
    return 'json';
  }
}
