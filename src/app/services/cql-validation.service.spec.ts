// Author: Preston Lee

import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { CqlValidationService } from './cql-validation.service';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';
import { TranslationService } from './translation.service';

describe('CqlValidationService', () => {
  function configureServiceWithErrors(errors: any[]): CqlValidationService {
    const injector = Injector.create({
      providers: [
        CqlValidationService,
        CqlLocatorUtilsService,
        {
          provide: TranslationService,
          useValue: {
            translateCqlToElmRaw: () => ({
              elmXml: null,
              errors,
              warnings: [],
              messages: [],
              hasErrors: errors.length > 0
            })
          }
        }
      ]
    });

    return injector.get(CqlValidationService);
  }

  it('deduplicates equivalent CodeMirror diagnostics', () => {
    const duplicateError = {
      message: 'Syntax error at ,',
      locator: {
        w8z_1: {},
        x8z_1: 2,
        y8z_1: 7,
        z8z_1: 2,
        a90_1: 16
      }
    };
    const service = configureServiceWithErrors([duplicateError, duplicateError]);
    const doc = {
      line: () => ({ from: 24, length: 20, to: 44 })
    };

    const result = service.validate('library Test', doc);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      message: 'Syntax error at ,',
      line: 2,
      column: 7,
      from: 31,
      to: 44
    });
  });

  it('deduplicates equivalent structured errors for the Problems panel', () => {
    const duplicateError = {
      message: 'Syntax error at ,',
      locator: {
        w8z_1: {},
        x8z_1: 2,
        y8z_1: 7,
        z8z_1: 2,
        a90_1: 16
      }
    };
    const service = configureServiceWithErrors([duplicateError, duplicateError]);

    const result = service.getStructuredErrors('library Test');

    expect(result).toEqual([
      {
        message: 'Syntax error at ,',
        line: 2,
        column: 7,
        severity: 'error',
        formattedMessage: 'Syntax error at , (line 2, column 7)'
      }
    ]);
  });
});
