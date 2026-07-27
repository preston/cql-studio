// Author: Preston Lee

import { OutputSection } from '../components/cql-ide/shared/ide-types';

export interface ExecutionResultLike {
  libraryId?: string;
  libraryName?: string;
  patientId?: string;
  patientName?: string;
  functionName?: string;
  executionTime?: number;
  error?: unknown;
  result?: unknown;
}

export function normalizeExecutionResults(results: unknown): ExecutionResultLike[] {
  if (!results) {
    return [];
  }
  if (Array.isArray(results)) {
    return results.flat() as ExecutionResultLike[];
  }
  return [results as ExecutionResultLike];
}

export function shouldRenderExecutionResultsSeparately(
  results: ExecutionResultLike[],
  patientIds: string[]
): boolean {
  return patientIds.length > 0 || results.some(r => r.patientId);
}

export function buildSeparateExecutionOutputSections(
  results: ExecutionResultLike[],
  title: string,
  patientIds: string[],
  patientNameById: ReadonlyMap<string, string>,
  createSectionId: (index: number) => string
): OutputSection[] {
  return results.map((r, index) => {
    const patientId = r.patientId ?? patientIds[index];
    const patientLabel = r.patientName
      ?? (patientId ? patientNameById.get(patientId) ?? `Patient ${patientId}` : `Patient ${index + 1}`);
    const status = r.error ? 'error' : 'success';
    const executionTime = r.executionTime || 0;
    const librarySuffix = r.libraryName && !title.includes(r.libraryName) ? ` (${r.libraryName})` : '';

    return {
      id: createSectionId(index),
      title: `${title}${librarySuffix} - ${patientLabel}`,
      content: JSON.stringify({
        libraryId: r.libraryId,
        libraryName: r.libraryName,
        patientId,
        patientName: r.patientName ?? patientNameById.get(patientId ?? ''),
        functionName: r.functionName,
        executionTime: r.executionTime,
        error: r.error ?? undefined,
        result: r.result ?? undefined
      }),
      type: 'json' as const,
      status,
      executionTime,
      expanded: true,
      timestamp: new Date()
    };
  });
}
