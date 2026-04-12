# @cqframework/elm-to-sql — FAQ & Current Support State

This document covers what the library currently handles, known gaps, and how to work around them. Updated as the library evolves toward the June CMS Connectathon demo.

---

## General

### What does this library do?

It converts CQL ELM (Expression Logical Model) JSON — the intermediate representation produced by `@cqframework/cql`'s in-browser CQL-to-ELM translator — into SQL queries using the SQL-on-FHIR specification. It also generates FHIR R4 `MeasureReport` resources from SQL population counts.

### What does it NOT do?

- It does not parse CQL text. Use `@cqframework/cql` for that.
- It does not execute SQL. You supply your own database connection (PostgreSQL, DuckDB, etc.).
- It does not make FHIR API calls. Your application posts the MeasureReport.
- It does not resolve value sets at runtime. Value set expansion is expected in a `value_set_expansion` table.

### What SQL dialect does it target?

Primary target is **PostgreSQL 14+**. The generated SQL uses:
- `tsrange(start, end, '[)')` for interval containment
- `DATE_PART('year', AGE(...))` for age calculations
- `bool_or` / `bool_and` for AnyTrue/AllTrue aggregates
- Standard `EXISTS`, `NOT EXISTS`, `UNION ALL`, `INTERSECT`, `EXCEPT`

**DuckDB** is largely compatible. Differences:
- DuckDB uses `date_diff('year', birthdate, date)` instead of `DATE_PART('year', AGE(...))`
- DuckDB does not have `tsrange` — use `date BETWEEN start AND end` instead

A DuckDB dialect option is planned.

---

## ELM Input Format

### What ELM format does the transpiler accept?

The library expects ELM **JSON** in the standard HL7 format:

```json
{
  "library": {
    "identifier": { "id": "MyMeasure", "version": "1.0.0" },
    "statements": {
      "def": [
        { "name": "Initial Population", "context": "Patient", "expression": { ... } }
      ]
    }
  }
}
```

This is the `{ library: ElmLibrary }` wrapper shape. You can also pass the inner `ElmLibrary` directly.

### CQL Studio currently uses `translator.toXml()` — how do I get ELM JSON?

The `@cqframework/cql` `CqlTranslator` class exposes both `toXml()` and `toJson()`. CQL Studio's `TranslationService` currently only calls `toXml()`. To use this library from the Angular app:

```typescript
// In translation.service.ts — add a toJson path:
const elmJson = JSON.parse(translator.toJson());
const transpiler = new ElmToSqlTranspiler({ ... });
const { sql } = transpiler.transpile(elmJson);
```

This wiring is Preston's responsibility (Issue #23), but you can prototype it locally by modifying `TranslationService.translateCqlToElm()`.

### Does it handle ELM XML?

Not directly. Parse XML to the JSON structure first. The JSON format is simpler and the authoritative target.

---

## ELM Node Support

### Which ELM expression types are supported?

| Category | Supported types |
| -------- | --------------- |
| Data access | `Retrieve`, `Query` (source, where, return, sort, relationship) |
| References | `ExpressionRef`, `FunctionRef`, `ParameterRef`, `ValueSetRef` |
| Primitives | `Literal` (Integer, Decimal, String, Boolean, Date, DateTime), `Null` |
| Logic | `And`, `Or`, `Not`, `Xor` |
| Comparison | `Equal`, `NotEqual`, `Less`, `Greater`, `LessOrEqual`, `GreaterOrEqual` |
| Arithmetic | `Add`, `Subtract`, `Multiply`, `Divide` |
| Set/interval | `In`, `During`, `IncludedIn`, `Contains`, `Exists` |
| Aggregates | `Count`, `Sum`, `Min`, `Max`, `Avg` |
| Temporal | `DurationBetween`, `Today`, `Now`, `Start`, `End`, `Interval` |
| Control flow | `If`, `Case` |
| Collections | `Union`, `Intersect`, `Except`, `Distinct`, `Flatten`, `First`, `Last`, `List` |
| Functions | `AgeInYearsAt`, `AgeInMonthsAt`, `AgeInDaysAt`, `ToDate`, `ToDateTime`, `ToString`, `ToInteger`, `ToDecimal`, `Coalesce`, `Lower`, `Upper`, `Length`, `Substring` |
| Type ops | `As`, `Convert`, `ToList`, `SingletonFrom` |

### What is NOT yet supported?

| Type | Status | Notes |
| ---- | ------ | ----- |
| `Collapse` / `Expand` | Emits warning + NULL | Interval list operations — planned |
| `Message` | Emits warning + NULL | CQL tracing construct — low priority |
| `Ratio` / `Quantity` comparisons | Partial | Unit-aware math not implemented |
| Cross-library `ExpressionRef` | Warning + falls through | Treats as local CTE reference |
| `AnyInValueSet` / `AllInValueSet` | Emits warning + NULL | Planned |
| `Slice` / `IndexOf` | Emits warning + NULL | Rarely used in eCQMs |
| `DurationBetween` with `Week`/`Hour` | Falls to day | PostgreSQL `DATE_PART` limitation |
| `Tuple` expressions | Emits warning + NULL | Complex return types — planned |
| Stratifiers | Not generated | `stratifier` in MeasureReport always empty |
| `DateTime` arithmetic (`+ 1 year`) | Not supported | Use `DurationBetween` instead |

When an unsupported node is encountered, the transpiler emits a SQL comment (`NULL -- unsupported: TypeName`) and adds an entry to `warnings[]` in the `TranspileResult`. **Always check `warnings` after transpiling.**

---

## Value Sets

### How are value sets resolved?

The generated SQL uses a `value_set_expansion` table with at minimum columns `(value_set_id TEXT, code TEXT, system TEXT)`. Example for PostgreSQL:

