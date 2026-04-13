/**
 * Tests for ElmToSqlTranspiler and MeasureReport generator.
 *
 * These test against ELM JSON that mirrors the shape produced by @cqframework/cql.
 * The CMS125 fixture covers the most common eCQM patterns:
 *   Retrieve, Query, ExpressionRef, FunctionRef (AgeInYearsAt),
 *   ParameterRef (Measurement Period), ValueSetRef, And/Or, During, Equal
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ElmToSqlTranspiler } from '../src/transpiler/elm-to-sql.js';
import { generateMeasureReport, sqlRowToPopulationCounts } from '../src/measure/measure-report.js';
import { STANDARD_VIEW_DEFINITIONS, viewDefinitionToSql, generateAllViewsSql } from '../src/views/view-definitions.js';
import { extractValueSets, extractUsedValueSets } from '../src/valueset/value-set-extractor.js';
import { loadValueSetExpansions } from '../src/valueset/value-set-loader.js';
import { generateValueSetTableDdl, generateValueSetInsertSql, generateValueSetUpsertSql, generateValueSetSeedScript } from '../src/valueset/value-set-sql.js';
import type { ElmLibraryWrapper } from '../src/types/elm.js';
import type { ValueSetExpansionRow } from '../src/valueset/value-set-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): ElmLibraryWrapper {
  const path = join(__dirname, 'fixtures', name);
  return JSON.parse(readFileSync(path, 'utf8')) as ElmLibraryWrapper;
}

// ─── ElmToSqlTranspiler ───────────────────────────────────────────────────────

describe('ElmToSqlTranspiler', () => {
  const fixture = loadFixture('cms125-breast-cancer-screening.elm.json');

  test('transpiles CMS125 without throwing', () => {
    const t = new ElmToSqlTranspiler();
    expect(() => t.transpile(fixture)).not.toThrow();
  });

  test('produces a SQL string', () => {
    const t = new ElmToSqlTranspiler();
    const { sql } = t.transpile(fixture);
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(100);
  });

  test('SQL contains WITH clause', () => {
    const t = new ElmToSqlTranspiler();
    const { sql } = t.transpile(fixture);
    expect(sql.toUpperCase()).toContain('WITH');
  });

  test('SQL contains expected population CTEs', () => {
    const t = new ElmToSqlTranspiler();
    const { sql, populations } = t.transpile(fixture);
    expect(populations).toContain('Initial Population');
    expect(populations).toContain('Denominator');
    expect(populations).toContain('Numerator');
    expect(sql).toContain('Initial_Population');
    expect(sql).toContain('Denominator');
    expect(sql).toContain('Numerator');
  });

  test('SQL contains final SELECT with _count columns', () => {
    const t = new ElmToSqlTranspiler();
    const { sql } = t.transpile(fixture);
    expect(sql).toContain('_count');
  });

  test('respects measurementPeriodStart/End options', () => {
    const t = new ElmToSqlTranspiler({
      measurementPeriodStart: '2023-01-01T00:00:00Z',
      measurementPeriodEnd: '2023-12-31T23:59:59Z',
    });
    const { sql } = t.transpile(fixture);
    expect(sql).toContain('2023-01-01');
    expect(sql).toContain('2023-12-31');
  });

  test('can disable comments', () => {
    const t = new ElmToSqlTranspiler({ includeComments: false });
    const { sql } = t.transpile(fixture);
    expect(sql).not.toContain('--');
  });

  test('returns warnings array (may be empty)', () => {
    const t = new ElmToSqlTranspiler();
    const { warnings } = t.transpile(fixture);
    expect(Array.isArray(warnings)).toBe(true);
  });

  test('accepts ElmLibrary directly (without wrapper)', () => {
    const t = new ElmToSqlTranspiler();
    expect(() => t.transpile(fixture.library)).not.toThrow();
  });

  test('handles ExpressionRef (Denominator = Initial Population)', () => {
    const t = new ElmToSqlTranspiler();
    const { sql } = t.transpile(fixture);
    // Denominator should SELECT from Initial_Population CTE
    expect(sql).toContain('Initial_Population');
  });

  test('generates ValueSetRef as value_set_expansion lookup', () => {
    const t = new ElmToSqlTranspiler();
    const { sql } = t.transpile(fixture);
    expect(sql).toContain('value_set_expansion');
  });

  test('generates AgeInYearsAt as DATE_PART', () => {
    const t = new ElmToSqlTranspiler();
    const { sql } = t.transpile(fixture);
    expect(sql).toContain("DATE_PART");
  });
});

// ─── MeasureReport generator ──────────────────────────────────────────────────

describe('generateMeasureReport', () => {
  const counts = {
    'Initial Population': 150,
    'Denominator': 120,
    'Denominator Exclusion': 5,
    'Numerator': 80,
  };

  const opts = {
    measureUrl: 'http://ecqi.healthit.gov/ecqms/Measure/BreastCancerScreening',
    periodStart: '2024-01-01',
    periodEnd: '2024-12-31',
  };

  test('returns a valid MeasureReport resource', () => {
    const report = generateMeasureReport(counts, opts);
    expect(report.resourceType).toBe('MeasureReport');
    expect(report.status).toBe('complete');
  });

  test('includes measure URL', () => {
    const report = generateMeasureReport(counts, opts);
    expect(report.measure).toBe(opts.measureUrl);
  });

  test('includes period', () => {
    const report = generateMeasureReport(counts, opts);
    expect(report.period.start).toBe(opts.periodStart);
    expect(report.period.end).toBe(opts.periodEnd);
  });

  test('includes all population groups', () => {
    const report = generateMeasureReport(counts, opts);
    const group = report.group?.[0];
    expect(group).toBeDefined();
    const pops = group?.population?.map(p => p.code.text) ?? [];
    expect(pops).toContain('Initial Population');
    expect(pops).toContain('Denominator');
    expect(pops).toContain('Numerator');
  });

  test('calculates measure score', () => {
    const report = generateMeasureReport(counts, opts);
    const score = report.group?.[0]?.measureScore?.value;
    // 80 / (120 - 5) = 0.6957...
    expect(score).toBeCloseTo(0.6957, 2);
  });

  test('measure score is null when denominator is 0', () => {
    const report = generateMeasureReport({ 'Numerator': 5, 'Denominator': 0 }, opts);
    expect(report.group?.[0]?.measureScore).toBeUndefined();
  });
});

// ─── sqlRowToPopulationCounts ─────────────────────────────────────────────────

describe('sqlRowToPopulationCounts', () => {
  test('converts SQL result row to PopulationCounts', () => {
    const row = {
      Initial_Population_count: 150,
      Denominator_count: 120,
      Numerator_count: 80,
    };
    const counts = sqlRowToPopulationCounts(row);
    expect(counts['Initial Population']).toBe(150);
    expect(counts['Denominator']).toBe(120);
    expect(counts['Numerator']).toBe(80);
  });

  test('ignores non-count columns', () => {
    const row = { Initial_Population_count: 10, some_other_col: 'foo' };
    const counts = sqlRowToPopulationCounts(row);
    expect(Object.keys(counts)).toHaveLength(1);
  });
});

// ─── CMS130 ColorectalCancerScreening ────────────────────────────────────────

describe('CMS130 ColorectalCancerScreening', () => {
  const fixture = loadFixture('cms130-colorectal-cancer-screening.elm.json');
  let sql: string;
  let populations: string[];
  let warnings: string[];

  beforeAll(() => {
    const t = new ElmToSqlTranspiler({
      measurementPeriodStart: '2024-01-01T00:00:00Z',
      measurementPeriodEnd: '2024-12-31T23:59:59Z',
    });
    ({ sql, populations, warnings } = t.transpile(fixture));
  });

  test('transpiles CMS130 without throwing', () => {
    const t = new ElmToSqlTranspiler();
    expect(() => t.transpile(fixture)).not.toThrow();
  });

  test('produces a non-empty SQL string', () => {
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(200);
  });

  test('SQL contains WITH clause', () => {
    expect(sql.toUpperCase()).toContain('WITH');
  });

  test('identifies all CMS130 populations', () => {
    expect(populations).toContain('Initial Population');
    expect(populations).toContain('Denominator');
    expect(populations).toContain('Denominator Exclusion');
    expect(populations).toContain('Numerator');
  });

  test('SQL contains all population CTE identifiers', () => {
    expect(sql).toContain('Initial_Population');
    expect(sql).toContain('Denominator_Exclusion');
    expect(sql).toContain('Numerator');
  });

  test('SQL contains final SELECT with _count columns', () => {
    expect(sql).toContain('_count');
  });

  test('Union of Denominator Exclusion produces UNION in SQL', () => {
    // Denominator Exclusion is a Union of Condition (colon cancer) + Procedure (total colectomy)
    expect(sql.toUpperCase()).toContain('UNION');
  });

  test('Numerator union references all three screening CTEs', () => {
    // Numerator = Colonoscopy Within 10 Years UNION FOBT Within 1 Year UNION Flexible Sigmoidoscopy Within 5 Years
    expect(sql).toContain('Colonoscopy_Within_10_Years');
    expect(sql).toContain('FOBT_Within_1_Year');
    expect(sql).toContain('Flexible_Sigmoidoscopy_Within_5_Years');
  });

  test('SQL references condition_view for colon cancer exclusion', () => {
    expect(sql).toContain('condition_view');
  });

  test('SQL references procedure_view for colonoscopy and colectomy', () => {
    expect(sql).toContain('procedure_view');
  });

  test('SQL references observation_view for FOBT', () => {
    expect(sql).toContain('observation_view');
  });

  test('SQL references value_set_expansion for all value sets', () => {
    expect(sql).toContain('value_set_expansion');
  });

  test('SQL contains AgeInYearsAt expression for ages 45-75', () => {
    expect(sql).toContain('DATE_PART');
  });

  test('returns warnings array', () => {
    expect(Array.isArray(warnings)).toBe(true);
  });

  test('accepts ElmLibrary directly (without wrapper)', () => {
    const t = new ElmToSqlTranspiler();
    expect(() => t.transpile(fixture.library)).not.toThrow();
  });
});

// ─── Value Set Extractor ──────────────────────────────────────────────────────

describe('extractValueSets', () => {
  const cms125 = loadFixture('cms125-breast-cancer-screening.elm.json');
  const cms130 = loadFixture('cms130-colorectal-cancer-screening.elm.json');

  test('extracts all declared value sets from CMS125', () => {
    const refs = extractValueSets(cms125);
    expect(refs.length).toBe(3);
    const names = refs.map(r => r.name);
    expect(names).toContain('Mammography');
    expect(names).toContain('Bilateral Mastectomy');
    expect(names).toContain('Office Visit');
  });

  test('each CMS125 ref has a non-empty url', () => {
    const refs = extractValueSets(cms125);
    for (const ref of refs) {
      expect(ref.url).toBeTruthy();
      expect(ref.url).toMatch(/^http/);
    }
  });

  test('extracts all declared value sets from CMS130', () => {
    const refs = extractValueSets(cms130);
    expect(refs.length).toBe(7);
    const names = refs.map(r => r.name);
    expect(names).toContain('Colonoscopy');
    expect(names).toContain('Fecal Occult Blood Test (FOBT)');
    expect(names).toContain('Flexible Sigmoidoscopy');
    expect(names).toContain('Malignant Neoplasm of Colon');
    expect(names).toContain('Total Colectomy');
  });

  test('accepts ElmLibrary directly (without wrapper)', () => {
    const refs = extractValueSets(cms125.library);
    expect(refs.length).toBe(3);
  });

  test('returns empty array when library has no value sets', () => {
    const refs = extractValueSets({ library: { identifier: { id: 'Empty' }, schemaIdentifier: { id: 'x', version: 'r1' } } });
    expect(refs).toEqual([]);
  });
});

describe('extractUsedValueSets', () => {
  const cms130 = loadFixture('cms130-colorectal-cancer-screening.elm.json');

  test('returns only value sets referenced in statements', () => {
    const used = extractUsedValueSets(cms130);
    // All 7 CMS130 value sets are referenced in its statements
    expect(used.length).toBeGreaterThanOrEqual(1);
  });

  test('used subset is not larger than full set', () => {
    const all = extractValueSets(cms130);
    const used = extractUsedValueSets(cms130);
    expect(used.length).toBeLessThanOrEqual(all.length);
  });

  test('each used ref exists in the full declared set', () => {
    const all = extractValueSets(cms130);
    const used = extractUsedValueSets(cms130);
    const allUrls = new Set(all.map(r => r.url));
    for (const ref of used) {
      expect(allUrls.has(ref.url)).toBe(true);
    }
  });
});

// ─── Value Set Loader (with mock fetch) ──────────────────────────────────────

describe('loadValueSetExpansions', () => {
  const sampleExpansion = {
    resourceType: 'ValueSet',
    url: 'http://cts.nlm.nih.gov/fhir/ValueSet/test-vs',
    expansion: {
      contains: [
        { system: 'http://snomed.info/sct', code: '12345678', display: 'Test procedure' },
        { system: 'http://snomed.info/sct', code: '87654321', display: 'Another procedure' },
      ],
    },
  };

  function makeFetch(responses: Record<string, unknown>): typeof fetch {
    return async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input.toString();
      for (const [pattern, body] of Object.entries(responses)) {
        if (url.includes(pattern)) {
          return { ok: true, json: async () => body } as Response;
        }
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    };
  }

  test('flattens expansion.contains into rows', async () => {
    const mockFetch = makeFetch({ '$expand': sampleExpansion });
    const refs = [{ name: 'Test VS', url: 'http://cts.nlm.nih.gov/fhir/ValueSet/test-vs' }];
    const results = await loadValueSetExpansions('http://fhir.example.com', refs, mockFetch);
    expect(results).toHaveLength(1);
    expect(results[0].rows).toHaveLength(2);
    expect(results[0].error).toBeUndefined();
  });

  test('row has correct value_set_id, code, and system', async () => {
    const mockFetch = makeFetch({ '$expand': sampleExpansion });
    const refs = [{ name: 'Test VS', url: 'http://cts.nlm.nih.gov/fhir/ValueSet/test-vs' }];
    const [result] = await loadValueSetExpansions('http://fhir.example.com', refs, mockFetch);
    const row = result.rows[0];
    expect(row.value_set_id).toBe('http://cts.nlm.nih.gov/fhir/ValueSet/test-vs');
    expect(row.code).toBe('12345678');
    expect(row.system).toBe('http://snomed.info/sct');
    expect(row.display).toBe('Test procedure');
  });

  test('falls back to Bundle search when $expand returns 404', async () => {
    const bundleResponse = {
      resourceType: 'Bundle',
      entry: [{ resource: sampleExpansion }],
    };
    const mockFetch = makeFetch({ 'ValueSet?url': bundleResponse });
    const refs = [{ name: 'Test VS', url: 'http://cts.nlm.nih.gov/fhir/ValueSet/test-vs' }];
    const [result] = await loadValueSetExpansions('http://fhir.example.com', refs, mockFetch);
    expect(result.rows).toHaveLength(2);
  });

  test('returns error (not throw) for not-found value sets', async () => {
    const mockFetch = makeFetch({});  // always 404
    const refs = [{ name: 'Missing VS', url: 'http://example.com/missing' }];
    const [result] = await loadValueSetExpansions('http://fhir.example.com', refs, mockFetch);
    expect(result.rows).toHaveLength(0);
    expect(result.error).toBeTruthy();
  });

  test('returns error when ValueSet has no expansion', async () => {
    const noExpansion = { resourceType: 'ValueSet', url: 'http://example.com/vs' };
    const mockFetch = makeFetch({ '$expand': noExpansion });
    const refs = [{ name: 'No Expansion', url: 'http://example.com/vs' }];
    const [result] = await loadValueSetExpansions('http://fhir.example.com', refs, mockFetch);
    expect(result.rows).toHaveLength(0);
    expect(result.error).toMatch(/pre-expanded/i);
  });

  test('loads multiple value sets in parallel', async () => {
    const vs1 = { ...sampleExpansion, url: 'http://example.com/vs1' };
    const vs2 = { ...sampleExpansion, url: 'http://example.com/vs2' };
    let callCount = 0;
    const mockFetch: typeof fetch = async (input) => {
      callCount++;
      const url = input.toString();
      const body = url.includes('vs1') ? vs1 : url.includes('vs2') ? vs2 : null;
      if (!body) return { ok: false, status: 404, json: async () => ({}) } as Response;
      return { ok: true, json: async () => body } as Response;
    };
    const refs = [
      { name: 'VS1', url: 'http://example.com/vs1' },
      { name: 'VS2', url: 'http://example.com/vs2' },
    ];
    const results = await loadValueSetExpansions('http://fhir.example.com', refs, mockFetch);
    expect(results).toHaveLength(2);
    expect(results[0].rows).toHaveLength(2);
    expect(results[1].rows).toHaveLength(2);
  });

  test('flattens nested expansion hierarchy', async () => {
    const nestedExpansion = {
      resourceType: 'ValueSet',
      url: 'http://example.com/nested',
      expansion: {
        contains: [
          {
            system: 'http://snomed.info/sct',
            code: 'parent',
            display: 'Parent',
            contains: [
              { system: 'http://snomed.info/sct', code: 'child1', display: 'Child 1' },
              { system: 'http://snomed.info/sct', code: 'child2', display: 'Child 2' },
            ],
          },
        ],
      },
    };
    const mockFetch = makeFetch({ '$expand': nestedExpansion });
    const refs = [{ name: 'Nested', url: 'http://example.com/nested' }];
    const [result] = await loadValueSetExpansions('http://fhir.example.com', refs, mockFetch);
    expect(result.rows).toHaveLength(3);  // parent + 2 children
    const codes = result.rows.map(r => r.code);
    expect(codes).toContain('parent');
    expect(codes).toContain('child1');
    expect(codes).toContain('child2');
  });
});

// ─── Value Set SQL generators ─────────────────────────────────────────────────

describe('generateValueSetTableDdl', () => {
  test('generates CREATE TABLE IF NOT EXISTS', () => {
    const ddl = generateValueSetTableDdl();
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS value_set_expansion');
  });

  test('includes all required columns', () => {
    const ddl = generateValueSetTableDdl();
    expect(ddl).toContain('value_set_id');
    expect(ddl).toContain('code');
    expect(ddl).toContain('system');
    expect(ddl).toContain('display');
    expect(ddl).toContain('version');
  });

  test('includes PRIMARY KEY on (value_set_id, system, code)', () => {
    const ddl = generateValueSetTableDdl();
    expect(ddl).toContain('PRIMARY KEY');
  });

  test('accepts custom table name', () => {
    const ddl = generateValueSetTableDdl('my_vs_table');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS my_vs_table');
    expect(ddl).toContain('idx_my_vs_table_vs_id');
  });
});

describe('generateValueSetInsertSql / generateValueSetUpsertSql', () => {
  const rows: ValueSetExpansionRow[] = [
    { value_set_id: 'http://example.com/vs', code: 'A001', system: 'http://snomed.info/sct', display: 'Code A' },
    { value_set_id: 'http://example.com/vs', code: 'B002', system: 'http://snomed.info/sct' },
  ];

  test('INSERT includes all column names', () => {
    const sql = generateValueSetInsertSql(rows);
    expect(sql).toContain('INSERT INTO value_set_expansion');
    expect(sql).toContain('value_set_id, code, system, display, version');
  });

  test('INSERT contains the row values', () => {
    const sql = generateValueSetInsertSql(rows);
    expect(sql).toContain('A001');
    expect(sql).toContain('B002');
    expect(sql).toContain('Code A');
  });

  test('NULL is emitted for undefined optional fields', () => {
    const sql = generateValueSetInsertSql(rows);
    expect(sql).toContain('NULL');
  });

  test('UPSERT appends ON CONFLICT DO NOTHING', () => {
    const sql = generateValueSetUpsertSql(rows);
    expect(sql).toContain('ON CONFLICT DO NOTHING');
  });

  test('returns placeholder comment for empty rows', () => {
    const sql = generateValueSetInsertSql([]);
    expect(sql).toContain('No rows');
  });

  test('single quotes in values are escaped', () => {
    const tricky: ValueSetExpansionRow[] = [
      { value_set_id: "it's/vs", code: 'X', system: 'http://sys', display: "Colon's" },
    ];
    const sql = generateValueSetInsertSql(tricky);
    expect(sql).toContain("it''s/vs");
    expect(sql).toContain("Colon''s");
  });
});

describe('generateValueSetSeedScript', () => {
  const rows: ValueSetExpansionRow[] = [
    { value_set_id: 'http://example.com/vs', code: 'A001', system: 'http://snomed.info/sct' },
  ];

  test('seed script includes DDL + DML wrapped in transaction', () => {
    const script = generateValueSetSeedScript(rows);
    expect(script).toContain('CREATE TABLE IF NOT EXISTS');
    expect(script).toContain('INSERT INTO');
    expect(script).toContain('BEGIN;');
    expect(script).toContain('COMMIT;');
  });

  test('seed script reports value set and code counts', () => {
    const script = generateValueSetSeedScript(rows);
    expect(script).toContain('Total codes: 1');
    expect(script).toContain('Value sets: 1');
  });
});

// ─── ViewDefinitions ─────────────────────────────────────────────────────────

describe('STANDARD_VIEW_DEFINITIONS', () => {
  test('contains at least 5 resource views', () => {
    expect(STANDARD_VIEW_DEFINITIONS.length).toBeGreaterThanOrEqual(5);
  });

  test('every definition has a name and resource', () => {
    for (const vd of STANDARD_VIEW_DEFINITIONS) {
      expect(vd.name).toBeTruthy();
      expect(vd.resource).toBeTruthy();
      expect(vd.resourceType).toBe('ViewDefinition');
    }
  });

  test('viewDefinitionToSql produces CREATE OR REPLACE VIEW', () => {
    const vd = STANDARD_VIEW_DEFINITIONS[0];
    const { sql } = viewDefinitionToSql(vd);
    expect(sql).toContain('CREATE OR REPLACE VIEW');
    expect(sql).toContain(vd.name);
  });

  test('generateAllViewsSql is a non-empty string', () => {
    const sql = generateAllViewsSql();
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(500);
  });
});
