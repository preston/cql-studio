// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { IdeStateService } from './ide-state.service';
import { OutputSection } from '../components/cql-ide/shared/ide-types';

function makeSection(id: string, title: string): OutputSection {
  return {
    id,
    title,
    content: `content-${id}`,
    type: 'text',
    status: 'success',
    expanded: true,
    timestamp: new Date()
  };
}

describe('IdeStateService output sections', () => {
  it('replaces console with full batch when preserveLogs is false', () => {
    const service = new IdeStateService();
    service.setPreserveLogs(false);
    service.addOutputSection(makeSection('existing', 'Existing'));

    service.addOutputSections([
      makeSection('a', 'Patient A'),
      makeSection('b', 'Patient B'),
      makeSection('c', 'Patient C')
    ]);

    const sections = service.outputSections();
    expect(sections).toHaveLength(3);
    expect(sections.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps single-section replace behavior when preserveLogs is false', () => {
    const service = new IdeStateService();
    service.setPreserveLogs(false);

    service.addOutputSection(makeSection('a', 'First'));
    service.addOutputSection(makeSection('b', 'Second'));

    const sections = service.outputSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('b');
  });

  it('appends batches in order when preserveLogs is true', () => {
    const service = new IdeStateService();
    service.setPreserveLogs(true);

    service.addOutputSections([
      makeSection('a', 'Patient A'),
      makeSection('b', 'Patient B')
    ]);
    service.addOutputSections([
      makeSection('c', 'Patient C')
    ]);

    const sections = service.outputSections();
    expect(sections.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('no-ops on empty batch', () => {
    const service = new IdeStateService();
    service.setPreserveLogs(false);
    service.addOutputSection(makeSection('existing', 'Existing'));

    service.addOutputSections([]);

    expect(service.outputSections()).toHaveLength(1);
    expect(service.outputSections()[0].id).toBe('existing');
  });
});
