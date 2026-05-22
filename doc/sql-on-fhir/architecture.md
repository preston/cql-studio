# SQL-on-FHIR architecture

How the CQL → ELM → SQL → execute → MeasureReport pipeline is built inside CQL Studio.

## Component diagram

```
                                 ┌────────────────────────────────────────────────┐
                                 │  SqlOnFhirComponent  (Angular, /sql route)     │
                                 │  - five-step UI: Library, CQL, ELM, SQL, Exec  │
                                 │  - "Load CMS125 demo" entry point              │
                                 └───────┬────────────────────────────┬───────────┘
                                         │                            │
                                         │ ELM JSON                   │ counts → MeasureReport
                                         ▼                            ▼
┌────────────────────┐         ┌────────────────────────────┐    ┌─────────────────────────┐
│ TranslationService │────────▶│ SqlOnFhirPipelineService   │───▶│ generateMeasureReport() │
│ (@cqframework/cql) │         │  - generateSql()           │    │ (elm-to-sql lib)        │
│  toXml(), toJson() │         │  - executeSql()            │    └─────────────────────────┘
└────────────────────┘         │  - generateMeasureReport() │
                               │  - saveMeasureReport()     │
                               └────┬────────────────┬──────┘
                                    │                │
                                    │ SQL            │ FlatTables
                                    ▼                ▼
                ┌────────────────────────┐    ┌──────────────────────────────────┐
                │ ElmToSqlTranspiler     │    │ SqlOnFhirPgliteService           │
                │ (in-app library)       │    │  - lazy WASM boot                │
                │  - .transpile(elmJson) │    │  - schema (STANDARD_VIEW_DEFS)   │
                │  → { sql, populations} │    │  - .seed(dataKey, FlatTables)    │
                └────────────────────────┘    │  - .execute(sql) → rows          │
                                              └──────────────┬───────────────────┘
                                                             │
                                                             ▼
                                              ┌──────────────────────────────────┐
                                              │ @electric-sql/pglite             │
                                              │  ~3 MB WASM + 5 MB FS bundle     │
                                              │  served from /pglite/ at build   │
                                              └──────────────────────────────────┘

                                ┌──────────────────────────────────────────────────┐
                                │ SqlOnFhirBundleFlattener (pure functions, .lib) │
                                │  flattenBundle(Bundle) → FlatTables             │
                                │  flattenValueSets(VS[]) → expansion rows        │
                                └──────────────────────────────────────────────────┘

                                ┌──────────────────────────────────────────────────┐
                                │ SqlOnFhirDemoService                            │
                                │  loadCms125() fetches:                          │
                                │   - cms125-library.json (FHIR Library)          │
                                │   - cms125-bundle.json (5-patient demo)         │
                                │   - valuesets/{mammography,bilateral-mastectomy, │
                                │     office-visit}.json (pre-expanded)           │
                                └──────────────────────────────────────────────────┘
```

## Key files

