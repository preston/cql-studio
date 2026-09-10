// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  libraryIdsForTabCloseAction,
  nextActiveLibraryIdAfterClose,
} from './editor-tab-close.lib';

const tabs = [
  { id: 'a', isDirty: false },
  { id: 'b', isDirty: true },
  { id: 'c', isDirty: false },
  { id: 'd', isDirty: true },
];

describe('libraryIdsForTabCloseAction', () => {
  it('closes only the target tab', () => {
    expect(libraryIdsForTabCloseAction('close', tabs, 'b')).toEqual(['b']);
  });

  it('closes every tab except the target', () => {
    expect(libraryIdsForTabCloseAction('closeOthers', tabs, 'b')).toEqual(['a', 'c', 'd']);
  });

  it('closes tabs to the right of the target', () => {
    expect(libraryIdsForTabCloseAction('closeToTheRight', tabs, 'b')).toEqual(['c', 'd']);
    expect(libraryIdsForTabCloseAction('closeToTheRight', tabs, 'd')).toEqual([]);
  });

  it('closes only saved tabs', () => {
    expect(libraryIdsForTabCloseAction('closeSaved', tabs, 'b')).toEqual(['a', 'c']);
  });

  it('closes all tabs', () => {
    expect(libraryIdsForTabCloseAction('closeAll', tabs, 'b')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('no-ops close/closeOthers/closeToTheRight when the target tab is missing', () => {
    expect(libraryIdsForTabCloseAction('close', tabs, 'missing')).toEqual([]);
    expect(libraryIdsForTabCloseAction('closeOthers', tabs, 'missing')).toEqual([]);
    expect(libraryIdsForTabCloseAction('closeToTheRight', tabs, 'missing')).toEqual([]);
  });
});

describe('nextActiveLibraryIdAfterClose', () => {
  it('does not change active when the active tab stays open', () => {
    expect(nextActiveLibraryIdAfterClose(tabs, 'b', ['a', 'c'])).toBeUndefined();
  });

  it('prefers the nearest remaining tab to the left', () => {
    expect(nextActiveLibraryIdAfterClose(tabs, 'c', ['c', 'd'])).toBe('b');
  });

  it('falls back to the nearest remaining tab to the right', () => {
    expect(nextActiveLibraryIdAfterClose(tabs, 'a', ['a', 'b'])).toBe('c');
  });

  it('clears active when every tab closes', () => {
    expect(nextActiveLibraryIdAfterClose(tabs, 'b', ['a', 'b', 'c', 'd'])).toBeNull();
  });
});
