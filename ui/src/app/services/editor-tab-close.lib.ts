// Author: Preston Lee

export type EditorTabCloseAction =
  | 'close'
  | 'closeOthers'
  | 'closeToTheRight'
  | 'closeSaved'
  | 'closeAll';

export interface EditorTabCloseTarget {
  id: string;
  isDirty: boolean;
}

export function libraryIdsForTabCloseAction(
  action: EditorTabCloseAction,
  resources: readonly EditorTabCloseTarget[],
  targetLibraryId: string
): string[] {
  const index = resources.findIndex(library => library.id === targetLibraryId);

  switch (action) {
    case 'close':
      return index < 0 ? [] : [targetLibraryId];
    case 'closeOthers':
      return index < 0
        ? []
        : resources.filter(library => library.id !== targetLibraryId).map(library => library.id);
    case 'closeToTheRight':
      return index < 0 ? [] : resources.slice(index + 1).map(library => library.id);
    case 'closeSaved':
      return resources.filter(library => !library.isDirty).map(library => library.id);
    case 'closeAll':
      return resources.map(library => library.id);
  }
}

export function nextActiveLibraryIdAfterClose(
  resources: readonly { id: string }[],
  activeId: string | null,
  idsToClose: readonly string[]
): string | null | undefined {
  if (!activeId || idsToClose.length === 0) return undefined;
  const idSet = new Set(idsToClose);
  if (!idSet.has(activeId)) return undefined;

  const activeIdx = resources.findIndex(resource => resource.id === activeId);
  if (activeIdx < 0) return null;

  for (let i = activeIdx - 1; i >= 0; i--) {
    if (!idSet.has(resources[i].id)) return resources[i].id;
  }
  for (let i = activeIdx + 1; i < resources.length; i++) {
    if (!idSet.has(resources[i].id)) return resources[i].id;
  }
  return null;
}
