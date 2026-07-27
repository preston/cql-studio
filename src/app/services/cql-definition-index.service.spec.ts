// Author: Preston Lee

import '@angular/compiler';
// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ModelManager,
  LibraryManager,
  CqlTranslator,
  createModelInfoProvider,
  createLibrarySourceProvider,
  createUcumService,
  stringAsSource
} from '@cqframework/cql/cql-to-elm';
import { CqlDefinitionIndexService } from './cql-definition-index.service';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { ElmIncludeParser } from './elm-include.lib';
import { TranslationService } from './translation.service';
import { findReferenceAt, parseLocator } from './elm-locator.lib';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const helloCommonElm = readFileSync(join(fixturesDir, 'hello-common.elm.xml'), 'utf8');
const cqlDir = join(process.cwd(), 'public/cql');
const fhirHelpers = readFileSync(join(cqlDir, 'FHIRHelpers-4.0.1.cql'), 'utf8');
const systemModelInfo = readFileSync(join(cqlDir, 'system-modelinfo.xml'), 'utf8');
const fhirModelInfo = readFileSync(join(cqlDir, 'fhir-modelinfo-4.0.1.xml'), 'utf8');

const helloCommonV1 = `library HelloCommon version '0.0.0'
include FHIRHelpers version '4.0.1'
define function MagicNumber(): 42`;

const helloWorld = `library HelloWorld version '1.0.0'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'
include HelloCommon version '0.0.0' called Common
define x: Common.MagicNumber()`;

function cacheKey(path: string, version: string): string {
  return `|${path}|${version}`;
}

describe('CqlDefinitionIndexService', () => {
  let service: CqlDefinitionIndexService;
  let cqlCache: Map<string, string>;

  beforeEach(() => {
    cqlCache = new Map([[cacheKey('HelloCommon', '0.0.0'), helloCommonV1]]);

    const librarySourceService = Object.create(CqlLibrarySourceService.prototype) as CqlLibrarySourceService & {
      cqlCache: Map<string, string>;
      elmCache: Map<string, string>;
      elmIncludeParser: ElmIncludeParser;
    };
    librarySourceService.cqlCache = cqlCache;
    librarySourceService.elmCache = new Map([[cacheKey('HelloCommon', '0.0.0'), helloCommonElm]]);
    librarySourceService.elmIncludeParser = new ElmIncludeParser();

    const translationService = Object.create(TranslationService.prototype) as TranslationService & {
      translateCqlToElmRaw: (cql: string) => { elmXml: string | null };
    };
    translationService.translateCqlToElmRaw = () => ({ elmXml: helloCommonElm });

    service = Object.create(CqlDefinitionIndexService.prototype) as CqlDefinitionIndexService & {
      includeParser: ElmIncludeParser;
      librarySourceService: CqlLibrarySourceService;
      libraryService: { findByNameAndVersion: () => never };
      translationService: TranslationService;
      includedIndexCache: Map<string, unknown>;
    };
    service.includeParser = new ElmIncludeParser();
    service.librarySourceService = librarySourceService;
    service.libraryService = {
      findByNameAndVersion: () => {
        throw new Error('should not fetch from server in this test');
      }
    } as never;
    service.translationService = translationService;
    service.includedIndexCache = new Map();
  });

  it('resolves cross-library FunctionRef via included library index', async () => {
    const modelManager = new ModelManager(undefined, true);
    modelManager.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) {
          return stringAsSource(systemModelInfo);
        }
        if (id === 'FHIR' && !system && version === '4.0.1') {
          return stringAsSource(fhirModelInfo);
        }
        return null;
      }),
      true
    );

    const ucumUtils = ucum.UcumLhcUtils.getInstance();
    const libraryManager = new LibraryManager(
      modelManager,
      undefined,
      undefined,
      createUcumService(
        () => {
          throw new Error('Unsupported operation');
        },
        unit => (ucumUtils.validateUnitString(unit).status === 'valid' ? null : unit)
      )
    );
    libraryManager.librarySourceLoader.registerProvider(
      createLibrarySourceProvider((id, system, version) => {
        if (id === 'FHIRHelpers' && !system && version === '4.0.1') {
          return stringAsSource(fhirHelpers);
        }
        const cached = cqlCache.get(cacheKey(id, version ?? ''));
        return cached ? stringAsSource(cached) : null;
      })
    );

    const translator = CqlTranslator.fromText(helloWorld, libraryManager);
    const index = service.buildIndex(translator.toXml())!;
    const match = findReferenceAt(index, 5, 10);
    expect(match?.reference.kind).toBe('functionRef');
    expect(match?.reference.libraryName).toBe('Common');

    const target = await service.resolveDefinitionTargetAsync(match!, index);
    expect(target?.span).toEqual(parseLocator('5:1-6:3'));
  });
});
