-- ============================================================
-- SQL-on-FHIR DiagnosticReport View over HAPI FHIR JPA
-- Version: 1
-- Resource: DiagnosticReport (FHIR R4)
-- ============================================================

CREATE OR REPLACE VIEW diagnostic_report_view AS
SELECT
  r.FHIR_ID                                                       AS id,
  SPLIT_PART(rv.res_json->'subject'->>'reference', '/', 2)        AS subject_id,

  rv.res_json->>'status'                                          AS status,

  -- Category (first)
  rv.res_json->'category'->0->'coding'->0->>'code'                AS category_code,
  rv.res_json->'category'->0->'coding'->0->>'system'              AS category_system,

  -- Code
  rv.res_json->'code'->'coding'->0->>'code'                       AS code,
  rv.res_json->'code'->'coding'->0->>'system'                     AS code_system,
  rv.res_json->'code'->'coding'->0->>'display'                    AS code_display,

  -- Effective
  CASE
    WHEN rv.res_json ? 'effectiveDateTime'
      THEN (rv.res_json->>'effectiveDateTime')::timestamp
    WHEN rv.res_json ? 'effectivePeriod'
      THEN (rv.res_json->'effectivePeriod'->>'start')::timestamp
    ELSE NULL
  END                                                             AS effective_datetime,

  -- Issued
  CASE WHEN rv.res_json ? 'issued'
    THEN (rv.res_json->>'issued')::timestamp
    ELSE NULL
  END                                                             AS issued,

  -- Encounter reference
  SPLIT_PART(rv.res_json->'encounter'->>'reference', '/', 2)      AS encounter_id,

  r.RES_UPDATED                                                   AS last_updated

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
  AND r.RES_TYPE = 'DiagnosticReport';

SELECT cql_studio_set_view_version('diagnostic_report_view', 1, 'Initial SQL-on-FHIR diagnostic_report view');
