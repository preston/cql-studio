// Author: Preston Lee

import { Bundle, Resource } from 'fhir/r4';

/**
 * Map a collection entry to a transaction entry when `request` is absent.
 * Used so POST to `[base]` sends `Bundle.type` `transaction` with `entry.request`
 * (`PUT {type}/{id}` or `POST {type}`), which HAPI and similar servers require
 * (e.g. HAPI-0527 rejects `collection` at the base URL).
 */
export function collectionEntryToTransactionEntry(
  e: NonNullable<Bundle<Resource>['entry']>[number]
): NonNullable<Bundle<Resource>['entry']>[number] {
  if (e.request) {
    return e;
  }
  const res = e.resource;
  if (!res?.resourceType) {
    return e;
  }
  const rt = res.resourceType;
  const rid = typeof (res as { id?: string }).id === 'string' ? (res as { id: string }).id.trim() : '';
  if (rid) {
    return {
      ...e,
      request: {
        method: 'PUT' as const,
        url: `${rt}/${encodeURIComponent(rid)}`
      }
    };
  }
  return {
    ...e,
    request: {
      method: 'POST' as const,
      url: rt
    }
  };
}

export function collectionBundleToTransaction(bundle: Bundle<Resource>): Bundle<Resource> {
  const entries = bundle.entry ?? [];
  return {
    ...bundle,
    type: 'transaction',
    entry: entries.map((entry) => collectionEntryToTransactionEntry(entry))
  };
}

/** Prepare a bundle for HTTP POST to the FHIR service root (`[base]`). */
export function normalizeBundleForBasePost(bundle: Bundle<Resource>): Bundle<Resource> {
  if (bundle.type === 'collection') {
    return collectionBundleToTransaction(bundle);
  }
  return bundle;
}
