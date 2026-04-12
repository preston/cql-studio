/**
 * @cqframework/elm-to-sql
 *
 * Standalone ESM library for transpiling CQL ELM (Expression Logical Model)
 * to SQL-on-FHIR queries and generating FHIR MeasureReport resources.
 *
 * Usage:
 *   import { ElmToSqlTranspiler, generateMeasureReport } from '@cqframework/elm-to-sql';
 *
 *   const transpiler = new ElmToSqlTranspiler({ measurementPeriodStart: '2024-01-01', measurementPeriodEnd: '2024-12-31' });
 *   const { sql, populations, warnings } = transpiler.transpile(elmLibraryJson);
 *
 *   // Execute sql via your own DB adapter, then:
 *   const report = generateMeasureReport(counts, { measureUrl: '...', periodStart: '2024-01-01', periodEnd: '2024-12-31' });
 */

// Core transpiler
export { ElmToSqlTranspiler } from './transpiler/elm-to-sql.js';
export type { TranspilerOptions, TranspileResult } from './transpiler/elm-to-sql.js';

// ELM types — re-exported for consumers building ELM inputs
export type {
  ElmLibraryWrapper,
  ElmLibrary,
  ElmVersionedIdentifier,
  ElmExpressionDef,
  ElmExpression,
  ElmRetrieve,
  ElmQuery,
  ElmBinaryOp,
  ElmUnaryOp,
  ElmFunctionRef,
  ElmExpressionRef,
  ElmLiteral,
  ElmProperty,
  ElmInterval,
  ElmParameterRef,
  ElmValueSetRef,
  ElmValueSetDef,
  ElmCodeSystemDef,
} from './types/elm.js';
export { stripFhirNamespace, toSqlIdentifier } from './types/elm.js';

// MeasureReport generator
export { generateMeasureReport, sqlRowToPopulationCounts } from './measure/measure-report.js';
export type {
  PopulationCounts,
  MeasureReportOptions,
  FhirMeasureReport,
  FhirMeasureReportGroup,
  FhirMeasureReportPopulation,
} from './measure/measure-report.js';

// SQL-on-FHIR ViewDefinitions
export {
  STANDARD_VIEW_DEFINITIONS,
  viewDefinitionToSql,
  generateAllViewsSql,
} from './views/view-definitions.js';
export type {
  ViewDefinition,
  ViewDefinitionSelect,
  ViewDefinitionColumn,
  SqlViewDefinition,
} from './views/view-definitions.js';
