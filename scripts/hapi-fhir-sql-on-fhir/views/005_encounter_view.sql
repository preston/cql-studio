-- ============================================================
-- SQL-on-FHIR Encounter View over HAPI FHIR JPA
-- Version: 1
-- Resource: Encounter (FHIR R4)
-- ============================================================

CREATE OR REPLACE VIEW encounter_view AS
SELECT
  r.FHIR_ID                                                       AS id,
  SPLIT_PART(rv.res_json->'subject'->>'reference', '/', 2)        AS subject_id,

  rv.res_json->>'status'                                          AS status,

  -- Class (Coding, not CodeableConcept in R4)
  rv.res_json->'class'->>'code'                                   AS class_code,
  rv.res_json->'class'->>'system'                                 AS class_system,

  -- Type (first)
  rv.res_json->'type'->0->'coding'->0->>'code'                    AS type_code,
  rv.res_json->'type'->0->'coding'->0->>'system'                  AS type_system,
  rv.res_json->'type'->0->'coding'->0->>'display'                 AS type_display,

  -- Service type
  rv.res_json->'serviceType'->'coding'->0->>'code'                AS service_type_code,

  -- Period
  (rv.res_json->'period'->>'start')::timestamp                    AS period_start,
  (rv.res_json->'period'->>'end')::timestamp                      AS period_end,

  -- Service provider (Organization ref)
  SPLIT_PART(rv.res_json->'serviceProvider'->>'reference', '/', 2) AS service_provider_id,

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
  AND r.RES_TYPE = 'Encounter';

SELECT cql_studio_set_view_version('encounter_view', 1, 'Initial SQL-on-FHIR encounter view');
