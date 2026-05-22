# Vision: SQL as the execution layer for CQL

## Origin

In **December 2025**, Eugene Vestel ([@aks129](https://github.com/aks129)) presented a working demonstration of **CQL-to-SQL transpilation against SQL-on-FHIR view definitions** at the SQL-on-FHIR Analytics Conference. The talk argued that the SQL-on-FHIR `ViewDefinition` specification — already implemented across DuckDB, ClickHouse, BigQuery, Postgres, Athena, Spark, and others — could serve as a portable, performant execution substrate for Clinical Quality Language measures without depending on the traditional ELM interpreter stack.

Following that talk, **Preston Lee** (CQL Studio maintainer) and Eugene agreed to collaborate to incorporate the approach into CQL Studio so that the broader CQL community could see — and use — SQL-on-FHIR as a first-class execution path for measures.

This document captures the why behind that decision and the design principles that flow from it.

## The problem we're solving

The CQL ecosystem has invested heavily in dedicated ELM interpreters for over a decade. They are the foundation of every production measure-evaluation pipeline. They are also, by widespread acknowledgement:

- **Slow** on realistic Synthea-scale populations — minutes to hours for a single measure run on hundreds of thousands of patients.
- **Fragile** when run outside their reference JVM environment.
- **Hard to scale horizontally** — most production deployments are vertical and stateful.
- **Disconnected from the rest of the data stack** — clinical data scientists who already work in Postgres, DuckDB, BigQuery, or Spark have to leave their tools to evaluate measures.

Meanwhile, the SQL-on-FHIR working group has standardized **flat, tabular projections of FHIR resources** that any modern analytical SQL engine can query. The same `ViewDefinition` produces `Patient_view`, `Observation_view`, `Condition_view`, etc. on any conforming runtime. These views are **fast, parallel, and durable**.

The thesis is: **what if SQL-on-FHIR views were the execution layer for CQL?**

- CQL stays the authoring language (it is the standard, it has tooling, it is what measure stewards know).
- ELM stays the intermediate representation (CQL → ELM is well-defined, well-tested, and produced by the existing `@cqframework/cql` translator).
- **ELM → SQL becomes the execution path.** No JVM, no custom interpreter, no per-resource hand-written Java/JS — just SQL against the standard SQL-on-FHIR view shape.

## Why this works

1. **SQL is universal.** Every analytical database speaks it. Every BI tool consumes it. Every data team already deploys it.
2. **Set-based execution wins.** A CTE-based CQL transpilation evaluates an entire population in a single query plan, not patient-by-patient. Mammography screening across 100k patients runs in seconds.
3. **The standard already exists.** SQL-on-FHIR `ViewDefinition` is an HL7 specification with multiple production implementations. We're not inventing a new substrate — we're using the one the community has already agreed on.
4. **MeasureReport generation falls out for free.** Population counts come from `COUNT(*) FROM <define_cte>`. The FHIR R4 `MeasureReport` resource is mechanically constructed from a single row.
5. **In-browser is now viable.** [PGlite](https://github.com/electric-sql/pglite) (Postgres-in-WebAssembly) makes the whole pipeline runnable on a laptop with no install, which is exactly what a connectathon demo and a teaching environment need.

## What this PR delivers

CQL Studio now contains a self-contained **CQL → ELM → SQL → execute → MeasureReport** pipeline that runs entirely in the browser:

- `src/app/components/sql-on-fhir/elm-to-sql/` — the in-app transpiler (per Preston's #16 review, baked into the app rather than shipped as a separate package).
- `src/app/services/sql-on-fhir-pglite.service.ts` — lazy-boots PGlite, creates the SQL-on-FHIR flat-table schema, executes generated SQL.
- `public/fhir/sql-on-fhir/` — a shipped CMS125 demo: one Library, one bundle, three pre-expanded value sets.
- The `/sql` page in CQL Studio drives the full five-stage pipeline with a single "Load CMS125 demo" click.

Sample output from the bundled demo:

```
Initial Population:      3
Denominator:             3
Denominator Exclusion:   1
Numerator:               1
Measure Score:           0.5
```

Real CMS125 logic, evaluated by Postgres, in a browser.

## What this is *not*

- **Not a replacement for production ELM interpreters today.** The transpiler covers the common-eCQM subset of ELM (Retrieve, Query, ExpressionRef, FunctionRef, ParameterRef, ValueSetRef, And/Or, comparisons, During/In/IncludedIn, Exists, AgeInYearsAt, CalculateAgeAt, ToInterval, ToDateTime, Is/As type guards). Production measures with stratifiers, supplemental data, ratio-of-counts, and complex temporal logic are work in progress.
- **Not a new IR.** ELM remains the IR. The CQL Translator (`@cqframework/cql`) produces ELM JSON; we transpile that JSON to SQL.
- **Not opinionated about the database.** We target PostgreSQL syntax because PGlite is Postgres and HAPI FHIR JPA's database is Postgres. The architecture is portable to DuckDB, BigQuery, Snowflake with per-dialect adapters.
- **Not a competitor to the SQL-on-FHIR working group's reference implementations.** The `ViewDefinition` shape we use *is* the working group's shape. We're a consumer of that standard, not a fork of it.

## Joint position from Preston and Eugene

> "CQL is here to stay as the authoring language. The execution model has to keep up with how the rest of the data world works. SQL-on-FHIR is the right substrate, and CQL Studio is where the community can see and try the approach hands-on."

This effort is intended to **complement, not replace**, ongoing investment in ELM interpreters. Production sites that have tuned their interpreters should keep using them. The win is offering everyone else — researchers, vendors evaluating CQL, measure stewards prototyping logic — a path that doesn't require standing up a JVM.

## Read next

- [roadmap.md](./roadmap.md) — what's done, what's next, the issue-by-issue plan.
- [architecture.md](./architecture.md) — how the code is structured.
- [faq.md](./faq.md) — practical setup and demo walkthrough.
