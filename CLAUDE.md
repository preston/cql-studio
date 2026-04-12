# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CQL Studio is an Angular single-page application for developing, testing, and publishing Clinical Quality Language (CQL) and FHIR-based healthcare artifacts. It combines a CQL IDE, FHIR resource management, AI-assisted code generation, and test runner integration.

## Commands

```bash
npm run start        # Dev server (localhost:4200)
npm run build        # Production build
npm run watch        # Build in watch mode
npm test             # Unit tests via Vitest (services only)
npm run test:e2e     # E2E tests via Playwright (headless)
npm run test:e2e:ui  # Playwright with interactive UI
```

To run a single unit test file:
```bash
npx vitest run src/app/services/path/to/file.spec.ts
```

Unit tests are scoped to `src/app/services/**/*.spec.ts` only (see `vitest.config.ts`).

**Docker:**
```bash
docker build -t hlseven/quality-cql-studio:latest .
docker run -p 4200:80 hlseven/quality-cql-studio
```

Runtime environment variables:
- `CQL_STUDIO_RUNNER_BASE_URL` — CQL Tests Runner endpoint (default: `http://localhost:3000`)
- `CQL_STUDIO_FHIR_BASE_URL` — FHIR server endpoint (default: `http://localhost:8080/fhir`)

## Architecture

### Tech Stack
- **Angular 21** with TypeScript strict mode, signals-based state management
- **RxJS** for async/reactive operations
- **CodeMirror 6** for CQL/SQL editing with syntax highlighting
- **Bootstrap 5 + Bootswatch Litera** for UI
- **Vitest** (unit) + **Playwright** (E2E) for testing
- **FHIR R4** types via `@types/fhir`; CQL parsing via `@cqframework/cql`

### Feature Modules (Routes)

| Route | Component | Purpose |
|-------|-----------|---------|
| `/ide/*` | `cql-ide/` | Full CQL IDE with editors, panels, AI assistant |
| `/results` | `results-viewer/` | Display/analyze CQL test results |
| `/runner` | `runner/` | Configure and execute CQL tests |
| `/terminology` | `terminology/` | Value sets, concept maps, code systems |
| `/measures` | `measure-editor/` | FHIR Measure resource editing |
| `/vsac` | VSAC browser | NLM value set browser |
| `/settings` | `settings/` | Endpoints, themes, preferences |

### IDE Component Architecture (`src/app/components/cql-ide/`)

The IDE uses a draggable three-panel layout (left/right/bottom) managed by `ide-state.service`. Each panel contains tab-based editors: CQL editor (CodeMirror), ELM viewer, FHIR resource browser, AI chat, and more. The AI assistant tab integrates with Claude API or local Ollama models via `ai.service`.

### Service Layer (`src/app/services/`)

Services are organized by domain — ~60+ total:

- **CQL**: `cql-execution`, `cql-validation`, `cql-parsing`, `cql-formatter`, `translation` (CQL↔ELM)
- **AI**: `ai.service` (orchestration), `ai-conversation-state`, `ai-planning`, `ai-tool-execution-manager`, `ai-stream-response-handler`, `tool-orchestrator`, `tool-policy`
- **FHIR**: `fhir-client`, `fhir-package-import`, `fhir-package-registry`, `fhir-search`, `terminology`
- **State**: `ide-state` (signals), `ide-tab-registry`, `settings`, `library`, `measure`
- **Utilities**: `toast`, `clipboard`, `file-loader`, `vsac`, `schema-validation`

### State Management Pattern

The app uses Angular signals (not NgRx). `ide-state.service` is the central store for IDE panel/editor state. Settings are persisted via `settings.service` to `localStorage`. Deep-linking uses query params defined in `src/app/models/query-params.model.ts`.

### Data Flow

```
Component → Service → HTTP (FHIR server / CQL runner / AI API)
               ↓
          Angular Signals / RxJS Observables
               ↓
          localStorage / sessionStorage
```

Constants for storage keys are in `src/app/constants/session-storage.constants.ts`.

---

## SQL-on-FHIR Feature (Active Development — branch: `feature/sql-on-fhir`)

