// Author: Preston Lee

import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { Bundle, Group } from 'fhir/r4';
import { GroupService } from './group.service';

function createGroupService() {
  const service = Object.create(GroupService.prototype) as GroupService;
  service.selectedGroups = [];
  service.settingsService = {
    getEndpointHttpContext: () => ({ address: 'http://localhost/data', headers: {} }),
    getActiveEnvironment: () => ({ dataEndpoint: { address: 'http://localhost/data' } }),
    getEffectiveDataEndpointAddress: () => 'http://localhost/data'
  };
  service.http = {
    get: vi.fn(() => of({ resourceType: 'Bundle', type: 'searchset', entry: [] }))
  };
  return service;
}

describe('GroupService', () => {
  it('searches actual person groups using supported HAPI parameters', () => {
    const service = createGroupService();
    service.search('cohort').subscribe();
    expect(service.http.get).toHaveBeenCalledWith(
      'http://localhost/data/Group?actual=true&type=person&_count=100',
      expect.any(Object)
    );
  });

  it('filters returned groups client-side by name, id, or identifier', () => {
    const service = createGroupService();
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [
        { resource: { resourceType: 'Group', type: 'person', actual: true, id: 'g1', name: 'Female Example Patients' } },
        { resource: { resourceType: 'Group', type: 'person', actual: true, id: 'g2', name: 'Other Cohort' } }
      ]
    };
    service.http.get = vi.fn(() => of(bundle));

    let result: Bundle | undefined;
    service.search('female').subscribe(b => { result = b; });

    expect(result?.entry).toHaveLength(1);
    expect((result?.entry?.[0]?.resource as Group).id).toBe('g1');
  });

  it('adds, tracks, and removes actual groups', () => {
    const service = createGroupService();
    const group: Group = { resourceType: 'Group', type: 'person', actual: true, id: 'g1', name: 'Cohort A' };
    service.addGroup(group);
    expect(service.hasGroup('g1')).toBe(true);
    expect(service.selectedGroups).toHaveLength(1);
    service.removeGroup('g1');
    expect(service.hasGroup('g1')).toBe(false);
  });

  it('rejects non-actual groups', () => {
    const service = createGroupService();
    const group: Group = { resourceType: 'Group', type: 'person', actual: false, id: 'def1', name: 'Definitional' };
    service.addGroup(group);
    expect(service.selectedGroups).toHaveLength(0);
  });

  it('resolves display name from name, identifier, or id', () => {
    const service = createGroupService();
    expect(service.getDisplayName({ resourceType: 'Group', type: 'person', actual: true, name: 'My Group' })).toBe('My Group');
    expect(service.getDisplayName({
      resourceType: 'Group',
      type: 'person',
      actual: true,
      identifier: [{ value: 'id-value' }]
    })).toBe('id-value');
    expect(service.getDisplayName({ resourceType: 'Group', type: 'person', actual: true, id: 'g99' })).toBe('g99');
  });
});
