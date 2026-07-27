// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';

describe('CqlLocatorUtilsService', () => {
  it('uses TrackBack start fields instead of guessing from numeric values', () => {
    const service = new CqlLocatorUtilsService();

    const locatorInfo = service.extractLocatorInfo({
      message: 'Could not load source',
      locator: {
        w8z_1: {},
        x8z_1: 3,
        y8z_1: 1,
        z8z_1: 3,
        a90_1: 35
      }
    } as any);

    expect(locatorInfo).toEqual({ line: 3, column: 1 });
  });
});
