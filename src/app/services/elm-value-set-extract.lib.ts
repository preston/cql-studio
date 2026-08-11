// Author: Preston Lee

/** Minimal ELM shapes needed to read `valueSets.def`. */
export interface ElmValueSetDefRef {
  name: string;
  id: string;
  version?: string;
}

export interface ElmLibraryForValueSets {
  valueSets?: { def?: ElmValueSetDefRef[] };
  statements?: unknown;
}

export interface ElmLibraryWrapperForValueSets {
  library: ElmLibraryForValueSets;
}

/** A single value set reference as declared in a CQL/ELM library. */
export interface ElmValueSetReference {
  name: string;
  url: string;
  version?: string;
}

function resolveLibrary(
  input: ElmLibraryWrapperForValueSets | ElmLibraryForValueSets
): ElmLibraryForValueSets {
  return 'library' in input ? input.library : input;
}

/**
 * Extract all value set references declared in an ELM library (`valueSets.def`).
 */
export function extractElmValueSets(
  input: ElmLibraryWrapperForValueSets | ElmLibraryForValueSets
): ElmValueSetReference[] {
  const lib = resolveLibrary(input);
  const defs = lib.valueSets?.def ?? [];
  return defs.map((d) => ({
    name: d.name,
    url: d.id,
    ...(d.version ? { version: d.version } : {})
  }));
}

/**
 * Returns only value set references used via `ValueSetRef` in statements.
 */
export function extractUsedElmValueSets(
  input: ElmLibraryWrapperForValueSets | ElmLibraryForValueSets
): ElmValueSetReference[] {
  const all = extractElmValueSets(input);
  if (all.length === 0) {
    return [];
  }

  const lib = resolveLibrary(input);
  const statementsJson = JSON.stringify(lib.statements ?? {});

  return all.filter((ref) => {
    const escaped = ref.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `"type"\\s*:\\s*"ValueSetRef"[^}]*?"name"\\s*:\\s*"${escaped}"` +
        `|"name"\\s*:\\s*"${escaped}"[^}]*?"type"\\s*:\\s*"ValueSetRef"`
    );
    return pattern.test(statementsJson);
  });
}

export function parseElmJsonForValueSets(elmJson: string): ElmLibraryWrapperForValueSets | null {
  try {
    const parsed = JSON.parse(elmJson) as ElmLibraryWrapperForValueSets | ElmLibraryForValueSets;
    if (parsed && typeof parsed === 'object') {
      if ('library' in parsed) {
        return parsed;
      }
      return { library: parsed };
    }
  } catch {
    return null;
  }
  return null;
}
