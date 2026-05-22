/**
 * FHIR MeasureReport generator.
 *
 * Converts SQL population count results into a valid FHIR R4 MeasureReport resource.
 * The caller is responsible for saving the report to the FHIR server via the API.
 *
 * Spec: https://www.hl7.org/fhir/measurereport.html
 */

// ─── Input types ─────────────────────────────────────────────────────────────

export interface PopulationCounts {
  /** key: define name (e.g. "Initial Population"), value: patient count */
  [defineName: string]: number;
}

export interface MeasureReportOptions {
  /** FHIR canonical URL of the Measure resource. Required. */
  measureUrl: string;
  /** Measurement period start (ISO 8601 date or dateTime). */
  periodStart: string;
  /** Measurement period end (ISO 8601 date or dateTime). */
  periodEnd: string;
  /** MeasureReport.type. Default: 'summary'. */
  type?: 'individual' | 'subject-list' | 'summary' | 'data-collection';
  /** MeasureReport.subject — reference to a Group or Patient. */
  subject?: { reference: string };
  /** Optional ID to assign. If omitted a UUID-like value is generated. */
  id?: string;
  /** Optional reporter reference (Organization etc.). */
  reporter?: { reference: string };
  /** Optional: ISO date when the report was generated. Default: now. */
  date?: string;
  /** Optional: group identifier for the main population group. */
  groupId?: string;
}

// ─── Minimal FHIR R4 MeasureReport shape ─────────────────────────────────────

export interface FhirMeasureReport {
  resourceType: 'MeasureReport';
  id?: string;
  meta?: { profile?: string[] };
  status: 'complete' | 'pending' | 'error';
  type: string;
  measure: string;
  subject?: { reference: string };
  date?: string;
  reporter?: { reference: string };
  period: { start: string; end: string };
  group?: FhirMeasureReportGroup[];
}

export interface FhirMeasureReportGroup {
  id?: string;
  code?: FhirCodeableConcept;
  population?: FhirMeasureReportPopulation[];
  measureScore?: FhirQuantity;
  stratifier?: FhirMeasureReportStratifier[];
}

export interface FhirMeasureReportPopulation {
  id?: string;
  code: FhirCodeableConcept;
  count: number;
  subjectResults?: { reference: string };
}

export interface FhirMeasureReportStratifier {
  id?: string;
  code?: FhirCodeableConcept[];
  stratum?: FhirMeasureReportStratum[];
}

export interface FhirMeasureReportStratum {
  value?: FhirCodeableConcept;
  population?: FhirMeasureReportPopulation[];
  measureScore?: FhirQuantity;
}

export interface FhirCodeableConcept {
  coding?: Array<{ system?: string; code?: string; display?: string }>;
  text?: string;
}

export interface FhirQuantity {
  value: number;
  unit?: string;
  system?: string;
  code?: string;
}

// ─── Population code map (eCQM standard) ─────────────────────────────────────

const POPULATION_CODES: Record<string, { code: string; display: string }> = {
  'Initial Population':            { code: 'initial-population',        display: 'Initial Population' },
  'Denominator':                   { code: 'denominator',               display: 'Denominator' },
  'Denominator Exclusion':         { code: 'denominator-exclusion',     display: 'Denominator Exclusion' },
  'Denominator Exception':         { code: 'denominator-exception',     display: 'Denominator Exception' },
  'Numerator':                     { code: 'numerator',                 display: 'Numerator' },
  'Numerator Exclusion':           { code: 'numerator-exclusion',       display: 'Numerator Exclusion' },
  'Measure Population':            { code: 'measure-population',        display: 'Measure Population' },
  'Measure Population Exclusion':  { code: 'measure-population-exclusion', display: 'Measure Population Exclusion' },
};

const MEASURE_POPULATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/measure-population';

// ─── MeasureReport generator ─────────────────────────────────────────────────

/**
 * Generate a FHIR MeasureReport from SQL population counts.
 *
 * @param counts  Record mapping define names to row counts from SQL
 * @param options Measure metadata (URL, period, type, etc.)
 */
export function generateMeasureReport(
  counts: PopulationCounts,
  options: MeasureReportOptions,
): FhirMeasureReport {
  const id = options.id ?? generateId();
  const date = options.date ?? new Date().toISOString();
  const type = options.type ?? 'summary';

  // Build population entries for known eCQM populations
  const populations: FhirMeasureReportPopulation[] = [];
  for (const [name, count] of Object.entries(counts)) {
    const code = POPULATION_CODES[name];
    if (!code) continue; // Skip non-standard population names

    populations.push({
      code: {
        coding: [{ system: MEASURE_POPULATION_SYSTEM, code: code.code, display: code.display }],
        text: name,
      },
      count,
    });
  }

  // Calculate measure score (numerator / (denominator - exclusions))
  const measureScore = calculateMeasureScore(counts);

  const group: FhirMeasureReportGroup = {
    ...(options.groupId ? { id: options.groupId } : {}),
    population: populations.length > 0 ? populations : undefined,
    ...(measureScore !== null ? { measureScore: { value: measureScore } } : {}),
  };

  const report: FhirMeasureReport = {
    resourceType: 'MeasureReport',
    id,
    meta: {
      profile: ['http://hl7.org/fhir/us/cqfmeasures/StructureDefinition/summary-measure-report-cqfm'],
    },
    status: 'complete',
    type,
    measure: options.measureUrl,
    date,
    period: {
      start: options.periodStart,
      end: options.periodEnd,
    },
    group: [group],
  };

  if (options.subject) report.subject = options.subject;
  if (options.reporter) report.reporter = options.reporter;

  return report;
}

// ─── Score calculation ────────────────────────────────────────────────────────

function calculateMeasureScore(counts: PopulationCounts): number | null {
  const numerator = counts['Numerator'] ?? 0;
  const denominator = counts['Denominator'] ?? 0;
  const denomExclusion = counts['Denominator Exclusion'] ?? 0;
  const denomException = counts['Denominator Exception'] ?? 0;

  const adjustedDenominator = denominator - denomExclusion - denomException;
  if (adjustedDenominator <= 0) return null;

  return Math.round((numerator / adjustedDenominator) * 10000) / 10000; // 4 decimal places
}

// ─── ID generation (no Node crypto needed) ───────────────────────────────────

function generateId(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `mr-${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

// ─── Convenience: extract counts from SQL result rows ─────────────────────────

/**
 * Convert a flat SQL result row (from the final SELECT of a transpiled query)
 * into a PopulationCounts map.
 *
 * Expected column naming convention: `{cte_name}_count`, e.g.:
 *   Initial_Population_count, Numerator_count, Denominator_count
 */
export function sqlRowToPopulationCounts(row: Record<string, unknown>): PopulationCounts {
  const counts: PopulationCounts = {};
  for (const [col, val] of Object.entries(row)) {
    if (!col.endsWith('_count')) continue;
    const defineName = col
      .replace(/_count$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    counts[defineName] = typeof val === 'number' ? val : Number(val ?? 0);
  }
  return counts;
}
