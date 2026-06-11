/**
 * ElmToSqlTranspiler
 *
 * Converts an HL7 ELM JSON Library (as produced by @cqframework/cql) to a
 * SQL-on-FHIR query using Common Table Expressions (CTEs).
 *
 * Pipeline: CQL → ELM (via @cqframework/cql) → SQL (this library)
 *
 * Each CQL `define` statement becomes a CTE. The final SELECT returns
 * population counts suitable for building a FHIR MeasureReport.
 */

import type {
  ElmLibrary,
  ElmLibraryWrapper,
  ElmExpression,
  ElmExpressionDef,
  ElmBinaryOp,
  ElmUnaryOp,
  ElmFunctionRef,
  ElmExpressionRef,
  ElmLiteral,
  ElmProperty,
  ElmRetrieve,
  ElmQuery,
  ElmRelationshipClause,
  ElmInterval,
  ElmParameterRef,
  ElmValueSetRef,
  ElmIf,
  ElmCase,
  ElmAggregate,
  ElmStart,
  ElmEnd,
  ElmDurationBetween,
  ElmIs,
  ElmAs,
  ElmTypeSpecifier,
} from '../types/elm';
import { stripFhirNamespace, toSqlIdentifier } from '../types/elm';
import { MEASURE_POPULATION_NAMES } from '../../measure-population.lib';
import {
  measurementPeriodFromValues,
  parameterValueToSqlLiteral,
  type LibraryParameterValues,
} from '../../library-parameters.lib';

// ─── Public types ────────────────────────────────────────────────────────────

export interface TranspilerOptions {
  /** Measurement period start (ISO 8601). Default: current year Jan 1. */
  measurementPeriodStart?: string;
  /** Measurement period end (ISO 8601). Default: current year Dec 31. */
  measurementPeriodEnd?: string;
  /** Emit SQL comments explaining each CTE. Default: true. */
  includeComments?: boolean;
  /**
   * Names of define statements to include in the final output SELECT.
   * If omitted, the transpiler auto-detects common measure population names.
   */
  populationDefines?: string[];
  /** User-supplied measure parameter values keyed by CQL parameter name. */
  parameterValues?: LibraryParameterValues;
}

export interface TranspileResult {
  /** The generated SQL string. */
  sql: string;
  /** Names of the population CTEs found (Initial Population, Numerator, etc.). */
  populations: string[];
  /** Warnings generated during transpilation. */
  warnings: string[];
}

// Re-export for consumers
export { MEASURE_POPULATION_NAMES } from '../../measure-population.lib';

// ─── FHIR resource → SQL view name map ───────────────────────────────────────

/**
 * Column inside each `_view` table that holds the FHIR code used for value-set
 * filtering. Most resources expose this as `code`; Encounter uses `type_code`
 * (per STANDARD_VIEW_DEFINITIONS in views/view-definitions.ts).
 */
const RESOURCE_CODE_COLUMN: Record<string, string> = {
  Patient: 'gender',
  Encounter: 'type_code',
  AllergyIntolerance: 'code',
  Immunization: 'vaccine_code',
  ServiceRequest: 'code',
};

function codeColumnFor(resource: string): string {
  return RESOURCE_CODE_COLUMN[resource] ?? 'code';
}

/**
 * Convert an expression that may be an interval (`tstzrange(...)`) into a single
 * point-in-time suitable for `AGE()`, `DATE_PART()`, etc. CQL's `AgeInYearsAt(MP)`
 * means "age at the start of MP" — extracting `lower()` of the interval matches.
 * Other expressions pass through untouched.
 */
/**
 * Returns the leaf type-name from an ELM type reference, e.g.
 * `{urn:hl7-org:elm-types:r1}DateTime` → `DateTime`, or `Period` from a
 * NamedTypeSpecifier wrapper.
 */
function isTypeLeaf(t: string | ElmTypeSpecifier | undefined): string {
  if (!t) return '';
  if (typeof t === 'string') return t.replace(/.*}/, '');
  if (typeof t === 'object' && 'name' in t && typeof t.name === 'string') {
    return t.name.replace(/.*}/, '');
  }
  return '';
}

/**
 * Maps a period-bearing FHIR property name (or its already-normalized variant)
 * to the column-name prefix used by STANDARD_VIEW_DEFINITIONS. `effective` →
 * `effective` (so the caller gets `effective_start` / `effective_end`); already-
 * suffixed names like `period_start` map to `period`, etc.
 */
function stripDateSuffix(path: string): string {
  const known = ['period', 'effective', 'onset', 'performed', 'abatement'];
  const lower = path.toLowerCase();
  for (const k of known) {
    if (lower === k) return k;
    if (lower === `${k}_start` || lower === `${k}_end` || lower === `${k}_datetime`) return k;
  }
  return path.replace(/_(start|end|datetime)$/, '');
}

function asPointInTime(sql: string): string {
  const s = sql.trim();
  if (/^ts(tz)?range\b/i.test(s)) {
    return `lower(${s})`;
  }
  return s;
}

/**
 * Render a CQL `start of <interval>` / `end of <interval>` expression in SQL.
 * If the inner is a `tstzrange(...)` (or `tsrange(...)`) call we use PostgreSQL's
 * `lower()` / `upper()`; otherwise we fall back to the schema's `<col>_start` /
 * `<col>_end` naming convention for already-flattened period columns.
 */
function startEndToSql(sql: string, which: 'start' | 'end'): string {
  const s = sql.trim();
  if (/^ts(tz)?range\b/i.test(s)) {
    return `${which === 'start' ? 'lower' : 'upper'}(${s})`;
  }
  if (new RegExp(`_${which}\\b`).test(s)) return s;
  return `${s}_${which}`;
}

/**
 * Detects whether a transpiled expression is already a complete SQL statement
 * (SELECT / VALUES / WITH / TABLE). Leading whitespace and parentheses are
 * stripped — `(SELECT ...)` counts, but `(boolean_expr)` does not.
 */
