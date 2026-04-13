-- ============================================================
-- SQL-on-FHIR Coverage View over HAPI FHIR JPA
-- Version: 1
-- Resource: Coverage (FHIR R4 / US Core 6.1)
--
-- US Core 6.1 MustSupport elements included:
--   status, type, subscriber, subscriberId, beneficiary,
--   relationship, period, payor, class (plan/group)
--
-- Useful for CQL measures that filter by payer, insurance type,
-- or coverage period (e.g. Medicare/Medicaid membership).
-- ============================================================

CREATE OR REPLACE VIEW coverage_view AS
SELECT
  r.FHIR_ID                                                             AS id,

  -- Beneficiary (patient)
  SPLIT_PART(rv.res_json->'beneficiary'->>'reference', '/', 2)          AS beneficiary_id,

  rv.res_json->>'status'                                                AS status,

  -- Coverage type (Medicare Part A/B/C/D, Medicaid, Commercial, etc.)
  rv.res_json->'type'->'coding'->0->>'code'                             AS type_code,
  rv.res_json->'type'->'coding'->0->>'system'                           AS type_system,
  rv.res_json->'type'->'coding'->0->>'display'                          AS type_display,

  -- Subscriber (may differ from beneficiary for dependents)
  SPLIT_PART(rv.res_json->'subscriber'->>'reference', '/', 2)           AS subscriber_id,
  rv.res_json->>'subscriberId'                                          AS subscriber_id_value,

  -- Relationship to subscriber (self, spouse, child, etc.)
  rv.res_json->'relationship'->'coding'->0->>'code'                     AS relationship_code,

  -- Coverage period
  CASE WHEN rv.res_json->'period' ? 'start'
    THEN (rv.res_json->'period'->>'start')::date
    ELSE NULL
  END                                                                   AS period_start,
  CASE WHEN rv.res_json->'period' ? 'end'
    THEN (rv.res_json->'period'->>'end')::date
    ELSE NULL
  END                                                                   AS period_end,

  -- Payor — first entry (usually Organization for commercial/Medicare)
  SPLIT_PART(rv.res_json->'payor'->0->>'reference', '/', 2)             AS payor_id,
  -- Inline payor identifier (when payor is an identifier, not a reference)
  rv.res_json->'payor'->0->'identifier'->>'value'                       AS payor_identifier,

  -- Coverage class — plan/group grouping (first class entry)
  rv.res_json->'class'->0->'type'->'coding'->0->>'code'                 AS class_type_code,
  rv.res_json->'class'->0->>'value'                                     AS class_value,
  rv.res_json->'class'->0->>'name'                                      AS class_name,

  -- Order/priority (lower = higher priority when multiple coverages exist)
  (rv.res_json->>'order')::integer                                      AS priority_order,

  r.RES_UPDATED                                                         AS last_updated

FROM HFJ_RESOURCE r
CROSS JOIN LATERAL (
  SELECT COALESCE(
    v.RES_TEXT_VC,
    CASE WHEN v.RES_ENCODING = 'JSON' THEN convert_from(v.RES_TEXT, 'UTF8') END
  )::jsonb AS res_json
  FROM HFJ_RES_VER v
  WHERE v.RES_ID = r.RES_ID
    AND v.RES_VER = r.RES_VER
) rv
WHERE r.RES_DELETED_AT IS NULL
  AND r.RES_TYPE = 'Coverage';

SELECT cql_studio_set_view_version('coverage_view', 1,
  'US Core 6.1 Coverage view — payer, type, period, class (plan)');
