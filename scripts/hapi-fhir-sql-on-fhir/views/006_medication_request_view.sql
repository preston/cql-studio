-- ============================================================
-- SQL-on-FHIR MedicationRequest View over HAPI FHIR JPA
-- Version: 1
-- Resource: MedicationRequest (FHIR R4)
-- ============================================================

CREATE OR REPLACE VIEW medication_request_view AS
SELECT
  r.FHIR_ID                                                             AS id,
  SPLIT_PART(rv.res_json->'subject'->>'reference', '/', 2)              AS subject_id,

  rv.res_json->>'status'                                                AS status,
  rv.res_json->>'intent'                                                AS intent,

  -- Medication — CodeableConcept (inline) or Reference
  CASE
    WHEN rv.res_json ? 'medicationCodeableConcept'
      THEN rv.res_json->'medicationCodeableConcept'->'coding'->0->>'code'
    ELSE NULL
  END                                                                   AS medication_code,

  CASE
    WHEN rv.res_json ? 'medicationCodeableConcept'
      THEN rv.res_json->'medicationCodeableConcept'->'coding'->0->>'system'
    ELSE NULL
  END                                                                   AS medication_system,

  CASE
    WHEN rv.res_json ? 'medicationCodeableConcept'
      THEN rv.res_json->'medicationCodeableConcept'->'coding'->0->>'display'
    ELSE NULL
  END                                                                   AS medication_display,

  CASE
    WHEN rv.res_json ? 'medicationReference'
      THEN SPLIT_PART(rv.res_json->'medicationReference'->>'reference', '/', 2)
    ELSE NULL
  END                                                                   AS medication_ref_id,

  -- Authored on
  CASE WHEN rv.res_json ? 'authoredOn'
    THEN (rv.res_json->>'authoredOn')::timestamp
    ELSE NULL
  END                                                                   AS authored_on,

  -- Encounter reference
  SPLIT_PART(rv.res_json->'encounter'->>'reference', '/', 2)            AS encounter_id,

  -- Requester reference
  SPLIT_PART(rv.res_json->'requester'->>'reference', '/', 2)            AS requester_id,

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
  AND r.RES_TYPE = 'MedicationRequest';

SELECT cql_studio_set_view_version('medication_request_view', 1, 'Initial SQL-on-FHIR medication_request view');
