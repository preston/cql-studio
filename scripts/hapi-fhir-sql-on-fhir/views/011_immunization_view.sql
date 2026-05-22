-- ============================================================
-- SQL-on-FHIR Immunization View over HAPI FHIR JPA
-- Version: 1
-- Resource: Immunization (FHIR R4 / US Core 6.1)
--
-- US Core 6.1 MustSupport elements included:
--   status, statusReason, vaccineCode (CVX), patient,
--   occurrence, primarySource, site, route, encounter
--
-- vaccineCode uses CVX codes (http://hl7.org/fhir/sid/cvx)
-- for vaccine type identification in immunization measures.
-- ============================================================

CREATE OR REPLACE VIEW immunization_view AS
SELECT
  r.FHIR_ID                                                             AS id,

  -- Patient reference
  SPLIT_PART(rv.res_json->'patient'->>'reference', '/', 2)              AS patient_id,

  -- Status: completed | entered-in-error | not-done
  rv.res_json->>'status'                                                AS status,

  -- Status reason (explains not-done immunizations — important for exclusions)
  rv.res_json->'statusReason'->'coding'->0->>'code'                     AS status_reason_code,
  rv.res_json->'statusReason'->'coding'->0->>'system'                   AS status_reason_system,
  rv.res_json->'statusReason'->'coding'->0->>'display'                  AS status_reason_display,

  -- Vaccine code (CVX primary system for US Core)
  rv.res_json->'vaccineCode'->'coding'->0->>'code'                      AS vaccine_code,
  rv.res_json->'vaccineCode'->'coding'->0->>'system'                    AS vaccine_system,
  rv.res_json->'vaccineCode'->'coding'->0->>'display'                   AS vaccine_display,
  rv.res_json->'vaccineCode'->>'text'                                   AS vaccine_text,

  -- Occurrence — dateTime or string (e.g. "2020" for approximate)
  CASE
    WHEN rv.res_json ? 'occurrenceDateTime'
      THEN (rv.res_json->>'occurrenceDateTime')::timestamp
    ELSE NULL
  END                                                                   AS occurrence_datetime,
  -- Preserve the string form for approximate/historical records
  CASE
    WHEN rv.res_json ? 'occurrenceString' THEN rv.res_json->>'occurrenceString'
    ELSE NULL
  END                                                                   AS occurrence_string,

  -- Data provenance
  (rv.res_json->>'primarySource')::boolean                              AS primary_source,

  -- Administration details
  rv.res_json->'site'->'coding'->0->>'code'                             AS site_code,
  rv.res_json->'route'->'coding'->0->>'code'                            AS route_code,
  rv.res_json->'doseQuantity'->>'value'                                 AS dose_quantity,
  rv.res_json->'doseQuantity'->>'unit'                                  AS dose_unit,

  -- Lot / manufacturer
  rv.res_json->>'lotNumber'                                             AS lot_number,
  (rv.res_json->>'expirationDate')::date                                AS expiration_date,
  SPLIT_PART(rv.res_json->'manufacturer'->>'reference', '/', 2)         AS manufacturer_id,

  -- Encounter reference
  SPLIT_PART(rv.res_json->'encounter'->>'reference', '/', 2)            AS encounter_id,

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
  AND r.RES_TYPE = 'Immunization';

SELECT cql_studio_set_view_version('immunization_view', 1,
  'US Core 6.1 Immunization view — CVX vaccine codes, occurrence, status/reason');
