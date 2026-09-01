// Author: Preston Lee

import { Injectable } from '@angular/core';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import * as mammoth from 'mammoth';

const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.json', '.xml', '.csv', '.docx', '.pdf'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_EXTRACTED_CHARS = 100_000;

let pdfWorkerInitialized = false;

function ensurePdfWorker(): void {
  if (pdfWorkerInitialized) {
    return;
  }
  GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  pdfWorkerInitialized = true;
}

function getExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.substring(i).toLowerCase() : '';
}

function isAccepted(file: File): boolean {
  const ext = getExtension(file.name);
  return ACCEPTED_EXTENSIONS.includes(ext);
}

@Injectable({
  providedIn: 'root'
})
export class AttachmentParserService {
  readonly acceptedExtensions = ACCEPTED_EXTENSIONS;

  parseFile(file: File): Promise<string> {
    const ext = getExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return Promise.reject(
        new Error(`Unsupported file type: ${file.name}. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`)
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return Promise.reject(
        new Error(`File too large: ${file.name} (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`)
      );
    }

    switch (ext) {
      case '.txt':
      case '.md':
      case '.xml':
      case '.csv':
        return this.readAsText(file);
      case '.json':
        return this.readAsJson(file);
      case '.docx':
        return this.parseDocx(file);
      case '.pdf':
        return this.parsePdf(file);
      default:
        return Promise.reject(new Error(`Unsupported file type: ${ext}`));
    }
  }

  private readAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = (reader.result as string) ?? '';
        resolve(this.truncate(text));
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsText(file);
    });
  }

  private readAsJson(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse((reader.result as string) ?? '');
          const text = JSON.stringify(parsed, null, 2);
          resolve(this.truncate(text));
        } catch (e) {
          reject(new Error(`Invalid JSON in ${file.name}: ${(e as Error).message}`));
        }
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsText(file);
    });
  }

  private parseDocx(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        mammoth
          .extractRawText({ arrayBuffer })
          .then((result) => resolve(this.truncate(result.value)))
          .catch((err: Error) => reject(new Error(`Failed to parse DOCX ${file.name}: ${err.message}`)));
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsArrayBuffer(file);
    });
  }

  private async parsePdf(file: File): Promise<string> {
    ensurePdfWorker();
    const arrayBuffer = await this.fileToArrayBuffer(file);
    const pdf = await getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const parts: string[] = [];
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? (item as { str: string }).str : ''))
        .join('');
      parts.push(pageText);
    }
    return this.truncate(parts.join('\n'));
  }

  private fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsArrayBuffer(file);
    });
  }

  private truncate(text: string): string {
    if (text.length <= MAX_EXTRACTED_CHARS) {
      return text;
    }
    return text.substring(0, MAX_EXTRACTED_CHARS) + '\n\n… (truncated)';
  }

  isAcceptedFile(file: File): boolean {
    return isAccepted(file);
  }
}
