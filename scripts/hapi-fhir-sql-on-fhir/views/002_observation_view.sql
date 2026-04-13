-- ============================================================
-- SQL-on-FHIR Observation View over HAPI FHIR JPA
-- Version: 1
-- Resource: Observation (FHIR R4)
-- ============================================================

CREATE OR REPLACE VIEW observation_view AS
SELECT
  r.FHIR_ID                                                 AS id,

  -- Subject reference (strip 'Patient/' prefix)
  SPLIT_PART(rv.res_json->'subject'->>'reference', '/', 2)  AS subject_id,

  -- Status
  rv.res_json->>'status'                                    AS status,

  -- Category (first)
  rv.res_json->'category'->0->'coding'->0->>'code'          AS category_code,
  rv.res_json->'category'->0->'coding'->0->>'system'        AS category_system,

  -- Code (first coding)
  rv.res_json->'code'->'coding'->0->>'code'                 AS code,
  rv.res_json->'code'->'coding'->0->>'system'               AS code_system,
  rv.res_json->'code'->'coding'->0->>'display'              AS code_display,
  rv.res_json->'code'->>'text'                              AS code_text,

  -- Effective (dateTime or Period)
  CASE
    WHEN rv.res_json ? 'effectiveDateTime'
      THEN (rv.res_json->>'effectiveDateTime')::timestamp
    WHEN rv.res_json ? 'effectivePeriod'
      THEN (rv.res_json->'effectivePeriod'->>'start')::timestamp
    ELSE NULL
  END                                                       AS effective_datetime,

  CASE WHEN rv.res_json ? 'effectivePeriod'
    THEN (rv.res_json->'effectivePeriod'->>'start')::timestamp
    ELSE NULL
  END                                                       AS effective_start,

  CASE WHEN rv.res_json ? 'effectivePeriod'
    THEN (rv.res_json->'effectivePeriod'->>'end')::timestamp
    ELSE NULL
  END                                                       AS effective_end,

  -- Value (Quantity, CodeableConcept, string, boolean)
  CASE WHEN rv.res_json ? 'valueQuantity'
    THEN (rv.res_json->'valueQuantity'->>'value')::decimal
    ELSE NULL
  END                                                       AS value_quantity,

  CASE WHEN rv.res_json ? 'valueQuantity'
    THEN rv.res_json->'valueQuantity'->>'unit'
    ELSE NULL
  END                                                       AS value_unit,

  CASE WHEN rv.res_json ? 'valueCodeableConcept'
    THEN rv.res_json->'valueCodeableConcept'->'coding'->0->>'code'
    ELSE NULL
  END                                                       AS value_code,

  CASE WHEN rv.res_json ? 'valueString'
    THEN rv.res_json->>'valueString'
    ELSE NULL
  END                                                       AS value_string,

  -- Encounter reference
  SPLIT_PART(rv.res_json->'encounter'->>'reference', '/', 2) AS encounter_id,

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
  AND r.RES_TYPE = 'Observation';

SELECT cql_studio_set_view_version('observation_view', 1, 'Initial SQL-on-FHIR observation view');
