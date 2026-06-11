/**
 * Value Set Extractor
 *
 * Reads the `valueSets.def` section of an ELM library and returns a flat list
 * of { name, url } references — one entry per `valueset` declaration in the
 * original CQL source.
 *
 * These references are the canonical URLs (or OID URIs) that the transpiler
 * embeds in `value_set_expansion` lookup subqueries:
 *   code IN (SELECT code FROM value_set_expansion WHERE value_set_id = '<url>')
 */

import type { ElmLibrary, ElmLibraryWrapper, ElmValueSetDef } from '../types/elm';

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single value set reference as declared in a CQL/ELM library. */
export interface ValueSetReference {
  /** CQL local name, e.g. "Office Visit" */
  name: string;
  /**
   * Canonical URL or OID URI, e.g.
   * "http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.101.12.1001"
   *
   * This is the `value_set_id` column in `value_set_expansion`.
   */
  url: string;
  /** Optional version constraint from the CQL `valueset` declaration. */
  version?: string;
}

// ─── Implementation ───────────────────────────────────────────────────────────

function resolveLibrary(input: ElmLibraryWrapper | ElmLibrary): ElmLibrary {
  return 'library' in input ? (input as ElmLibraryWrapper).library : (input as ElmLibrary);
}

/**
 * Extract all value set references declared in an ELM library.
 *
 * Returns one entry per `valueset` declaration, in declaration order.
 * Duplicate URLs (same set referenced under different aliases) are preserved.
 *
 * @example
 * const refs = extractValueSets(elmJson);
 * // [{ name: 'Office Visit', url: 'http://cts.nlm.nih.gov/fhir/ValueSet/...' }, ...]
 */
export function extractValueSets(input: ElmLibraryWrapper | ElmLibrary): ValueSetReference[] {
  const lib = resolveLibrary(input);
  const defs: ElmValueSetDef[] = lib.valueSets?.def ?? [];
  return defs.map(d => ({
    name: d.name,
    url: d.id,
    ...(d.version ? { version: d.version } : {}),
  }));
}

/**
 * Returns only the value set references that are actually used (referenced via
 * `ValueSetRef`) in the library's statements. Useful for trimming the list
 * before loading — avoids fetching sets declared but not referenced in this
 * specific library.
 *
 * Scans the raw ELM JSON text for `"name":"<vsName>"` patterns under a
 * `ValueSetRef` parent. Simple string scan rather than AST walk — fast and
 * sufficient for determining presence.
 */
export function extractUsedValueSets(input: ElmLibraryWrapper | ElmLibrary): ValueSetReference[] {
  const all = extractValueSets(input);
  if (all.length === 0) return [];

  // Serialise statements portion only for the scan
  const lib = resolveLibrary(input);
  const statementsJson = JSON.stringify(lib.statements ?? {});

  return all.filter(ref => {
    // Look for any ValueSetRef whose name matches this declaration
    const escaped = ref.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `"type"\\s*:\\s*"ValueSetRef"[^}]*?"name"\\s*:\\s*"${escaped}"` +
      `|"name"\\s*:\\s*"${escaped}"[^}]*?"type"\\s*:\\s*"ValueSetRef"`,
    );
    return pattern.test(statementsJson);
  });
}
