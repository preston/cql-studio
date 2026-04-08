// Author: Preston Lee

import { Resource } from 'fhir/r4';

/**
 * HAPI (HAPI-0960) rejects client-assigned logical ids that contain only digits.
 * Registry packages such as hl7.fhir.r4.core may use numeric-only ids; we rewrite
 * them to a stable prefixed form and fix relative Reference.reference values.
 */
const NUMERIC_ONLY_ID = /^\d+$/;

function visitResourcesDepthFirst(root: Resource, visit: (r: Resource) => void): void {
  const stack: Resource[] = [root];
  while (stack.length > 0) {
    const r = stack.pop()!;
    visit(r);
    const contained = (r as { contained?: Resource[] }).contained;
    if (Array.isArray(contained)) {
      for (const c of contained) {
        if (c?.resourceType) {
          stack.push(c);
        }
      }
    }
  }
}

function rewriteReferenceValue(value: string, remap: Map<string, string>): string {
  const pipe = value.indexOf('|');
  const refPart = pipe >= 0 ? value.slice(0, pipe) : value;
  const rest = pipe >= 0 ? value.slice(pipe) : '';
  const mapped = remap.get(refPart);
  return mapped != null ? mapped + rest : value;
}

function rewriteReferencesDeep(node: unknown, remap: Map<string, string>): void {
  if (node === null || node === undefined) {
    return;
  }
  if (typeof node === 'string') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      rewriteReferencesDeep(item, remap);
    }
    return;
  }
  if (typeof node !== 'object') {
    return;
  }
  const o = node as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (k === 'reference' && typeof v === 'string') {
      o[k] = rewriteReferenceValue(v, remap);
    } else {
      rewriteReferencesDeep(v, remap);
    }
  }
}

function applyNumericIdPrefixToTree(root: Resource): void {
  visitResourcesDepthFirst(root, (res) => {
    const id = typeof (res as { id?: string }).id === 'string' ? (res as { id: string }).id.trim() : '';
    if (!id || !NUMERIC_ONLY_ID.test(id)) {
      return;
    }
    (res as { id: string }).id = `n${id}`;
  });
}

/**
 * For one transaction, build remap from every logical id (all roots and contained),
 * apply `n`+digit ids, then rewrite references so cross-resource links stay valid.
 */
export function applyHapiNumericIdRulesToTransactionRoots(roots: Resource[]): void {
  const remap = new Map<string, string>();
  for (const root of roots) {
    visitResourcesDepthFirst(root, (res) => {
      const id = typeof (res as { id?: string }).id === 'string' ? (res as { id: string }).id.trim() : '';
      if (!id || !NUMERIC_ONLY_ID.test(id)) {
        return;
      }
      remap.set(`${res.resourceType}/${id}`, `${res.resourceType}/n${id}`);
    });
  }
  if (remap.size === 0) {
    return;
  }
  for (const root of roots) {
    applyNumericIdPrefixToTree(root);
    rewriteReferencesDeep(root, remap);
  }
}

/**
 * Mutates `root` in place: prefixes numeric-only logical ids and rewrites
 * `reference` strings that pointed at the old relative URLs (single-root graph only).
 */
export function mangleNumericOnlyIdsForHapi(root: Resource): void {
  applyHapiNumericIdRulesToTransactionRoots([root]);
}

/**
 * Deep-clones each resource, applies HAPI-safe id rules across the full transaction
 * so references between separate bundle entries are rewritten consistently.
 */
export function cloneResourcesWithHapiSafeClientIds(resources: Resource[]): Resource[] {
  const clones = resources.map((r) => structuredClone(r) as Resource);
  applyHapiNumericIdRulesToTransactionRoots(clones);
  return clones;
}