function startsWithSqlStatement(sql: string): boolean {
  let s = sql.trim();
  // Strip a leading parenthesis only if it's followed by a SQL statement keyword.
  // This avoids treating `(boolean_expr)` as a statement.
  while (s.startsWith('(')) {
    const inner = s.slice(1).trimStart();
    if (/^(SELECT|VALUES|WITH|TABLE)\b/i.test(inner)) return true;
    return false;
  }
  return /^(SELECT|VALUES|WITH|TABLE)\b/i.test(s);
}

const RESOURCE_VIEW_MAP: Record<string, string> = {
  Patient: 'patient_view',
  Observation: 'observation_view',
  Condition: 'condition_view',
  Procedure: 'procedure_view',
  MedicationRequest: 'medication_request_view',
  Encounter: 'encounter_view',
  DiagnosticReport: 'diagnostic_report_view',
  Coverage: 'coverage_view',
  AllergyIntolerance: 'allergy_intolerance_view',
  Immunization: 'immunization_view',
  DeviceRequest: 'device_request_view',
  CommunicationRequest: 'communication_request_view',
  ServiceRequest: 'service_request_view',
  Claim: 'claim_view',
};

// ─── Transpiler ──────────────────────────────────────────────────────────────

export class ElmToSqlTranspiler {
  private opts: Required<Omit<TranspilerOptions, 'parameterValues'>> & {
    parameterValues: LibraryParameterValues;
  };
  private warnings: string[] = [];
  private defines = new Map<string, ElmExpressionDef>();
  private valueSets = new Map<string, string>(); // name → OID/URL
  private codeSystems = new Map<string, string>(); // name → URI
  /** Patient alias in the innermost active CQL query (e.g. `p` in `from p` Patient). */
  private patientAlias: string | null = null;

  constructor(options: TranspilerOptions = {}) {
    const now = new Date();
    const year = now.getFullYear();
    const parameterValues = options.parameterValues ?? {};
    const period = measurementPeriodFromValues(parameterValues);
    this.opts = {
      measurementPeriodStart: options.measurementPeriodStart ?? period.start ?? `${year}-01-01T00:00:00Z`,
      measurementPeriodEnd: options.measurementPeriodEnd ?? period.end ?? `${year}-12-31T23:59:59Z`,
      includeComments: options.includeComments ?? true,
      populationDefines: options.populationDefines ?? [],
      parameterValues,
    };
  }

  // ─── Public entry point ────────────────────────────────────────────────────

  transpile(input: ElmLibraryWrapper | ElmLibrary): TranspileResult {
    this.warnings = [];
    this.defines.clear();
    this.valueSets.clear();
    this.codeSystems.clear();
    this.patientAlias = null;

    const lib: ElmLibrary = 'library' in input ? input.library : input;

    // Index value sets and code systems for IN-clause generation
    for (const vs of lib.valueSets?.def ?? []) {
      this.valueSets.set(vs.name, vs.id);
    }
    for (const cs of lib.codeSystems?.def ?? []) {
      this.codeSystems.set(cs.name, cs.id);
    }

    // Index all defines
    for (const def of lib.statements?.def ?? []) {
      this.defines.set(def.name, def);
    }

    // Topological sort so CTEs reference only already-defined CTEs
    const sorted = this.topologicalSort(lib.statements?.def ?? []);

    const ctes: string[] = [];
    const populations: string[] = [];

    for (const def of sorted) {
      if (def.accessLevel === 'Private') continue;
      const cteSql = this.generateCte(def);
      if (cteSql) ctes.push(cteSql);

      if (this.isPopulation(def.name)) {
        populations.push(def.name);
      }
    }

    // Detect populations to expose in the final SELECT
    const outputPops =
      this.opts.populationDefines.length > 0
        ? this.opts.populationDefines
        : populations.length > 0
        ? populations
        : this.inferPopulations(sorted);

    const finalSelect = this.generateFinalSelect(outputPops);

    const libId = `${lib.identifier.id}${lib.identifier.version ? ` v${lib.identifier.version}` : ''}`;
    const header = this.opts.includeComments
      ? `-- SQL-on-FHIR query generated from ELM library: ${libId}\n` +
        `-- Measurement Period: ${this.opts.measurementPeriodStart} – ${this.opts.measurementPeriodEnd}\n` +
        `-- Generated by @cqframework/elm-to-sql\n\n`
      : '';

    const sql = `${header}WITH\n${ctes.join(',\n\n')}\n\n${finalSelect}`;

    return { sql, populations: outputPops, warnings: [...this.warnings] };
  }

  // ─── CTE generation ────────────────────────────────────────────────────────

