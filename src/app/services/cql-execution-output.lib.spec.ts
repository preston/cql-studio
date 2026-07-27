// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  buildSeparateExecutionOutputSections,
  normalizeExecutionResults,
  shouldRenderExecutionResultsSeparately
} from './cql-execution-output.lib';

describe('cql-execution-output.lib', () => {
  it('flattens nested execution result arrays', () => {
    const results = normalizeExecutionResults([
      [{ patientId: 'p1', libraryName: 'Lib', executionTime: 1 }],
      [{ patientId: 'p2', libraryName: 'Lib', executionTime: 2 }]
    ]);

    expect(results).toHaveLength(2);
    expect(results.map(r => r.patientId)).toEqual(['p1', 'p2']);
  });

  it('uses patientIds to decide separate rendering when metadata is missing', () => {
    const results = normalizeExecutionResults([
      { libraryName: 'Lib', executionTime: 10, result: { a: 1 } },
      { libraryName: 'Lib', executionTime: 20, result: { a: 2 } }
    ]);

    expect(shouldRenderExecutionResultsSeparately(results, ['p1', 'p2'])).toBe(true);
  });

  it('builds one output section per result with patient labels from context', () => {
    const results = normalizeExecutionResults([
      { libraryName: 'Lib', executionTime: 10, result: { a: 1 } },
      { libraryName: 'Lib', executionTime: 20, result: { a: 2 } }
    ]);
    const patientNameById = new Map([
      ['p1', 'Alice Example'],
      ['p2', 'Bob Example']
    ]);

    const sections = buildSeparateExecutionOutputSections(
      results,
      'Library: Lib',
      ['p1', 'p2'],
      patientNameById,
      index => `section-${index}`
    );

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Library: Lib - Alice Example');
    expect(sections[1].title).toBe('Library: Lib - Bob Example');
    expect(JSON.parse(sections[0].content).patientId).toBe('p1');
    expect(JSON.parse(sections[1].content).patientId).toBe('p2');
  });
});
