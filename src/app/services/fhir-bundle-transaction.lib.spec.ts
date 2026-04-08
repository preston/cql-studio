// Author: Preston Lee

import { Bundle, Patient, Resource } from 'fhir/r4';
import { collectionBundleToTransaction, normalizeBundleForBasePost } from './fhir-bundle-transaction.lib';

describe('fhir-bundle-transaction.lib', () => {
  it('collectionBundleToTransaction adds PUT request when resource has id', () => {
    const patient: Patient = { resourceType: 'Patient', id: 'p1' };
    const bundle: Bundle<Resource> = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: patient }]
    };
    const tx = collectionBundleToTransaction(bundle);
    expect(tx.type).toBe('transaction');
    expect(tx.entry?.[0]?.request?.method).toBe('PUT');
    expect(tx.entry?.[0]?.request?.url).toBe('Patient/p1');
  });

  it('collectionBundleToTransaction adds POST request when resource has no id', () => {
    const patient: Patient = { resourceType: 'Patient' };
    const bundle: Bundle<Resource> = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: patient }]
    };
    const tx = collectionBundleToTransaction(bundle);
    expect(tx.entry?.[0]?.request?.method).toBe('POST');
    expect(tx.entry?.[0]?.request?.url).toBe('Patient');
  });

  it('normalizeBundleForBasePost leaves transaction bundles unchanged', () => {
    const bundle: Bundle<Resource> = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: []
    };
    expect(normalizeBundleForBasePost(bundle)).toBe(bundle);
  });

  it('collectionBundleToTransaction maps multiple resources with ids to PUT entries', () => {
    const bundle: Bundle<Resource> = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'a' } as Resource },
        { resource: { resourceType: 'Observation', id: 'b' } as Resource }
      ]
    };
    const tx = collectionBundleToTransaction(bundle);
    expect(tx.entry?.map((e) => e.request?.url)).toEqual(['Patient/a', 'Observation/b']);
  });
});
