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
import type { ElmLibraryWrapper } from '../src/types/elm.js';

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
