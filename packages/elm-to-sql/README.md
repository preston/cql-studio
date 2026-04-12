# @cqframework/elm-to-sql

Standalone ESM library for transpiling CQL ELM (Expression Logical Model) to SQL-on-FHIR queries and generating FHIR MeasureReports — with no Node.js runtime dependencies.

Implements part of the [CQL Studio SQL-on-FHIR epic](https://github.com/cqframework/cql-studio/issues/15).

## Overview

```
CQL source
    │
    ▼ (@cqframework/cql — in-browser translator)
ELM JSON
    │
    ▼ (this library)
SQL query  ──▶  run via pluggable DB adapter  ──▶  population counts
                                                          │
                                                          ▼
                                                  FHIR MeasureReport
```

## Installation

```bash
npm install @cqframework/elm-to-sql
```

## Usage

### Transpile ELM → SQL

```typescript
import { ElmToSqlTranspiler } from '@cqframework/elm-to-sql';

// elmJson is the output of @cqframework/cql's CqlTranslator.toJson()
// or a manually constructed ELM library wrapper { library: {...} }
const transpiler = new ElmToSqlTranspiler({
  measurementPeriodStart: '2024-01-01T00:00:00Z',
  measurementPeriodEnd:   '2024-12-31T23:59:59Z',
});

const { sql, populations, warnings } = transpiler.transpile(elmJson);
console.log(sql);
// WITH
//   Qualifying_Encounters AS ( SELECT * FROM encounter_view WHERE ... ),
//   Initial_Population AS ( SELECT * FROM patient_view WHERE ... ),
//   ...
// SELECT
//   (SELECT COUNT(*) FROM Initial_Population) AS Initial_Population_count,
//   (SELECT COUNT(*) FROM Denominator) AS Denominator_count,
//   (SELECT COUNT(*) FROM Numerator) AS Numerator_count
```

### Execute with a pluggable adapter (PostgreSQL example)

```typescript
import pg from 'pg';
import { ElmToSqlTranspiler, sqlRowToPopulationCounts, generateMeasureReport } from '@cqframework/elm-to-sql';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const transpiler = new ElmToSqlTranspiler({ measurementPeriodStart: '2024-01-01T00:00:00Z', measurementPeriodEnd: '2024-12-31T23:59:59Z' });
const { sql } = transpiler.transpile(elmJson);

const result = await client.query(sql);
const counts = sqlRowToPopulationCounts(result.rows[0]);

const report = generateMeasureReport(counts, {
  measureUrl: 'http://ecqi.healthit.gov/ecqms/Measure/BreastCancerScreening',
  periodStart: '2024-01-01',
  periodEnd: '2024-12-31',
});

// report is a FHIR MeasureReport — POST it to your FHIR server
```

### Execute with DuckDB (in-browser or Node)

```typescript
import * as duckdb from '@duckdb/duckdb-wasm';
import { ElmToSqlTranspiler, sqlRowToPopulationCounts } from '@cqframework/elm-to-sql';

// ... initialize DuckDB connection ...
const { sql } = new ElmToSqlTranspiler().transpile(elmJson);
const result = await conn.query(sql);
const counts = sqlRowToPopulationCounts(result.toArray()[0]);
```

### Generate SQL-on-FHIR ViewDefinitions

```typescript
import { STANDARD_VIEW_DEFINITIONS, viewDefinitionToSql, generateAllViewsSql } from '@cqframework/elm-to-sql';

// Get all standard FHIR resource ViewDefinition resources (JSON)
console.log(STANDARD_VIEW_DEFINITIONS);

// Get CREATE OR REPLACE VIEW SQL for a specific resource
const { sql } = viewDefinitionToSql(STANDARD_VIEW_DEFINITIONS[0]);

// Get all views as a single deployable SQL script
const script = generateAllViewsSql();
await client.query(script);
```

### Generate a MeasureReport

```typescript
import { generateMeasureReport } from '@cqframework/elm-to-sql';

const report = generateMeasureReport(
  {
    'Initial Population': 150,
    'Denominator': 120,
    'Denominator Exclusion': 5,
    'Numerator': 80,
  },
  {
    measureUrl: 'http://ecqi.healthit.gov/ecqms/Measure/BreastCancerScreening',
    periodStart: '2024-01-01',
    periodEnd: '2024-12-31',
    type: 'summary',
  }
);
// POST report to FHIR server via your app's FHIR client
```

## Supported ELM Node Types

| Type | SQL output |
|------|------------|
| `Retrieve` | `SELECT * FROM {resource}_view [WHERE code IN ...]` |
| `Query` | `SELECT ... FROM ... WHERE ...` with WITH/WITHOUT semi-joins |
| `ExpressionRef` | Reference to a CTE |
| `FunctionRef` | `AgeInYearsAt` → `DATE_PART('year', AGE(...))`, `ToDate`, `ToDateTime`, etc. |
| `ParameterRef` | `Measurement Period` → `tsrange(...)` |
| `ValueSetRef` | `code IN (SELECT code FROM value_set_expansion WHERE value_set_id = ...)` |
| `And`/`Or` | `AND`/`OR` |
| `Equal`/`NotEqual`/`Less`/`Greater`/etc. | Standard SQL operators |
| `In`/`During`/`IncludedIn` | `@>` interval containment or `IN` set |
| `Exists` | `EXISTS (SELECT 1 ...)` |
| `Not` | `NOT (...)` |
| `Count`/`Sum`/`Min`/`Max`/`Avg` | `(SELECT COUNT(*)/SUM(...) FROM ...)` |
| `Union`/`Intersect`/`Except` | `UNION ALL`/`INTERSECT`/`EXCEPT` |
| `If`/`Case` | `CASE WHEN ... THEN ... END` |
| `Interval` | `tsrange(low, high, '[)')` |
| `Literal` | SQL literals with type-appropriate quoting |
| `DurationBetween` | `DATE_PART(precision, AGE(...))` |

## SQL Assumptions

- Target dialect: **PostgreSQL 14+** (primary). DuckDB is largely compatible.
- Views must exist as flat SQL-on-FHIR tables (see `STANDARD_VIEW_DEFINITIONS`).
- Value sets are resolved via a `value_set_expansion(value_set_id, code)` table.
- `patient_view` columns: `id`, `gender`, `birthdate`, `active`, ...
- Interval comparisons use PostgreSQL `tsrange` / `@>` operator.

## API

### `ElmToSqlTranspiler`

```typescript
new ElmToSqlTranspiler(options?: TranspilerOptions)
transpile(elm: ElmLibraryWrapper | ElmLibrary): TranspileResult
```

**TranspilerOptions**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `measurementPeriodStart` | string | Current year Jan 1 | ISO 8601 |
| `measurementPeriodEnd` | string | Current year Dec 31 | ISO 8601 |
| `includeComments` | boolean | `true` | Emit SQL comments |
| `populationDefines` | string[] | auto-detect | Override population define names |

### `generateMeasureReport(counts, options)`

Converts population counts to a FHIR R4 MeasureReport. Does not make FHIR API calls.

### `sqlRowToPopulationCounts(row)`

Converts a flat SQL result row (`{ Initial_Population_count: 150, ... }`) to a `PopulationCounts` map.

### `STANDARD_VIEW_DEFINITIONS`

Array of FHIR `ViewDefinition` resources for Patient, Observation, Condition, Procedure, Encounter, MedicationRequest, DiagnosticReport, Coverage, AllergyIntolerance, Immunization.

### `generateAllViewsSql()`

Returns a PostgreSQL-compatible `CREATE OR REPLACE VIEW` script for all standard views.

## Development

```bash
npm install
npm run build
npm test
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).
