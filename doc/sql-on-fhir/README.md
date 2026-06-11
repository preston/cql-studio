# SQL-on-FHIR in CQL Studio

This directory documents the SQL-on-FHIR execution path that ships with CQL Studio: CQL → ELM → SQL (Postgres) → in-browser (PGlite) or server-side (HAPI FHIR JPA) execution → FHIR `MeasureReport`.

| Document | Audience | Purpose |
|----------|----------|---------|
| [vision.md](./vision.md) | Anyone | Why we built this — the December 2025 SQL-on-FHIR Analytics Conference origin and Preston/Eugene's joint design decision. |
| [roadmap.md](./roadmap.md) | Contributors | What's shipped, what's next, the issue-by-issue plan. |
| [faq.md](./faq.md) | Users / developers | Setup, demo walkthrough, troubleshooting, "how do I add a new measure?". |
| [architecture.md](./architecture.md) | Contributors | Component diagram, key interfaces, how the in-app `elm-to-sql` library fits into the Angular signal-based pipeline. |

## Quick start (demo)

1. Run CQL Studio: `npm run start`.
2. Navigate to <http://localhost:4200/sql>.
3. Click **Load CMS125 demo**.
4. Step through the five-stage pipeline: FHIR Library → Decoded CQL → ELM Translation → Generated SQL → Execute SQL.
5. Generate the FHIR R4 MeasureReport. Save to a configured FHIR server if you've set one in Settings.

No backend, no Docker, no database setup required — everything runs in the browser via [PGlite](https://github.com/electric-sql/pglite) (Postgres compiled to WebAssembly).
