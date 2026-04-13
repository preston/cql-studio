-- ============================================================
-- CQL Studio SQL-on-FHIR Views — Boot Install Script
-- Target: HAPI FHIR JPA 6.x / 7.x on PostgreSQL 12+
--
-- Usage:
--   psql $DATABASE_URL -f install.sql
--   or called programmatically by CQL Studio Server on boot (Issue #20).
--
-- Properties:
--   - Idempotent: safe to run on every server boot (CREATE OR REPLACE VIEW)
--   - Version-aware: tracks installed versions in cql_studio_view_version
--   - Non-destructive: never drops existing views or data
--   - Transactional: entire script runs in one transaction
--
-- HAPI FHIR JPA schema assumptions:
--   HFJ_RESOURCE  — resource registry (columns: RES_ID, FHIR_ID, RES_TYPE,
--                   RES_VER, RES_DELETED_AT, RES_UPDATED)
--   HFJ_RES_VER   — versioned resource content (columns: RES_ID, RES_VER,
--                   RES_TEXT bytea, RES_TEXT_VC varchar, RES_ENCODING)
--
-- JSONC (compressed) resources in RES_TEXT are NOT supported by these views.
-- HAPI uses JSON encoding by default; switch HAPI's encoder to JSON if views
-- return NULLs for all resource fields.
-- ============================================================

BEGIN;

-- ── 1. Version tracking infrastructure ───────────────────────────────────────
\ir views/000_schema_version.sql

-- ── 2. Core resource views ───────────────────────────────────────────────────
\ir views/001_patient_view.sql
\ir views/002_observation_view.sql
\ir views/003_condition_view.sql
\ir views/004_procedure_view.sql
\ir views/005_encounter_view.sql
\ir views/006_medication_request_view.sql
\ir views/007_diagnostic_report_view.sql

-- ── 3. Terminology support ────────────────────────────────────────────────────
\ir views/008_value_set_expansion_view.sql

-- ── 4. Summary ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count INTEGER;
  v_rec   RECORD;
BEGIN
  SELECT COUNT(*) INTO v_count FROM cql_studio_view_version;
  RAISE NOTICE '=== CQL Studio SQL-on-FHIR views installed ===';
  RAISE NOTICE '% view(s) registered:', v_count;
  FOR v_rec IN
    SELECT view_name, installed_ver, updated_at
    FROM cql_studio_view_version
    ORDER BY view_name
  LOOP
    RAISE NOTICE '  %-35s v%s  (%s)', v_rec.view_name, v_rec.installed_ver, v_rec.updated_at;
  END LOOP;
  RAISE NOTICE '===============================================';
END $$;

COMMIT;
