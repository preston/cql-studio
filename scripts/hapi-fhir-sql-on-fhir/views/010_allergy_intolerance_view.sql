-- ============================================================
-- SQL-on-FHIR AllergyIntolerance View over HAPI FHIR JPA
-- Version: 1
-- Resource: AllergyIntolerance (FHIR R4 / US Core 6.1)
--
-- US Core 6.1 MustSupport elements included:
--   clinicalStatus, verificationStatus, type, category,
--   criticality, code, patient, onset, reaction (first)
-- ============================================================

CREATE OR REPLACE VIEW allergy_intolerance_view AS
SELECT
  r.FHIR_ID                                                             AS id,

  -- Patient reference
  SPLIT_PART(rv.res_json->'patient'->>'reference', '/', 2)              AS patient_id,

  -- Status fields
  rv.res_json->'clinicalStatus'->'coding'->0->>'code'                   AS clinical_status,
  rv.res_json->'verificationStatus'->'coding'->0->>'code'               AS verification_status,

  -- Type (allergy | intolerance) and categories
  rv.res_json->>'type'                                                  AS type,
  -- First category (food | medication | environment | biologic)
  rv.res_json->'category'->>'0'                                         AS category,

  rv.res_json->>'criticality'                                           AS criticality,

  -- Substance / allergen code
  rv.res_json->'code'->'coding'->0->>'code'                             AS code,
  rv.res_json->'code'->'coding'->0->>'system'                           AS code_system,
  rv.res_json->'code'->'coding'->0->>'display'                          AS code_display,
  rv.res_json->'code'->>'text'                                          AS code_text,

  -- Onset
  CASE
    WHEN rv.res_json ? 'onsetDateTime'
      THEN (rv.res_json->>'onsetDateTime')::timestamp
    WHEN rv.res_json ? 'onsetPeriod'
      THEN (rv.res_json->'onsetPeriod'->>'start')::timestamp
    ELSE NULL
  END                                                                   AS onset_datetime,

  -- First reaction: first manifestation code + severity
  rv.res_json->'reaction'->0->'manifestation'->0->'coding'->0->>'code'   AS reaction_code,
  rv.res_json->'reaction'->0->'manifestation'->0->'coding'->0->>'system' AS reaction_system,
  rv.res_json->'reaction'->0->>'severity'                               AS reaction_severity,

  (rv.res_json->>'recordedDate')::date                                  AS recorded_date,

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
  AND r.RES_TYPE = 'AllergyIntolerance';

SELECT cql_studio_set_view_version('allergy_intolerance_view', 1,
  'US Core 6.1 AllergyIntolerance view — substance, clinical status, reaction');
