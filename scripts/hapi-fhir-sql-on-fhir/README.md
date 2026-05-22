# HAPI FHIR JPA — SQL-on-FHIR Views

SQL boot scripts that create SQL-on-FHIR flat views over the HAPI FHIR JPA PostgreSQL backing database. These views satisfy the table contracts expected by `@cqframework/elm-to-sql`.

Implements [Issue #21](https://github.com/cqframework/cql-studio/issues/21). Preston's server boot code ([Issue #20](https://github.com/cqframework/cql-studio/issues/20)) calls `install.sql` automatically on startup.

## Requirements

| Requirement | Version |
| ----------- | ------- |
| PostgreSQL | 12+ (uses `jsonb_path_query_first`, `LATERAL`) |
| HAPI FHIR JPA | 6.x or 7.x |
| Resource encoding | JSON (not JSONC — see note below) |

## Quick start

```bash
# Run once, or on every boot — safe to re-run
psql "$DATABASE_URL" -f install.sql
```

`DATABASE_URL` should point to the PostgreSQL database underlying your HAPI FHIR JPA server (same DB that HAPI uses). For the CQL Studio bundle, this is set via `CQL_STUDIO_DB_URL`.

## Views created

| View | Resource | Description |
| ---- | -------- | ----------- |
| `patient_view` | Patient | Demographics, name, deceased, race/ethnicity |
| `observation_view` | Observation | Clinical measurements, vitals, labs |
| `condition_view` | Condition | Diagnoses, problems, health concerns |
| `procedure_view` | Procedure | Surgical and clinical procedures |
| `encounter_view` | Encounter | Visits and service delivery |
| `medication_request_view` | MedicationRequest | Prescriptions and orders |
| `diagnostic_report_view` | DiagnosticReport | Lab panels and imaging reports |
| `value_set_expansion` | ValueSet | Expanded code lists for IN-clause filtering |

All views use `CREATE OR REPLACE VIEW` — safe to run repeatedly.

A `cql_studio_view_version` table tracks installed versions for future migration detection.

## How it works

Each view joins two HAPI FHIR JPA tables:

```
HFJ_RESOURCE  ──(RES_ID / RES_VER)──▶  HFJ_RES_VER
  FHIR_ID                                 RES_TEXT_VC  (varchar JSON)
  RES_TYPE                                RES_TEXT     (bytea JSON)
  RES_DELETED_AT                          RES_ENCODING
  RES_UPDATED
```

The current non-deleted resource JSON is extracted via LATERAL join using `RES_VER` to match the latest version. PostgreSQL's `->` and `->>` JSON operators then extract individual fields.

```sql
-- Example: get current resource JSON
COALESCE(
  v.RES_TEXT_VC,
  CASE WHEN v.RES_ENCODING = 'JSON' THEN convert_from(v.RES_TEXT, 'UTF8') END
)::jsonb
```

## JSONC encoding note

HAPI FHIR can store resources in compressed JSON (`JSONC`). These views only handle `JSON` encoding — compressed resources will return `NULL` for all extracted fields.

**Check your HAPI encoding:**
```sql
SELECT RES_ENCODING, COUNT(*) FROM HFJ_RES_VER GROUP BY RES_ENCODING;
```

If you see `JSONC`, configure HAPI to use plain JSON:
```yaml
# application.yaml
hapi:
  fhir:
    resource_encoding: JSON
```

Alternatively, you can decompress on-the-fly if you install the `pg_decompress` extension (not included here).

## Value set expansion

The `value_set_expansion` view reads ValueSet resources already stored in HAPI. ValueSets must be pre-expanded (either uploaded pre-expanded, or expanded via `$expand` and stored back). 

Verify value sets are loaded:
```sql
SELECT value_set_id, COUNT(*) as code_count
FROM value_set_expansion
GROUP BY value_set_id
ORDER BY code_count DESC;
```

## Upgrading views

When this script changes between versions, re-run `install.sql`. `CREATE OR REPLACE VIEW` will update the view definition in place without dropping it. The `cql_studio_view_version` table records the new version and timestamp.

For breaking column changes (future), individual view files will increment their version constant and the boot code will detect the old version and re-run the affected file.

## HAPI schema compatibility

Column names were verified against HAPI FHIR JPA source ([hapifhir/hapi-fhir](https://github.com/hapifhir/hapi-fhir)):

| Table | Key columns used |
| ----- | ---------------- |
| `HFJ_RESOURCE` | `RES_ID`, `FHIR_ID`, `RES_TYPE`, `RES_VER`, `RES_DELETED_AT`, `RES_UPDATED` |
| `HFJ_RES_VER` | `RES_ID`, `RES_VER`, `RES_TEXT`, `RES_TEXT_VC`, `RES_ENCODING` |
