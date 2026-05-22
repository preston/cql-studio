-- ============================================================
-- SQL-on-FHIR Condition View over HAPI FHIR JPA
-- Version: 1
-- Resource: Condition (FHIR R4)
-- ============================================================

CREATE OR REPLACE VIEW condition_view AS
SELECT
  r.FHIR_ID                                                       AS id,
  SPLIT_PART(rv.res_json->'subject'->>'reference', '/', 2)        AS subject_id,

  -- Code (first coding)
  rv.res_json->'code'->'coding'->0->>'code'                       AS code,
  rv.res_json->'code'->'coding'->0->>'system'                     AS code_system,
  rv.res_json->'code'->'coding'->0->>'display'                    AS code_display,
  rv.res_json->'code'->>'text'                                    AS code_text,

  -- Clinical / Verification status
  rv.res_json->'clinicalStatus'->'coding'->0->>'code'             AS clinical_status,
  rv.res_json->'verificationStatus'->'coding'->0->>'code'         AS verification_status,

  -- Category (first)
  rv.res_json->'category'->0->'coding'->0->>'code'                AS category_code,

  -- Onset (dateTime or Period start)
  CASE
    WHEN rv.res_json ? 'onsetDateTime'
      THEN (rv.res_json->>'onsetDateTime')::timestamp
    WHEN rv.res_json ? 'onsetPeriod'
      THEN (rv.res_json->'onsetPeriod'->>'start')::timestamp
    ELSE NULL
  END                                                             AS onset_datetime,

  CASE WHEN rv.res_json ? 'onsetPeriod'
    THEN (rv.res_json->'onsetPeriod'->>'start')::timestamp
    ELSE NULL
  END                                                             AS onset_start,

  -- Abatement
  CASE
    WHEN rv.res_json ? 'abatementDateTime'
      THEN (rv.res_json->>'abatementDateTime')::timestamp
    WHEN rv.res_json ? 'abatementPeriod'
      THEN (rv.res_json->'abatementPeriod'->>'start')::timestamp
    ELSE NULL
  END                                                             AS abatement_datetime,

  -- Recorded date
  CASE WHEN rv.res_json ? 'recordedDate'
    THEN (rv.res_json->>'recordedDate')::timestamp
    ELSE NULL
  END                                                             AS recorded_date,

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
  AND r.RES_TYPE = 'Condition';

SELECT cql_studio_set_view_version('condition_view', 1, 'Initial SQL-on-FHIR condition view');