```sql
CREATE TABLE value_set_expansion (
  value_set_id TEXT NOT NULL,  -- OID or canonical URL from ValueSetDef.id
  code         TEXT NOT NULL,
  system       TEXT,
  display      TEXT,
  PRIMARY KEY (value_set_id, code)
);
```

Populate this from your terminology server's `$expand` operation or a pre-loaded VSAC extract.

### The generated SQL uses OIDs — my server uses canonical URLs. What do I do?

The OID/URL comes directly from the CQL `valueset` declaration (`ElmValueSetDef.id`). Standard eCQM CQL uses VSAC OIDs like `urn:oid:2.16.840.1.113883.3.464.1003.108.12.1018`. Your `value_set_expansion` table's `value_set_id` column should match whatever format appears in the CQL source.

---

## Measurement Period

### How is `Measurement Period` handled?

`ParameterRef { name: "Measurement Period" }` is resolved to a PostgreSQL `tsrange` literal using `measurementPeriodStart` and `measurementPeriodEnd` from `TranspilerOptions`. Default is the current calendar year.

For `During` / `In` comparisons against `Measurement Period`, the generated SQL uses `@>` containment:

```sql
tsrange('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', '[)') @> effective_datetime::timestamptz
```

### What if the CQL uses a different parameter name?

Non-`Measurement Period` `ParameterRef` nodes emit `NULL -- ParameterRef:name` with a warning. For custom parameters, use the `populationDefines` option to control output, and inject literal values in the SQL before execution.

---

## SQL Views

### What base views does the transpiler expect?

The transpiler generates SQL that references views like `patient_view`, `observation_view`, `condition_view`, etc. These must exist in your database. The library provides two ways to create them:

1. **`STANDARD_VIEW_DEFINITIONS`** — array of FHIR `ViewDefinition` resources (JSON)
2. **`generateAllViewsSql()`** — `CREATE OR REPLACE VIEW` SQL script

For the bundled HAPI FHIR JPA server (the one shipping with CQL Studio), the views target HAPI's internal PostgreSQL schema — that's Issue #21, which will produce a separate boot script.

### What columns does `patient_view` need?

Minimum required by the transpiler:

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | text | Patient.id |
| `gender` | text | `male` / `female` / `other` / `unknown` |
| `birthdate` | date | Patient.birthDate |
| `active` | boolean | Patient.active |

`AgeInYearsAt` uses `p.birthdate` with alias `p` (from the query source alias).

### What columns does `encounter_view` need?

| Column | Type |
| ------ | ---- |
| `id` | text |
| `subject_id` | text |
| `status` | text |
| `period_start` | timestamp |
| `period_end` | timestamp |
| `type_code` | text |
| `type_system` | text |

---

## MeasureReport

### Which population names produce standard eCQM population codes?

| CQL define name | FHIR code |
| --------------- | --------- |
| `Initial Population` | `initial-population` |
| `Denominator` | `denominator` |
| `Denominator Exclusion` | `denominator-exclusion` |
| `Denominator Exception` | `denominator-exception` |
| `Numerator` | `numerator` |
| `Numerator Exclusion` | `numerator-exclusion` |
| `Measure Population` | `measure-population` |
| `Measure Population Exclusion` | `measure-population-exclusion` |

Define names that don't match the list above are silently excluded from `group.population[]`.

### How is measure score calculated?

`Numerator / (Denominator - Denominator Exclusion - Denominator Exception)`, rounded to 4 decimal places. Returns `null` (no `measureScore` field) if the adjusted denominator is ≤ 0.

### The report ID changes every run. Is that expected?

Yes — IDs are generated with `Math.random()`. For idempotent runs, pass `options.id` explicitly.

---

## Testing

### How do I run the tests?

```bash
cd packages/elm-to-sql
npm install
npm test
```

### What's covered by the test suite?

The `test/elm-to-sql.test.ts` suite uses a CMS125 Breast Cancer Screening ELM fixture covering:
- Transpilation without errors
- SQL structure (WITH, CTEs, final SELECT)
- Population detection
- `measurementPeriodStart`/`End` options
- Comment suppression
- Bare `ElmLibrary` input (no wrapper)
- `ExpressionRef` → CTE reference
- `ValueSetRef` → `value_set_expansion` lookup
- `AgeInYearsAt` → `DATE_PART`
- `generateMeasureReport` — resource shape, period, populations, score
- `sqlRowToPopulationCounts` — column parsing
- `STANDARD_VIEW_DEFINITIONS` — counts, DDL output

### How do I add a new ELM fixture?

Drop a `.elm.json` file in `test/fixtures/` matching the `{ library: ElmLibrary }` shape. You can get real ELM JSON by running `@cqframework/cql`'s translator against your CQL:

```typescript
const translator = CqlTranslator.fromText(cqlText, libraryManager);
const elmJson = JSON.parse(translator.toJson());
```

---

## Roadmap

| Priority | Item |
| -------- | ---- |
| High | DuckDB dialect option (`dialectOptions: { type: 'duckdb' }`) |
| High | Issue #21 — HAPI FHIR JPA view boot scripts |
| High | Issue #19 — CQL Studio Server DB proxy endpoint |
| Medium | `Collapse`/`Expand` interval operations |
| Medium | `Tuple` return type flattening |
| Medium | Stratifier support in `generateMeasureReport` |
| Medium | `AnyInValueSet` / `AllInValueSet` |
| Low | `DateTime` arithmetic expressions |
| Low | Full cross-library resolution |

---

*Last updated: April 2026. Track progress at [cqframework/cql-studio#15](https://github.com/cqframework/cql-studio/issues/15).*