  private generateCte(def: ElmExpressionDef): string {
    const cteName = toSqlIdentifier(def.name);
    let body: string;

    try {
      if (this.isPatientResourcePopulationQuery(def)) {
        body = this.patientPopulationQueryToSql(def.expression as ElmQuery, def.context ?? 'Patient');
      } else {
        body = this.exprToSql(def.expression, def.context ?? 'Patient');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.warn(`Could not transpile define "${def.name}": ${msg}`);
      body = `SELECT NULL AS _unsupported -- ${msg}`;
    }

    // PostgreSQL CTE bodies must be complete statements (SELECT/VALUES/WITH/etc).
    // Scalar/boolean defines produce bare expressions — wrap them in a SELECT so
    // they're valid CTEs returning a single-row, single-column result. If the
    // expression references the Patient context CTE (e.g. `Patient.gender`),
    // we filter Patient rows by the boolean so per-patient defines aggregate
    // correctly via COUNT(*) in the final SELECT.
    if (!startsWithSqlStatement(body)) {
      const trimmed = body.trim();
      if (/\bPatient\./i.test(trimmed)) {
        body = `SELECT Patient.* FROM Patient WHERE (${trimmed})`;
      } else {
        body = `SELECT (${trimmed}) AS value`;
      }
    }

    // The standard ELM "Patient" context define is `SingletonFrom(Retrieve(Patient))`
    // which the SingletonFrom case emits with a LIMIT 1. For measure evaluation we
    // want all patients in scope so the per-patient CTEs (Initial Population,
    // Denominator, Numerator) iterate over the population, not just the first row.
    if (def.name === 'Patient') {
      body = body.replace(/\s+LIMIT\s+1\s*$/i, '');
    }

    const comment = this.opts.includeComments ? `  -- define "${def.name}"\n` : '';
    return `${cteName} AS (\n${comment}${this.indent(body)}\n)`;
  }

  // ─── Expression dispatch ───────────────────────────────────────────────────

  private exprToSql(expr: ElmExpression, context: string): string {
    switch (expr.type) {
      case 'Retrieve':        return this.retrieveToSql(expr as ElmRetrieve, context);
      case 'Query':           return this.queryToSql(expr as ElmQuery, context);
      case 'ExpressionRef':   return this.expressionRefToSql(expr as ElmExpressionRef);
      case 'FunctionRef':     return this.functionRefToSql(expr as ElmFunctionRef, context);
      case 'ParameterRef':    return this.parameterRefToSql(expr as ElmParameterRef);
      case 'ValueSetRef':     return this.valueSetRefToSql(expr as ElmValueSetRef);
      case 'Property':        return this.propertyToSql(expr as ElmProperty);
      case 'Literal':         return this.literalToSql(expr as ElmLiteral);
      case 'Null':            return 'NULL';
      case 'Interval':        return this.intervalToSql(expr as ElmInterval);
      case 'If':              return this.ifToSql(expr as ElmIf, context);
      case 'Case':            return this.caseToSql(expr as ElmCase, context);
      case 'Start':           return startEndToSql(this.exprToSql((expr as ElmStart).operand, context), 'start');
      case 'End':             return startEndToSql(this.exprToSql((expr as ElmEnd).operand, context), 'end');
      case 'Today':           return 'CURRENT_DATE';
      case 'Now':             return 'CURRENT_TIMESTAMP';
      case 'Exists':          return this.existsToSql((expr as ElmUnaryOp).operand, context);
      case 'Not':             return `NOT (${this.exprToSqlInline((expr as ElmUnaryOp).operand, context)})`;
      case 'IsNull':          return `(${this.exprToSqlInline((expr as ElmUnaryOp).operand, context)}) IS NULL`;
      case 'IsTrue':          return `(${this.exprToSqlInline((expr as ElmUnaryOp).operand, context)}) IS TRUE`;
      case 'IsFalse':         return `(${this.exprToSqlInline((expr as ElmUnaryOp).operand, context)}) IS FALSE`;
      case 'Is':              return this.isTypeToSql(expr as ElmIs, context);
      case 'As':              return this.asTypeToSql(expr as ElmAs, context);
      case 'Count':           return this.aggregateToSql(expr as ElmAggregate, 'COUNT', context);
      case 'Sum':             return this.aggregateToSql(expr as ElmAggregate, 'SUM', context);
      case 'Min':             return this.aggregateToSql(expr as ElmAggregate, 'MIN', context);
      case 'Max':             return this.aggregateToSql(expr as ElmAggregate, 'MAX', context);
      case 'Avg':             return this.aggregateToSql(expr as ElmAggregate, 'AVG', context);
      case 'DurationBetween': return this.durationBetweenToSql(expr as ElmDurationBetween, context);
      case 'And':
      case 'Or':
      case 'Xor':
        return this.booleanOpToSql(expr as ElmBinaryOp, context);
      case 'Equal':           return this.comparisonToSql(expr as ElmBinaryOp, '=', context);
      case 'NotEqual':        return this.comparisonToSql(expr as ElmBinaryOp, '<>', context);
      case 'Less':            return this.comparisonToSql(expr as ElmBinaryOp, '<', context);
      case 'Greater':         return this.comparisonToSql(expr as ElmBinaryOp, '>', context);
      case 'LessOrEqual':     return this.comparisonToSql(expr as ElmBinaryOp, '<=', context);
      case 'GreaterOrEqual':  return this.comparisonToSql(expr as ElmBinaryOp, '>=', context);
      case 'In':
      case 'IncludedIn':
      case 'During':          return this.inToSql(expr as ElmBinaryOp, context);
      case 'Contains':        return this.containsToSql(expr as ElmBinaryOp, context);
      case 'Add':             return this.arithmeticToSql(expr as ElmBinaryOp, '+', context);
      case 'Subtract':        return this.arithmeticToSql(expr as ElmBinaryOp, '-', context);
      case 'Multiply':        return this.arithmeticToSql(expr as ElmBinaryOp, '*', context);
      case 'Divide':          return this.arithmeticToSql(expr as ElmBinaryOp, '/', context);
      case 'Union':           return this.setOpToSql('UNION ALL', (expr as { operand: ElmExpression[] }).operand, context);
      case 'Intersect':       return this.setOpToSql('INTERSECT', (expr as { operand: ElmExpression[] }).operand, context);
      case 'Except':          return this.setOpToSql('EXCEPT', (expr as { operand: ElmExpression[] }).operand, context);
      case 'Distinct':        return `SELECT DISTINCT * FROM (${this.exprToSqlInline((expr as unknown as ElmUnaryOp).operand, context)}) _d`;
      case 'Flatten':         return this.exprToSql((expr as unknown as ElmUnaryOp).operand, context);
      case 'ToList':          return this.exprToSql((expr as ElmUnaryOp).operand, context);
      case 'SingletonFrom':   return `SELECT * FROM (${this.exprToSqlInline((expr as ElmUnaryOp).operand, context)}) _s LIMIT 1`;
      case 'First':           return `SELECT * FROM (${this.exprToSqlInline((expr as { source: ElmExpression }).source, context)}) _f LIMIT 1`;
      case 'Last':            return `SELECT * FROM (${this.exprToSqlInline((expr as { source: ElmExpression }).source, context)}) _l ORDER BY 1 DESC LIMIT 1`;
      case 'List':            return this.listToSql((expr as { element?: ElmExpression[] }).element ?? [], context);
      case 'AnyTrue':         return `(SELECT bool_or(val) FROM (${this.exprToSqlInline((expr as ElmUnaryOp).operand, context)}) _a(val))`;
      case 'AllTrue':         return `(SELECT bool_and(val) FROM (${this.exprToSqlInline((expr as ElmUnaryOp).operand, context)}) _a(val))`;
      default: {
        const typeName = (expr as { type: string }).type;
        // ELM age-calculation operators land here as top-level expressions
        // (they are siblings of the FunctionRef path). The ELM signature for
        // `CalculateAgeAt(birthDate, asOf)` is two operands; the FunctionRef
        // path's `AgeInYearsAt` is single-operand (`asOf` only — birthDate is
        // implicit from Patient context). Discard the birthDate operand when
        // delegating so we hit the shared SQL emission with the correct asOf.
        if (typeName === 'CalculateAgeAt' || typeName === 'CalculateAgeInYearsAt' || typeName === 'AgeInYearsAt') {
          const operand = (expr as { operand?: ElmExpression[] }).operand ?? [];
          const precision = (expr as { precision?: string }).precision ?? 'Year';
          const fnName = `AgeIn${precision === 'Year' ? 'Years' : precision === 'Month' ? 'Months' : 'Days'}At`;
          // CalculateAgeAt = [birthDate, asOf]; AgeInYearsAt = [asOf] only.
          const asOf = operand.length >= 2 ? [operand[1]] : operand;
          const synth: ElmFunctionRef = { type: 'FunctionRef', name: fnName, operand: asOf };
          return this.functionRefToSql(synth, context);
        }
        // Conversion operators emitted by the translator (ToDateTime, ToDate,
        // ToInterval) often appear as top-level types. Delegate to the same
        // FunctionRef handler so the cast / coercion logic is shared.
        if (typeName === 'ToDateTime' || typeName === 'ToDate' || typeName === 'ToInterval' ||
            typeName === 'ToString' || typeName === 'ToInteger' || typeName === 'ToDecimal') {
          const operand = (expr as { operand?: ElmExpression | ElmExpression[] }).operand;
          const ops = Array.isArray(operand) ? operand : operand ? [operand] : [];
          const synth: ElmFunctionRef = { type: 'FunctionRef', name: typeName, operand: ops };
          return this.functionRefToSql(synth, context);
        }
        this.warn(`Unsupported ELM expression type: ${typeName}`);
        return `NULL /* unsupported: ${typeName} */`;
      }
    }
  }

  /** Returns a SQL expression suitable for inlining (subquery or scalar). */
  private exprToSqlInline(expr: ElmExpression, context: string): string {
    const s = this.exprToSql(expr, context);
    // If it looks like a full SELECT statement, wrap as subquery
    if (/^\s*SELECT\b/i.test(s)) return `(${s})`;
    return s;
  }

  // ─── Retrieve → SELECT FROM view ──────────────────────────────────────────

  private retrieveToSql(expr: ElmRetrieve, _context: string): string {
    const resource = stripFhirNamespace(expr.dataType);
    const view = RESOURCE_VIEW_MAP[resource] ?? `${resource.toLowerCase()}_view`;

    const lines: string[] = [`SELECT * FROM ${view}`];

    if (expr.codes) {
      const codeFilter = this.codeFilterToSql(expr.codes, resource);
      if (codeFilter) lines.push(`WHERE ${codeFilter}`);
    }

    return lines.join('\n');
  }

  private codeFilterToSql(codesExpr: ElmExpression, resource: string): string {
    const codeColumn = codeColumnFor(resource);
    if (codesExpr.type === 'ValueSetRef') {
      const ref = codesExpr as ElmValueSetRef;
      const oid = this.valueSets.get(ref.name);
      return oid
        ? `${codeColumn} IN (SELECT code FROM value_set_expansion WHERE value_set_id = '${oid}')`
        : `${codeColumn} IS NOT NULL -- value set: ${ref.name}`;
    }
    if (codesExpr.type === 'List') {
      const list = codesExpr as { element?: ElmExpression[] };
      const codes = (list.element ?? [])
        .filter(e => e.type === 'Literal' || (e as unknown as { id?: string }).id !== undefined)
        .map(e => {
          if (e.type === 'Literal') return `'${(e as ElmLiteral).value}'`;
          return `'${(e as unknown as { id?: string }).id ?? ''}'`;
        });
      return codes.length > 0 ? `${codeColumn} IN (${codes.join(', ')})` : '';
    }
    return '';
  }

  // ─── Query → SELECT/WHERE/JOIN ────────────────────────────────────────────

  private queryToSql(expr: ElmQuery, context: string): string {
    if (expr.source.length === 0) return 'SELECT NULL';

    const [primarySource, ...additionalSources] = expr.source;
    const alias = primarySource.alias;
    const fromSql = this.exprToSqlInline(primarySource.expression, context);

    const savedPatientAlias = this.patientAlias;
    if (this.isPatientRetrieve(primarySource.expression)) {
      this.patientAlias = alias;
    }

    const parts: string[] = [];

    // Build SELECT clause
    let selectExpr = '*';
    if (expr.return) {
      selectExpr = this.exprToSqlInline(expr.return.expression, context);
      if (selectExpr === '*' || /\bSELECT\b/i.test(selectExpr)) {
        selectExpr = `${alias}.*`;
      }
    }

    // Distinct
    const distinct = expr.return?.distinct === true ? 'DISTINCT ' : '';
    parts.push(`SELECT ${distinct}${selectExpr}`);
    parts.push(`FROM ${fromSql} AS ${alias}`);

    // Additional sources as CROSS JOIN
    for (const src of additionalSources) {
      const srcSql = this.exprToSqlInline(src.expression, context);
      parts.push(`CROSS JOIN ${srcSql} AS ${src.alias}`);
    }

    // WITH relationships (semi-joins)
    for (const rel of expr.relationship ?? []) {
      parts.push(this.relationshipToSql(rel, alias, context));
    }

    // WHERE clause
    if (expr.where) {
      const whereSql = this.exprToSqlInline(expr.where, context);
      parts.push(`WHERE ${whereSql}`);
    }

    // Sort
    if (expr.sort) {
      const orderParts = expr.sort.by.map(b => {
        const dir = b.direction === 'desc' ? 'DESC' : 'ASC';
        if (b.type === 'ByColumn' && b.path) return `${b.path} ${dir}`;
        if (b.type === 'ByExpression' && b.expression) {
          return `${this.exprToSqlInline(b.expression, context)} ${dir}`;
        }
        return `1 ${dir}`;
      });
      if (orderParts.length > 0) parts.push(`ORDER BY ${orderParts.join(', ')}`);
    }

    this.patientAlias = savedPatientAlias;
    return parts.join('\n');
  }

  private relationshipToSql(rel: ElmRelationshipClause, parentAlias: string, context: string): string {
    const relView = this.exprToSqlInline(rel.expression, context);
    const suchThat = rel.suchThat
      ? `AND ${this.exprToSqlInline(rel.suchThat, context)}`
      : '';
    const keyword = rel.type === 'With' ? 'EXISTS' : 'NOT EXISTS';
    return `AND ${keyword} (\n  SELECT 1 FROM ${relView} AS ${rel.alias}\n  WHERE ${rel.alias}.subject_id = ${parentAlias}.id ${suchThat}\n)`;
  }

  // ─── Expression references ─────────────────────────────────────────────────

  private expressionRefToSql(expr: ElmExpressionRef): string {
    if (expr.libraryName) {
      this.warn(`Cross-library ExpressionRef "${expr.libraryName}.${expr.name}" — treating as local`);
    }
    return `SELECT * FROM ${toSqlIdentifier(expr.name)}`;
  }

  // ─── Function references (AgeInYearsAt, CalculateAgeInYearsAt, etc.) ──────

  private functionRefToSql(expr: ElmFunctionRef, context: string): string {
    const fn = expr.name;
    const ops = expr.operand ?? [];

    switch (fn) {
      case 'AgeInYearsAt':
      case 'CalculateAgeInYearsAt':
      case 'CalculateAgeAt': {
        const dateArg = asPointInTime(ops[0] ? this.exprToSqlInline(ops[0], context) : 'CURRENT_DATE');
        const birthdate = `${this.patientBirthdateRef()}.birthdate`;
        return `DATE_PART('year', AGE(${dateArg}::date, ${birthdate}))::int`;
      }
      case 'AgeInMonthsAt': {
        const dateArg = asPointInTime(ops[0] ? this.exprToSqlInline(ops[0], context) : 'CURRENT_DATE');
        const birthdate = `${this.patientBirthdateRef()}.birthdate`;
        return `(DATE_PART('year', AGE(${dateArg}::date, ${birthdate})) * 12 + DATE_PART('month', AGE(${dateArg}::date, ${birthdate})))::int`;
      }
      case 'AgeInDaysAt': {
        const dateArg = asPointInTime(ops[0] ? this.exprToSqlInline(ops[0], context) : 'CURRENT_DATE');
        const birthdate = `${this.patientBirthdateRef()}.birthdate`;
        return `((${dateArg})::date - ${birthdate}::date)::int`;
      }
      case 'ToDate':
      case 'date': {
        if (!ops[0]) return 'CURRENT_DATE';
        return `(${asPointInTime(this.exprToSqlInline(ops[0], context))})::date`;
      }
      case 'ToDateTime':
      case 'datetime': {
        if (!ops[0]) return 'CURRENT_TIMESTAMP';
        return `(${asPointInTime(this.exprToSqlInline(ops[0], context))})::timestamptz`;
      }
      case 'start of':
      case 'Start':
        return ops[0] ? startEndToSql(this.exprToSqlInline(ops[0], context), 'start') : 'NULL';
      case 'end of':
      case 'End':
        return ops[0] ? startEndToSql(this.exprToSqlInline(ops[0], context), 'end') : 'NULL';
      case 'ToString':
        return ops[0] ? `(${this.exprToSqlInline(ops[0], context)})::text` : 'NULL';
      case 'ToInteger':
        return ops[0] ? `(${this.exprToSqlInline(ops[0], context)})::integer` : 'NULL';
      case 'ToDecimal':
        return ops[0] ? `(${this.exprToSqlInline(ops[0], context)})::decimal` : 'NULL';
      case 'Coalesce': {
        const args = ops.map(o => this.exprToSqlInline(o, context)).join(', ');
        return `COALESCE(${args})`;
      }
      case 'ToInterval': {
        // ELM coerces a FHIR `Period` (or similar choice-typed datetime element)
        // into an `Interval<DateTime>`. Our flat-table schema stores periods as
        // two columns (e.g. `period_start` / `period_end`), so we synthesize a
        // `tstzrange` if the operand is a Property reference to a period-typed
        // FHIR element. Otherwise pass through.
        const operand = ops[0];
        if (operand && operand.type === 'Property') {
          const prop = operand as ElmProperty;
          const scope = prop.scope ?? '';
          const prefix = stripDateSuffix(prop.path);
          const alias = scope ? `${scope}.` : '';
          return `tstzrange(${alias}${prefix}_start, ${alias}${prefix}_end, '[)')`;
        }
        return ops[0] ? this.exprToSqlInline(ops[0], context) : 'NULL';
      }
      case 'Lower':
        return ops[0] ? `LOWER(${this.exprToSqlInline(ops[0], context)})` : 'NULL';
      case 'Upper':
        return ops[0] ? `UPPER(${this.exprToSqlInline(ops[0], context)})` : 'NULL';
      case 'Length':
        return ops[0] ? `LENGTH(${this.exprToSqlInline(ops[0], context)})` : 'NULL';
      case 'Substring':
        if (ops.length >= 2) {
          const str = this.exprToSqlInline(ops[0], context);
          const start = this.exprToSqlInline(ops[1], context);
          const len = ops[2] ? `, ${this.exprToSqlInline(ops[2], context)}` : '';
          return `SUBSTRING(${str}, ${start}${len})`;
        }
        return 'NULL';
      default:
        this.warn(`Unsupported FunctionRef: ${fn}`);
        return `NULL /* FunctionRef:${fn} */`;
    }
  }

  // ─── Parameter references ──────────────────────────────────────────────────

  private parameterRefToSql(expr: ElmParameterRef): string {
    const literal = parameterValueToSqlLiteral(expr.name, this.opts.parameterValues[expr.name]);
    if (literal) {
      return literal;
    }
    if (expr.name === 'Measurement Period') {
      return `tstzrange('${this.opts.measurementPeriodStart}', '${this.opts.measurementPeriodEnd}', '[)')`;
    }
    this.warn(`Unresolved ParameterRef: ${expr.name}`);
    return `NULL /* ParameterRef:${expr.name} */`;
  }

  // ─── ValueSet references ──────────────────────────────────────────────────

  private valueSetRefToSql(expr: ElmValueSetRef): string {
    const oid = this.valueSets.get(expr.name);
    return oid ? `'${oid}'` : `'${expr.name}'`;
  }

  // ─── Property access ──────────────────────────────────────────────────────

  private propertyToSql(expr: ElmProperty): string {
    // FHIR primitive elements wrap their value in a `.value` property
    // (e.g. `Patient.birthDate.value`). The CQL translator emits this as a
    // nested Property; collapse to the underlying field rather than concatenating
    // into a non-existent `<column>_value`.
    if (expr.path === 'value' && expr.source && expr.source.type === 'Property') {
      return this.propertyToSql(expr.source as ElmProperty);
    }
    const path = this.normalizePath(expr.path);
    if (expr.scope) return `${expr.scope}.${path}`;
    if (expr.source) {
      const src = expr.source;
      if (src.type === 'ExpressionRef') return `${toSqlIdentifier((src as ElmExpressionRef).name)}.${path}`;
      if (src.type === 'Property') return `${this.propertyToSql(src as ElmProperty)}_${path}`;
    }
    return path;
  }

  /** Map common FHIR/ELM path names to SQL-on-FHIR column names */
  private normalizePath(path: string): string {
    // FHIR primitive elements (date, dateTime, string, etc.) carry their literal
    // value in `.value`. CQL's translator emits `birthDate.value`, `gender.value`,
    // etc. when reading from FHIR resources — strip the trailing `.value` so
    // the rest of the map operates on the underlying field name.
    path = path.replace(/\.value$/, '');
    const map: Record<string, string> = {
      birthDate: 'birthdate',
      gender: 'gender',
      id: 'id',
      status: 'status',
      'code.coding': 'code',
      'code.coding.code': 'code',
      'code.coding.system': 'code_system',
      'code.text': 'code_text',
      // Bare choice-typed properties map to the most common DateTime variant
      // (effective.value, performed.value, onset.value also handled below).
      effective: 'effective_datetime',
      onset: 'onset_datetime',
      performed: 'performed_datetime',
      period: 'period_start',
      'onset.value': 'onset_datetime',
      onsetDateTime: 'onset_datetime',
      performedDateTime: 'performed_datetime',
      'performed.value': 'performed_datetime',
      'effective.value': 'effective_datetime',
      effectiveDateTime: 'effective_datetime',
      'value.value': 'value_quantity',
      authoredOn: 'authored_on',
      'period.start': 'period_start',
      'period.end': 'period_end',
    };
    return map[path] ?? path.replace(/\./g, '_');
  }

  // ─── Literals ────────────────────────────────────────────────────────────

  private literalToSql(expr: ElmLiteral): string {
    const t = expr.valueType?.replace(/.*}/, '') ?? '';
    const v = expr.value;
    if (t === 'Boolean') return v === 'true' ? 'TRUE' : 'FALSE';
    if (t === 'Integer' || t === 'Decimal') return String(v);
    // Date/DateTime/Time → cast
    if (t === 'Date') return `DATE '${v}'`;
    if (t === 'DateTime') return `TIMESTAMP '${v}'`;
    // Default: string literal
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  // ─── Interval ─────────────────────────────────────────────────────────────

  private intervalToSql(expr: ElmInterval): string {
    const lo = expr.low ? this.exprToSqlInline(expr.low, 'Patient') : 'NULL';
    const hi = expr.high ? this.exprToSqlInline(expr.high, 'Patient') : 'NULL';
    const lBracket = expr.lowClosed !== false ? '[' : '(';
    const rBracket = expr.highClosed !== false ? ']' : ')';
    return `tstzrange(${lo}, ${hi}, '${lBracket}${rBracket}')`;
  }

  // ─── Boolean operators ────────────────────────────────────────────────────

  private booleanOpToSql(expr: ElmBinaryOp, context: string): string {
    const operands = expr.operand ?? [];
    if (operands.length === 0) {
      return expr.type === 'And' ? 'TRUE' : 'FALSE';
    }
    if (operands.length === 1) {
      return this.exprToSqlInline(operands[0], context);
    }
    const op = expr.type === 'And' ? 'AND' : expr.type === 'Or' ? 'OR' : 'OR';
    return operands.map(o => `(${this.exprToSqlInline(o, context)})`).join(` ${op} `);
  }

  // ─── Comparisons ─────────────────────────────────────────────────────────

  private comparisonToSql(expr: ElmBinaryOp, op: string, context: string): string {
    const [left, right] = expr.operand;
    const l = this.exprToSqlInline(left, context);
    const r = this.exprToSqlInline(right, context);
    return `${l} ${op} ${r}`;
  }

  // ─── Arithmetic ───────────────────────────────────────────────────────────

  private arithmeticToSql(expr: ElmBinaryOp, op: string, context: string): string {
    const [left, right] = expr.operand;
    const l = this.exprToSqlInline(left, context);
    const r = this.exprToSqlInline(right, context);
    return `(${l} ${op} ${r})`;
  }

  // ─── In / During / IncludedIn ─────────────────────────────────────────────

  private inToSql(expr: ElmBinaryOp, context: string): string {
    const [left, right] = expr.operand;
    const l = this.exprToSqlInline(left, context);
    const r = this.exprToSqlInline(right, context);

    // Interval-in-interval (e.g. `E.period during MeasurementPeriod`) uses the
    // `<@` range-containment operator instead of `@>` against a point.
    if (right.type === 'ParameterRef' || right.type === 'Interval') {
      if (/^ts(tz)?range\b/i.test(l.trim())) {
        return `${l} <@ ${r}`;
      }
      return `${r} @> ${l}::timestamptz`;
    }
    // ValueSet membership
    if (right.type === 'ValueSetRef') {
      const vs = right as ElmValueSetRef;
      const oid = this.valueSets.get(vs.name);
      return oid
        ? `${l} IN (SELECT code FROM value_set_expansion WHERE value_set_id = '${oid}')`
        : `TRUE -- in value set: ${vs.name}`;
    }
    // List membership
    if (right.type === 'List') {
      return `${l} IN (${r})`;
    }
    return `${l} IN (${r})`;
  }

  // ─── Contains ────────────────────────────────────────────────────────────

  private containsToSql(expr: ElmBinaryOp, context: string): string {
    // Reverse of In
    const [left, right] = expr.operand;
    const l = this.exprToSqlInline(left, context);
    const r = this.exprToSqlInline(right, context);
    return `${l} @> ARRAY[${r}]`;
  }

  // ─── Exists ───────────────────────────────────────────────────────────────

  private existsToSql(operand: ElmExpression, context: string): string {
    if (operand.type === 'ExpressionRef' && this.patientAlias && this.expressionRefHasSubjectId(operand)) {
      const cte = toSqlIdentifier(operand.name);
      return `EXISTS (SELECT 1 FROM ${cte} AS _cor WHERE _cor.subject_id = ${this.patientAlias}.id)`;
    }
    const inner = this.exprToSqlInline(operand, context);
    if (/^\s*SELECT\b/i.test(inner)) return `EXISTS (${inner})`;
    return `EXISTS (SELECT 1 FROM (${inner}) _e)`;
  }

  // ─── Type guards (Is / As) ────────────────────────────────────────────────
  //
  // The CQL Translator inserts type guards around choice-typed FHIR elements
  // (e.g. `Observation.effective` is `DateTime | Period`). In our flat-table
  // schema there's a column per choice variant (`effective_datetime`,
  // `effective_start`, `effective_end`), so the guard reduces to "is the
  // datetime variant column not null".

  private isTypeToSql(expr: ElmIs, context: string): string {
    const operand = expr.operand;
    const isTypeName = isTypeLeaf(expr.isType ?? expr.isTypeSpecifier);
    const operandSql = this.exprToSqlInline(operand, context);

    // Property whose path matches a choice element: emit a NULL check on the
    // appropriate variant column.
    if (operand && operand.type === 'Property') {
      const prop = operand as ElmProperty;
      const scope = prop.scope ? `${prop.scope}.` : '';
      const path = prop.path;
      if (isTypeName === 'DateTime' || isTypeName === 'Date') {
        return `${scope}${this.normalizePath(path)} IS NOT NULL`;
      }
      if (isTypeName === 'Period') {
        const prefix = stripDateSuffix(path);
        return `(${scope}${prefix}_start IS NOT NULL OR ${scope}${prefix}_end IS NOT NULL)`;
      }
    }

    // Fallback: any non-null value counts as "is" the requested type. Conservative
    // but keeps query semantics sane when we don't have schema-level type info.
    return `(${operandSql}) IS NOT NULL`;
  }

  private asTypeToSql(expr: ElmAs, context: string): string {
    // `As DateTime` / `As Period` is a coercion. With flat columns it's a no-op:
    // hand back the column reference and let the surrounding SQL type-check.
    return this.exprToSqlInline(expr.operand, context);
  }

  // ─── If/Case ─────────────────────────────────────────────────────────────

  private ifToSql(expr: ElmIf, context: string): string {
    const cond = this.exprToSqlInline(expr.condition, context);
    const then = this.exprToSqlInline(expr.then, context);
    const els = this.exprToSqlInline(expr.else, context);
    return `CASE WHEN ${cond} THEN ${then} ELSE ${els} END`;
  }

  private caseToSql(expr: ElmCase, context: string): string {
    const comparand = expr.comparand
      ? ` ${this.exprToSqlInline(expr.comparand, context)}`
      : '';
    const items = expr.caseItem
      .map(ci => {
        const w = this.exprToSqlInline(ci.when, context);
        const t = this.exprToSqlInline(ci.then, context);
        return `WHEN ${w} THEN ${t}`;
      })
      .join(' ');
    const els = this.exprToSqlInline(expr.else, context);
    return `CASE${comparand} ${items} ELSE ${els} END`;
  }

  // ─── Aggregates ───────────────────────────────────────────────────────────

  private aggregateToSql(expr: ElmAggregate, fn: string, context: string): string {
    const src = this.exprToSqlInline(expr.source, context);
    const col = expr.path ? expr.path : '*';
    return `(SELECT ${fn}(${col}) FROM (${src}) _agg)`;
  }

  // ─── DurationBetween ──────────────────────────────────────────────────────

  private durationBetweenToSql(expr: ElmDurationBetween, context: string): string {
    const [start, end] = expr.operand;
    const s = this.exprToSqlInline(start, context);
    const e = this.exprToSqlInline(end, context);
    const precision = (expr.precision ?? 'year').toLowerCase();
    const pgPrecision = precision === 'year' ? 'year' : precision === 'month' ? 'month' : 'day';
    return `DATE_PART('${pgPrecision}', AGE(${e}::timestamp, ${s}::timestamp))`;
  }

  // ─── Set operations ───────────────────────────────────────────────────────

  private setOpToSql(op: string, operands: ElmExpression[], context: string): string {
    return operands
      .map(o => {
        const s = this.exprToSql(o, context);
        return /^\s*SELECT\b/i.test(s) ? s : `SELECT * FROM (${s}) _u`;
      })
      .join(`\n${op}\n`);
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  private listToSql(elements: ElmExpression[], context: string): string {
    if (elements.length === 0) return 'SELECT NULL LIMIT 0';
    const vals = elements.map(e => `(${this.exprToSqlInline(e, context)})`).join(', ');
    return `VALUES ${vals}`;
  }

  // ─── Final SELECT ─────────────────────────────────────────────────────────

  private generateFinalSelect(populations: string[]): string {
    if (populations.length === 0) {
      return 'SELECT COUNT(*) AS patient_count FROM patient_view';
    }

    const cols = populations.map(p => {
      const cte = toSqlIdentifier(p);
      return `  (SELECT COUNT(*) FROM ${cte}) AS ${cte}_count`;
    });

    return `SELECT\n${cols.join(',\n')}`;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private isPopulation(name: string): boolean {
    return MEASURE_POPULATION_NAMES.some(p => p.toLowerCase() === name.toLowerCase());
  }

  private patientBirthdateRef(): string {
    return this.patientAlias ?? 'Patient';
  }

  private isPatientRetrieve(expr: ElmExpression): boolean {
    if (expr.type !== 'Retrieve') {
      return false;
    }
    return stripFhirNamespace((expr as ElmRetrieve).dataType) === 'Patient';
  }

  private isResourceRetrieveExpression(expr: ElmExpression): boolean {
    if (expr.type !== 'Retrieve') {
      return false;
    }
    return stripFhirNamespace((expr as ElmRetrieve).dataType) !== 'Patient';
  }

  private isPatientResourcePopulationQuery(def: ElmExpressionDef): boolean {
    if ((def.context ?? 'Patient') !== 'Patient' || !this.isPopulation(def.name)) {
      return false;
    }
    if (def.expression.type !== 'Query' || def.expression.source.length === 0) {
      return false;
    }
    return this.isResourceRetrieveExpression(def.expression.source[0].expression);
  }

  private patientPopulationQueryToSql(expr: ElmQuery, context: string): string {
    const [primarySource, ...additionalSources] = expr.source;
    const alias = primarySource.alias;
    const resourceFrom = this.exprToSqlInline(primarySource.expression, context);
    const conditions: string[] = [`${alias}.subject_id = Patient.id`];

    for (const src of additionalSources) {
      const srcSql = this.exprToSqlInline(src.expression, context);
      conditions.push(
        `EXISTS (SELECT 1 FROM ${srcSql} AS ${src.alias} WHERE ${src.alias}.subject_id = Patient.id)`,
      );
    }

    for (const rel of expr.relationship ?? []) {
      const relView = this.exprToSqlInline(rel.expression, context);
      const suchThat = rel.suchThat
        ? `AND ${this.exprToSqlInline(rel.suchThat, context)}`
        : '';
      const keyword = rel.type === 'With' ? 'EXISTS' : 'NOT EXISTS';
      conditions.push(
        `${keyword} (SELECT 1 FROM ${relView} AS ${rel.alias} WHERE ${rel.alias}.subject_id = ${alias}.id ${suchThat})`,
      );
    }

    if (expr.where) {
      conditions.push(`(${this.exprToSqlInline(expr.where, context)})`);
    }

    return `SELECT Patient.*
FROM Patient
WHERE EXISTS (
  SELECT 1
  FROM ${resourceFrom} AS ${alias}
  WHERE ${conditions.join('\n    AND ')}
)`;
  }

  private expressionRefHasSubjectId(expr: ElmExpressionRef): boolean {
    if (expr.name === 'Patient') {
      return false;
    }
    const def = this.defines.get(expr.name);
    if (!def) {
      return true;
    }
    return this.expressionUsesNonPatientResource(def.expression);
  }

  private expressionUsesNonPatientResource(expr: ElmExpression): boolean {
    switch (expr.type) {
      case 'Retrieve':
        return stripFhirNamespace((expr as ElmRetrieve).dataType) !== 'Patient';
      case 'Query':
        return (expr as ElmQuery).source.some(s =>
          this.expressionUsesNonPatientResource(s.expression),
        );
      case 'ExpressionRef': {
        const def = this.defines.get((expr as ElmExpressionRef).name);
        return def ? this.expressionUsesNonPatientResource(def.expression) : false;
      }
      case 'Union':
      case 'Except':
      case 'Intersect':
        return ((expr as { operand?: ElmExpression[] }).operand ?? []).some(o =>
          this.expressionUsesNonPatientResource(o),
        );
      default:
        return false;
    }
  }

  private inferPopulations(defs: ElmExpressionDef[]): string[] {
    return defs
      .filter(d => this.isPopulation(d.name))
      .map(d => d.name);
  }

  private topologicalSort(defs: ElmExpressionDef[]): ElmExpressionDef[] {
    const nameSet = new Set(defs.map(d => d.name));
    const visited = new Set<string>();
    const result: ElmExpressionDef[] = [];
    const defMap = new Map(defs.map(d => [d.name, d]));

    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      const def = defMap.get(name);
      if (!def) return;
      // Find dependencies
      const deps = this.collectRefs(def.expression, nameSet);
      for (const dep of deps) visit(dep);
      result.push(def);
    };

    for (const def of defs) visit(def.name);
    return result;
  }

  private collectRefs(expr: ElmExpression, nameSet: Set<string>): string[] {
    const refs: string[] = [];
    const walk = (e: ElmExpression) => {
      if (!e || typeof e !== 'object') return;
      if (e.type === 'ExpressionRef') {
        const ref = (e as ElmExpressionRef).name;
        if (nameSet.has(ref)) refs.push(ref);
      }
      for (const val of Object.values(e)) {
        if (Array.isArray(val)) val.forEach(v => v && typeof v === 'object' && 'type' in v && walk(v as ElmExpression));
        else if (val && typeof val === 'object' && 'type' in val) walk(val as ElmExpression);
      }
    };
    walk(expr);
    return refs;
  }

  private indent(sql: string, spaces = 2): string {
    const pad = ' '.repeat(spaces);
    return sql.split('\n').map(l => `${pad}${l}`).join('\n');
  }

  private warn(msg: string): void {
    this.warnings.push(msg);
  }
}