This fork adds SQL-on-FHIR support to CQL Studio. The goal is end-to-end evaluation of CQL-based quality measures using SQL instead of a CQL engine, targeting the June CMS Connectathon demo.

### Tracking Issues

| Issue | Owner | Status | Description |
| ----- | ----- | ------ | ----------- |
| [#15](https://github.com/cqframework/cql-studio/issues/15) | both | Epic | End-to-end SQL on FHIR support |
| [#16](https://github.com/cqframework/cql-studio/issues/16) | aks129 | **Done (lib)** | Standalone ELM→SQL library |
| [#18](https://github.com/cqframework/cql-studio/issues/18) | aks129 | Open | CMS demo examples (CMS125, CMS130) |
| [#19](https://github.com/cqframework/cql-studio/issues/19) | Preston | Blocked on #16 | CQL Studio Server DB connection |
| [#20](https://github.com/cqframework/cql-studio/issues/20) | Preston | Blocked on #21 | Server boot scripts for SQL views |
| [#21](https://github.com/cqframework/cql-studio/issues/21) | aks129 | Open | SQL-on-FHIR views for HAPI FHIR JPA |
| [#23](https://github.com/cqframework/cql-studio/issues/23) | Preston | Blocked on #16/#19 | UI integration |
| [#24](https://github.com/cqframework/cql-studio/issues/24) | aks129 | Open | Demo video |

### Standalone Library: `packages/elm-to-sql/`

Implements Issue #16. Pure ESM TypeScript, zero runtime Node.js dependencies, Apache 2.0.

```bash
# From packages/elm-to-sql/
npm install
npm run build          # tsc compile
npm test               # 24 Jest tests
```

**Pipeline:** ELM JSON (from `@cqframework/cql`) → `ElmToSqlTranspiler.transpile()` → SQL WITH CTEs → run via pluggable DB adapter → `generateMeasureReport()` → FHIR MeasureReport

**Key source files:**

- [packages/elm-to-sql/src/transpiler/elm-to-sql.ts](packages/elm-to-sql/src/transpiler/elm-to-sql.ts) — core transpiler
- [packages/elm-to-sql/src/types/elm.ts](packages/elm-to-sql/src/types/elm.ts) — HL7 ELM JSON types
- [packages/elm-to-sql/src/views/view-definitions.ts](packages/elm-to-sql/src/views/view-definitions.ts) — FHIR ViewDefinitions + SQL DDL
- [packages/elm-to-sql/src/measure/measure-report.ts](packages/elm-to-sql/src/measure/measure-report.ts) — MeasureReport generator
- [packages/elm-to-sql/FAQ.md](packages/elm-to-sql/FAQ.md) — current support details and known gaps

### Demo Sequence (CMS125 — Breast Cancer Screening)

End-to-end flow for the June CMS Connectathon demo:

1. **Load CQL** — Open CMS125 library in CQL Studio IDE (`/authoring/cql`)
2. **Translate to ELM** — CQL Studio uses `@cqframework/cql` in-browser; ELM JSON appears in ELM tab
3. **Generate SQL** — (pending UI — Issue #23) Pass ELM JSON to `ElmToSqlTranspiler`; generated SQL appears in new SQL tab
4. **Run SQL** — CQL Studio Server executes SQL against PostgreSQL under HAPI FHIR (Issue #19/#20)
5. **View MeasureReport** — `generateMeasureReport()` builds FHIR resource; saved via FHIR API; viewable in Results Viewer
6. **Compare** — Side-by-side CQL engine result vs SQL result showing identical population counts

### Environment Variables (SQL feature)

- `CQL_STUDIO_DB_URL` — PostgreSQL connection string for HAPI FHIR's backing database (Issue #19)

### Getting ELM JSON from CQL Studio

The `TranslationService` (`src/app/services/translation.service.ts`) currently exposes `translateCqlToElm()` returning ELM XML via `translator.toXml()`. For the SQL tab integration (Issue #23), it needs to also call `translator.toJson()` to get the ELM JSON that `ElmToSqlTranspiler` consumes. Preston owns this wiring (#23).
