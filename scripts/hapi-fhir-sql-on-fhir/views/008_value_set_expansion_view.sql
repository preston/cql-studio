-- ============================================================
-- value_set_expansion View over HAPI FHIR JPA
-- Version: 1
--
-- The elm-to-sql transpiler generates queries like:
--   code IN (SELECT code FROM value_set_expansion WHERE value_set_id = '...')
--
-- This view satisfies that contract by reading expanded ValueSet resources
-- stored in HAPI FHIR JPA and flattening their expansion.contains[].
--
-- IMPORTANT: ValueSets must already be expanded in HAPI (either loaded
-- pre-expanded or expanded via $expand and stored). HAPI caches expansions
-- in HFJ_RES_VER for ValueSet resources tagged as expanded.
-- ============================================================

CREATE OR REPLACE VIEW value_set_expansion AS
WITH vs_resources AS (
  SELECT
    r.FHIR_ID,
    COALESCE(
      v.RES_TEXT_VC,
      CASE WHEN v.RES_ENCODING = 'JSON' THEN convert_from(v.RES_TEXT, 'UTF8') END
    )::jsonb AS res_json
  FROM HFJ_RESOURCE r
  JOIN HFJ_RES_VER v ON v.RES_ID = r.RES_ID AND v.RES_VER = r.RES_VER
  WHERE r.RES_DELETED_AT IS NULL
    AND r.RES_TYPE = 'ValueSet'
    AND COALESCE(v.RES_TEXT_VC, '') LIKE '%"expansion"%'   -- quick filter before JSON parse
),
url_extract AS (
  SELECT
    -- Prefer the canonical url field, fall back to FHIR_ID
    COALESCE(res_json->>'url', FHIR_ID)  AS value_set_id,
    res_json                              AS vs_json
  FROM vs_resources
)
SELECT
  u.value_set_id,
  (contain->>'code')                       AS code,
  (contain->>'system')                     AS system,
  (contain->>'display')                    AS display,
  (contain->>'version')                    AS version
FROM url_extract u
CROSS JOIN LATERAL jsonb_array_elements(
  u.vs_json->'expansion'->'contains'
) AS contain
WHERE (contain->>'code') IS NOT NULL;

SELECT cql_studio_set_view_version('value_set_expansion', 1,
  'ValueSet expansion view — requires pre-expanded ValueSets stored in HAPI');
