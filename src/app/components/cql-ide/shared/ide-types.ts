// Author: Preston Lee

import { Library, Patient, Parameters } from 'fhir/r4';

export interface EditorFile {
  id: string;
  name: string;
  content: string;
  isDirty: boolean;
  isActive: boolean;
}

export interface LibraryResource {
  id: string;
  name: string;
  title?: string;
  version: string;
  description: string;
  url?: string;
  cqlContent: string;
  originalContent: string;
  isActive: boolean;
  isDirty: boolean;
  library: Library | null;
}

export interface OutlineItem {
  name: string;
  type: string;
  line: number;
}

export interface OutputSection {
  title: string;
  content: string;
  status: 'success' | 'error' | 'pending';
  executionTime?: number;
  expanded: boolean;
}

export interface ExecutionResult {
  libraryId: string;
  libraryName: string;
  patientId: string;
  patientName: string;
  result?: any;
  error?: any;
  executionTime: number;
}

export interface KeyboardShortcut {
  key: string;
  description: string;
}

export interface KeyboardShortcuts {
  general: KeyboardShortcut[];
  editor: KeyboardShortcut[];
  execution: KeyboardShortcut[];
  navigation: KeyboardShortcut[];
}

export type CqlVersion = '1.5.3' | '2.0.0-ballot';

export interface IdeSettings {
  preserveLogs: boolean;
  enableElmTranslation: boolean;
}
