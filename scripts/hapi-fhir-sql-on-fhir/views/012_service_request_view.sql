-- ============================================================
-- SQL-on-FHIR ServiceRequest View over HAPI FHIR JPA
-- Version: 1
-- Resource: ServiceRequest (FHIR R4 / US Core 6.1)
--
-- US Core 6.1 introduced explicit MustSupport for ServiceRequest,
-- used for referrals, diagnostic orders, and care orders in eCQMs.
--
-- US Core 6.1 MustSupport elements included:
--   status, intent, category, code, subject, occurrence,
--   authoredOn, requester, performer, reasonCode, encounter
-- ============================================================

CREATE OR REPLACE VIEW service_request_view AS
SELECT
  r.FHIR_ID                                                             AS id,

  -- Subject (patient)
  SPLIT_PART(rv.res_json->'subject'->>'reference', '/', 2)              AS subject_id,

  -- Workflow state
  rv.res_json->>'status'                                                AS status,
  rv.res_json->>'intent'                                                AS intent,

  -- Category — first entry (e.g. 108252007 = Laboratory procedure)
  rv.res_json->'category'->0->'coding'->0->>'code'                      AS category_code,
  rv.res_json->'category'->0->'coding'->0->>'system'                    AS category_system,
  rv.res_json->'category'->0->'coding'->0->>'display'                   AS category_display,

  -- Ordered item / procedure code
  rv.res_json->'code'->'coding'->0->>'code'                             AS code,
  rv.res_json->'code'->'coding'->0->>'system'                           AS code_system,
  rv.res_json->'code'->'coding'->0->>'display'                          AS code_display,
  rv.res_json->'code'->>'text'                                          AS code_text,

  -- Occurrence — when to perform
  CASE
    WHEN rv.res_json ? 'occurrenceDateTime'
      THEN (rv.res_json->>'occurrenceDateTime')::timestamp
    WHEN rv.res_json ? 'occurrencePeriod'
      THEN (rv.res_json->'occurrencePeriod'->>'start')::timestamp
    ELSE NULL
  END                                                                   AS occurrence_datetime,
  CASE WHEN rv.res_json ? 'occurrencePeriod'
    THEN (rv.res_json->'occurrencePeriod'->>'end')::timestamp
    ELSE NULL
  END                                                                   AS occurrence_end,

  -- Authored date (when the order was placed)
  (rv.res_json->>'authoredOn')::timestamp                               AS authored_on,

  -- Requester (ordering provider)
  SPLIT_PART(rv.res_json->'requester'->>'reference', '/', 2)            AS requester_id,

  -- Performer (first — who should fulfill the order)
  SPLIT_PART(rv.res_json->'performer'->0->>'reference', '/', 2)         AS performer_id,

  -- Reason (clinical indication — first code)
  rv.res_json->'reasonCode'->0->'coding'->0->>'code'                    AS reason_code,
  rv.res_json->'reasonCode'->0->'coding'->0->>'system'                  AS reason_system,

  -- Body site (first — for anatomical location)
  rv.res_json->'bodySite'->0->'coding'->0->>'code'                      AS body_site_code,

  -- Do not perform flag (order NOT to do something — important for exclusion logic)
  (rv.res_json->>'doNotPerform')::boolean                               AS do_not_perform,

  -- Priority (routine | urgent | asap | stat)
  rv.res_json->>'priority'                                              AS priority,

  -- Encounter context
  SPLIT_PART(rv.res_json->'encounter'->>'reference', '/', 2)            AS encounter_id,

  -- Insurance reference (first Coverage)
  SPLIT_PART(rv.res_json->'insurance'->0->>'reference', '/', 2)         AS insurance_id,

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
  AND r.RES_TYPE = 'ServiceRequest';

SELECT cql_studio_set_view_version('service_request_view', 1,
  'US Core 6.1 ServiceRequest view — referrals, orders, diagnostic requests');
