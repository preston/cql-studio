-- ============================================================
-- SQL-on-FHIR Procedure View over HAPI FHIR JPA
-- Version: 1
-- Resource: Procedure (FHIR R4)
-- ============================================================

CREATE OR REPLACE VIEW procedure_view AS
SELECT
  r.FHIR_ID                                                       AS id,
  SPLIT_PART(rv.res_json->'subject'->>'reference', '/', 2)        AS subject_id,

  rv.res_json->>'status'                                          AS status,

  -- Code
  rv.res_json->'code'->'coding'->0->>'code'                       AS code,
  rv.res_json->'code'->'coding'->0->>'system'                     AS code_system,
  rv.res_json->'code'->'coding'->0->>'display'                    AS code_display,
  rv.res_json->'code'->>'text'                                    AS code_text,

  -- Category
  rv.res_json->'category'->'coding'->0->>'code'                   AS category_code,

  -- Performed (dateTime or Period)
  CASE
    WHEN rv.res_json ? 'performedDateTime'
      THEN (rv.res_json->>'performedDateTime')::timestamp
    WHEN rv.res_json ? 'performedPeriod'
      THEN (rv.res_json->'performedPeriod'->>'start')::timestamp
    ELSE NULL
  END                                                             AS performed_datetime,

  CASE WHEN rv.res_json ? 'performedPeriod'
    THEN (rv.res_json->'performedPeriod'->>'start')::timestamp
    ELSE NULL
  END                                                             AS performed_start,

  CASE WHEN rv.res_json ? 'performedPeriod'
    THEN (rv.res_json->'performedPeriod'->>'end')::timestamp
    ELSE NULL
  END                                                             AS performed_end,

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
  AND r.RES_TYPE = 'Procedure';

SELECT cql_studio_set_view_version('procedure_view', 1, 'Initial SQL-on-FHIR procedure view');