| Path | Role |
|------|------|
| [src/app/components/sql-on-fhir/sql-on-fhir.component.ts](../../src/app/components/sql-on-fhir/sql-on-fhir.component.ts) | UI orchestrator, signal-based state for all five pipeline steps. |
| [src/app/components/sql-on-fhir/elm-to-sql/](../../src/app/components/sql-on-fhir/elm-to-sql/) | In-app `elm-to-sql` library. Pure TypeScript, no Node deps. |
| [src/app/components/sql-on-fhir/elm-to-sql/transpiler/elm-to-sql.ts](../../src/app/components/sql-on-fhir/elm-to-sql/transpiler/elm-to-sql.ts) | The transpiler proper: ELM JSON in, Postgres SQL out. |
| [src/app/components/sql-on-fhir/elm-to-sql/measure/measure-report.ts](../../src/app/components/sql-on-fhir/elm-to-sql/measure/measure-report.ts) | `generateMeasureReport(counts, options)` and `sqlRowToPopulationCounts(row)`. |
| [src/app/services/sql-on-fhir/sql-on-fhir-pipeline.service.ts](../../src/app/services/sql-on-fhir/sql-on-fhir-pipeline.service.ts) | The orchestrator service the UI calls. |
| [src/app/services/sql-on-fhir/sql-on-fhir-pglite.service.ts](../../src/app/services/sql-on-fhir/sql-on-fhir-pglite.service.ts) | In-browser Postgres via PGlite. Lazy boot, schema, seed, execute. |
| [src/app/services/sql-on-fhir/sql-on-fhir-bundle-flattener.lib.ts](../../src/app/services/sql-on-fhir/sql-on-fhir-bundle-flattener.lib.ts) | FHIR Bundle → flat rows, matching `STANDARD_VIEW_DEFINITIONS`. |
| [src/app/services/sql-on-fhir/sql-on-fhir-demo.service.ts](../../src/app/services/sql-on-fhir/sql-on-fhir-demo.service.ts) | Fetches shipped demo content. |
| [src/app/services/translation.service.ts](../../src/app/services/translation.service.ts) | `@cqframework/cql` wrapper. Exposes both ELM XML and ELM JSON. |
| [public/fhir/sql-on-fhir/](../../public/fhir/sql-on-fhir/) | Static demo Library, Bundle, and ValueSets. |
| [scripts/hapi-fhir-sql-on-fhir/](../../scripts/hapi-fhir-sql-on-fhir/) | PostgreSQL view scripts for HAPI FHIR JPA — the server-side counterpart. |

## Flat-table schema

The transpiler targets a schema whose tables are *named like* the SQL-on-FHIR view names (`patient_view`, `observation_view`, etc.) but are concrete tables in PGlite, not views over a normalized FHIR store.

- This sidesteps the need for a Postgres `jsonb_*` extraction layer in-browser.
- It keeps the SQL emitted by the transpiler **identical** to what would run against real HAPI FHIR JPA views — those views *do* extract from the normalized `HFJ_RESOURCE` / `HFJ_RES_VER` tables, but they project to the same column shape.
- The `STANDARD_VIEW_DEFINITIONS` in the library is the single source of truth for the column shape. Both the bundle flattener and the PGlite DDL derive from it.

## Data flow (CMS125 demo)

1. `SqlOnFhirDemoService.loadCms125()` fetches three JSONs from `/fhir/sql-on-fhir/`.
2. Component populates `selectedLibrary`, `selectedLibraryJson`, and `cqlPreview` (base64-decoded CQL).
3. Effect chain: `cqlPreview` changes → `TranslationService.translateCqlToElm(cql)` → `elmXmlRaw` and `elmJsonRaw` signals fire.
4. Effect: `elmJsonRaw` non-null → `SqlOnFhirPipelineService.generateSql(elmJson, library)` → `sqlText` signal.
5. User clicks **Execute SQL** → component calls `SqlOnFhirPipelineService.executeSql(sql, { dataKey, bundle, valueSets })`:
   - On first call, the pipeline service flattens the bundle + value sets, calls `pglite.seed(dataKey, tables)`.
   - Then `pglite.execute(sql)` returns a single row (the population counts).
   - Pipeline returns `{ raw, counts, durationMs }`. Component stores `counts`.
6. User clicks **Generate FHIR MeasureReport** → `SqlOnFhirPipelineService.generateMeasureReport(counts, library)` → MeasureReport JSON rendered in textarea.
7. **Optional** "Save to FHIR server" → POST to `{fhirBaseUrl}/MeasureReport`.

## Why an Angular signal-based component?

CQL Studio's broader IDE is signal-based (see `IdeStateService`, `SettingsService`). The pipeline component sticks to that convention: each step is a signal, effects chain, and there is no observable streaming-pipeline framework imposed on top.

## Server-side execution (future)

The same `ElmToSqlTranspiler` output runs unchanged against:

- **PGlite** (in-browser, today).
- **HAPI FHIR JPA on Postgres** (via Preston's Issue #20) — the `scripts/hapi-fhir-sql-on-fhir/` views project the HAPI normalized schema into the same flat-view shape, so the transpiled SQL is portable.
- **Any other SQL-on-FHIR-compliant runtime** with a Postgres-compatible dialect.

The pipeline service has a `canSaveMeasureReport()` toggle today; a parallel `useServerSqlExecutor()` toggle is a small follow-up once Preston's `/$execute-sql` endpoint lands.
