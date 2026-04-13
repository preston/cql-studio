-- ============================================================
-- SQL-on-FHIR Patient View over HAPI FHIR JPA
-- Version: 1
-- Resource: Patient (FHIR R4)
--
-- Columns match patient_view expected by @cqframework/elm-to-sql.
-- Requires: PostgreSQL 12+, HAPI FHIR JPA 6.x / 7.x
-- ============================================================

CREATE OR REPLACE VIEW patient_view AS
SELECT
  r.FHIR_ID                                                 AS id,

  -- Demographics
  rv.res_json ->>'gender'                                   AS gender,
  (rv.res_json ->>'birthDate')::date                        AS birthdate,
  (rv.res_json ->>'active')::boolean                        AS active,

  -- Name (official, or first)
  COALESCE(
    (SELECT n->>'family'
     FROM jsonb_array_elements(rv.res_json->'name') n
     WHERE n->>'use' = 'official' LIMIT 1),
    rv.res_json->'name'->0->>'family'
  )                                                         AS name_family,

  COALESCE(
    (SELECT n->'given'->>0
     FROM jsonb_array_elements(rv.res_json->'name') n
     WHERE n->>'use' = 'official' LIMIT 1),
    rv.res_json->'name'->0->'given'->>0
  )                                                         AS name_given,

  -- Deceased
  CASE
    WHEN rv.res_json ? 'deceasedBoolean'   THEN (rv.res_json->>'deceasedBoolean')::boolean
    WHEN rv.res_json ? 'deceasedDateTime'  THEN TRUE
    ELSE FALSE
  END                                                       AS deceased,

  CASE WHEN rv.res_json ? 'deceasedDateTime'
    THEN (rv.res_json->>'deceasedDateTime')::timestamp
    ELSE NULL
  END                                                       AS deceased_datetime,

  -- US Core Race (OMB category code) — requires PostgreSQL 12+ jsonb_path_query_first
  jsonb_path_query_first(
    rv.res_json,
    '$.extension[*] ? (@.url == "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race")
     .extension[*] ? (@.url == "ombCategory").valueCoding.code'
  ) #>> '{}'                                                AS race_code,

  -- US Core Ethnicity (OMB category code)
  jsonb_path_query_first(
    rv.res_json,
    '$.extension[*] ? (@.url == "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity")
     .extension[*] ? (@.url == "ombCategory").valueCoding.code'
  ) #>> '{}'                                                AS ethnicity_code,

  r.RES_UPDATED                                             AS last_updated

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
  AND r.RES_TYPE = 'Patient';

SELECT cql_studio_set_view_version('patient_view', 1, 'Initial SQL-on-FHIR patient view');
