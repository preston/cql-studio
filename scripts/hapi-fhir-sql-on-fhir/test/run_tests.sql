-- ============================================================
-- CQL Studio SQL-on-FHIR — Integration Test Suite
--
-- Usage (from scripts/hapi-fhir-sql-on-fhir/ directory):
--   psql $DATABASE_URL -f test/run_tests.sql
--
-- Design:
--   • Creates an isolated 'cql_test' schema with minimal mock
--     HFJ_RESOURCE / HFJ_RES_VER tables (only the columns the
--     views use), then installs ALL view SQL files via \ir.
--   • Inserts synthetic FHIR R4 JSON covering every view column
--     and edge case (nullable paths, polymorphic types, extensions).
--   • Asserts expected column values via RAISE WARNING on failure.
--   • Always ROLLBACKs — all DDL is transactional in PostgreSQL,
--     so no schema or data persists after the script finishes.
--   • Exit: RAISE EXCEPTION if any assertion fails (psql exits 3).
--
-- Prerequisites: PostgreSQL 12+, no existing 'cql_test' schema.
-- ============================================================

BEGIN;

-- ── 1. Isolated test schema ───────────────────────────────────────────────────
DROP SCHEMA IF EXISTS cql_test CASCADE;
CREATE SCHEMA cql_test;
SET search_path TO cql_test, public;

RAISE NOTICE '── Creating mock HAPI FHIR JPA tables in cql_test schema ────────────';

-- ── 2. Mock HAPI FHIR JPA tables ─────────────────────────────────────────────
-- Only the columns accessed by the view SQL files.
CREATE TABLE HFJ_RESOURCE (
  RES_ID         BIGINT        NOT NULL,
  FHIR_ID        TEXT          NOT NULL,
  RES_TYPE       TEXT          NOT NULL,
  RES_VER        BIGINT        NOT NULL DEFAULT 1,
  RES_DELETED_AT TIMESTAMP,
  RES_UPDATED    TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE TABLE HFJ_RES_VER (
  RES_ID       BIGINT  NOT NULL,
  RES_VER      BIGINT  NOT NULL,
  RES_ENCODING TEXT    NOT NULL DEFAULT 'JSON',
  RES_TEXT_VC  TEXT,
  RES_TEXT     BYTEA
);

-- ── 3. Version tracking infrastructure (inlined — mirrors 000_schema_version) ─
CREATE TABLE cql_studio_view_version (
  view_name     TEXT      NOT NULL PRIMARY KEY,
  installed_ver INTEGER   NOT NULL,
  description   TEXT,
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION cql_studio_set_view_version(
  p_view_name TEXT, p_ver INTEGER, p_desc TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cql_studio_view_version (view_name, installed_ver, description, updated_at)
  VALUES (p_view_name, p_ver, p_desc, NOW())
  ON CONFLICT (view_name) DO UPDATE
    SET installed_ver = EXCLUDED.installed_ver,
        description   = EXCLUDED.description,
        updated_at    = NOW();
END $$;

-- ── 4. Install all views (search_path routes them into cql_test schema) ───────
RAISE NOTICE '── Installing views ──────────────────────────────────────────────────';
\ir ../views/001_patient_view.sql
\ir ../views/002_observation_view.sql
\ir ../views/003_condition_view.sql
\ir ../views/004_procedure_view.sql
\ir ../views/005_encounter_view.sql
\ir ../views/006_medication_request_view.sql
\ir ../views/007_diagnostic_report_view.sql
\ir ../views/008_value_set_expansion_view.sql
\ir ../views/009_coverage_view.sql
\ir ../views/010_allergy_intolerance_view.sql
\ir ../views/011_immunization_view.sql
\ir ../views/012_service_request_view.sql

-- ── 5. Insert synthetic test data ─────────────────────────────────────────────
RAISE NOTICE '── Inserting test fixtures ───────────────────────────────────────────';

--  Resource registry (RES_ID is explicit here since the table has no sequence)
INSERT INTO HFJ_RESOURCE (RES_ID, FHIR_ID, RES_TYPE, RES_VER, RES_UPDATED) VALUES
  ( 1, 'test-pt-001',   'Patient',            1, '2024-01-01 00:00:00'),
  ( 2, 'test-pt-002',   'Patient',            1, '2024-01-01 00:00:00'),
  ( 3, 'test-enc-001',  'Encounter',          1, '2024-03-15 00:00:00'),
  ( 4, 'test-cond-001', 'Condition',          1, '2024-01-15 00:00:00'),
  ( 5, 'test-obs-001',  'Observation',        1, '2024-03-15 00:00:00'),
  ( 6, 'test-obs-002',  'Observation',        1, '2024-03-15 00:00:00'),
  ( 7, 'test-proc-001', 'Procedure',          1, '2024-03-15 00:00:00'),
  ( 8, 'test-proc-002', 'Procedure',          1, '2024-02-01 00:00:00'),
  ( 9, 'test-med-001',  'MedicationRequest',  1, '2024-03-15 00:00:00'),
  (10, 'test-med-002',  'MedicationRequest',  1, '2024-03-15 00:00:00'),
  (11, 'test-dr-001',   'DiagnosticReport',   1, '2024-03-15 00:00:00'),
  (12, 'test-cov-001',  'Coverage',           1, '2024-01-01 00:00:00'),
  (13, 'test-ai-001',   'AllergyIntolerance', 1, '2020-03-15 00:00:00'),
  (14, 'test-imm-001',  'Immunization',       1, '2024-10-15 00:00:00'),
  (15, 'test-imm-002',  'Immunization',       1, '2024-10-15 00:00:00'),
  (16, 'test-sr-001',   'ServiceRequest',     1, '2024-03-15 00:00:00'),
  (17, 'test-vs-001',   'ValueSet',           1, '2024-01-01 00:00:00');

-- Resource content (FHIR R4 JSON covering all view columns + edge cases)
INSERT INTO HFJ_RES_VER (RES_ID, RES_VER, RES_ENCODING, RES_TEXT_VC) VALUES

-- ── Patient 001: female, active, US Core race+ethnicity, official name ────────
(1, 1, 'JSON', $JSON$
{
  "resourceType": "Patient",
  "id": "test-pt-001",
  "active": true,
  "gender": "female",
  "birthDate": "1975-06-15",
  "name": [
    { "use": "official", "family": "Testovic", "given": ["Ana"] },
    { "use": "nickname", "family": "T",        "given": ["Annabelle"] }
  ],
  "extension": [
    {
      "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race",
      "extension": [
        { "url": "ombCategory",
          "valueCoding": { "system": "urn:oid:2.16.840.1.113883.6.238",
                           "code": "2106-3", "display": "White" } }
      ]
    },
    {
      "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity",
      "extension": [
        { "url": "ombCategory",
          "valueCoding": { "system": "urn:oid:2.16.840.1.113883.6.238",
                           "code": "2186-5", "display": "Not Hispanic or Latino" } }
      ]
    }
  ]
}
$JSON$),

-- ── Patient 002: male, deceasedDateTime ───────────────────────────────────────
(2, 1, 'JSON', $JSON$
{
  "resourceType": "Patient",
  "id": "test-pt-002",
  "gender": "male",
  "birthDate": "1950-01-15",
  "deceasedDateTime": "2024-03-01T09:00:00Z"
}
$JSON$),

-- ── Encounter 001: finished, AMB, Office Visit, with period ───────────────────
(3, 1, 'JSON', $JSON$
{
  "resourceType": "Encounter",
  "id": "test-enc-001",
  "status": "finished",
  "class": { "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
              "code": "AMB", "display": "ambulatory" },
  "type": [{ "coding": [{ "system": "http://snomed.info/sct",
                           "code": "185349003",
                           "display": "Encounter for check up" }] }],
  "subject": { "reference": "Patient/test-pt-001" },
  "period": { "start": "2024-03-15T10:00:00Z", "end": "2024-03-15T11:00:00Z" },
  "serviceProvider": { "reference": "Organization/test-org-001" }
}
$JSON$),

-- ── Condition 001: active, confirmed, ICD-10 Z12.11, problem-list-item ────────
(4, 1, 'JSON', $JSON$
{
  "resourceType": "Condition",
  "id": "test-cond-001",
  "clinicalStatus": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                                    "code": "active" }] },
  "verificationStatus": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                                        "code": "confirmed" }] },
  "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/condition-category",
                                "code": "problem-list-item" }] }],
  "code": {
    "coding": [{ "system": "http://hl7.org/fhir/sid/icd-10-cm",
                  "code": "Z12.11",
                  "display": "Encounter for screening for malignant neoplasm of colon" }],
    "text": "Colorectal cancer screening"
  },
  "subject": { "reference": "Patient/test-pt-001" },
  "encounter": { "reference": "Encounter/test-enc-001" },
  "onsetDateTime": "2024-01-10",
  "recordedDate": "2024-01-15"
}
$JSON$),

-- ── Observation 001: final lab, effectiveDateTime, valueCodeableConcept ───────
(5, 1, 'JSON', $JSON$
{
  "resourceType": "Observation",
  "id": "test-obs-001",
  "status": "final",
  "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                "code": "laboratory" }] }],
  "code": { "coding": [{ "system": "http://loinc.org",
                          "code": "14563-1",
                          "display": "Hemoglobin [Mass/volume] in Arterial blood" }],
             "text": "Hemoglobin" },
  "subject": { "reference": "Patient/test-pt-001" },
  "encounter": { "reference": "Encounter/test-enc-001" },
  "effectiveDateTime": "2024-03-15T10:30:00Z",
  "valueCodeableConcept": { "coding": [{ "system": "http://snomed.info/sct",
                                          "code": "260373001",
                                          "display": "Detected" }] }
}
$JSON$),

-- ── Observation 002: vital-signs, effectivePeriod, valueQuantity ──────────────
(6, 1, 'JSON', $JSON$
{
  "resourceType": "Observation",
  "id": "test-obs-002",
  "status": "final",
  "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                "code": "vital-signs" }] }],
  "code": { "coding": [{ "system": "http://loinc.org",
                          "code": "39156-5",
                          "display": "Body mass index (BMI) [Ratio]" }] },
  "subject": { "reference": "Patient/test-pt-001" },
  "effectivePeriod": { "start": "2024-03-15T10:00:00Z", "end": "2024-03-15T10:05:00Z" },
  "valueQuantity": { "value": 24.5, "unit": "kg/m2",
                      "system": "http://unitsofmeasure.org", "code": "kg/m2" }
}
$JSON$),

-- ── Procedure 001: completed, CPT, performedDateTime ─────────────────────────
(7, 1, 'JSON', $JSON$
{
  "resourceType": "Procedure",
  "id": "test-proc-001",
  "status": "completed",
  "category": { "coding": [{ "system": "http://snomed.info/sct",
                               "code": "103693007", "display": "Diagnostic procedure" }] },
  "code": { "coding": [{ "system": "http://www.ama-assn.org/go/cpt",
                          "code": "45378",
                          "display": "Colonoscopy, flexible; diagnostic" }],
             "text": "Colonoscopy" },
  "subject": { "reference": "Patient/test-pt-001" },
  "encounter": { "reference": "Encounter/test-enc-001" },
  "performedDateTime": "2024-03-15T10:30:00Z"
}
$JSON$),

-- ── Procedure 002: completed, SNOMED, performedPeriod ────────────────────────
(8, 1, 'JSON', $JSON$
{
  "resourceType": "Procedure",
  "id": "test-proc-002",
  "status": "completed",
  "code": { "coding": [{ "system": "http://snomed.info/sct",
                          "code": "80146002", "display": "Appendectomy" }] },
  "subject": { "reference": "Patient/test-pt-001" },
  "performedPeriod": { "start": "2024-02-01T08:00:00Z", "end": "2024-02-01T09:30:00Z" }
}
$JSON$),

-- ── MedicationRequest 001: medicationCodeableConcept (inline code) ────────────
(9, 1, 'JSON', $JSON$
{
  "resourceType": "MedicationRequest",
  "id": "test-med-001",
  "status": "active",
  "intent": "order",
  "medicationCodeableConcept": {
    "coding": [{ "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
                  "code": "1049502",
                  "display": "12 HR Oxycodone Hydrochloride 80 MG Extended Release Oral Tablet" }]
  },
  "subject": { "reference": "Patient/test-pt-001" },
  "encounter": { "reference": "Encounter/test-enc-001" },
  "authoredOn": "2024-03-15",
  "requester": { "reference": "Practitioner/test-prac-001" }
}
$JSON$),

-- ── MedicationRequest 002: medicationReference (external Medication resource) ─
(10, 1, 'JSON', $JSON$
{
  "resourceType": "MedicationRequest",
  "id": "test-med-002",
  "status": "active",
  "intent": "order",
  "medicationReference": { "reference": "Medication/test-medication-001" },
  "subject": { "reference": "Patient/test-pt-001" },
  "authoredOn": "2024-03-16"
}
$JSON$),

-- ── DiagnosticReport 001: final lab, effectiveDateTime ───────────────────────
(11, 1, 'JSON', $JSON$
{
  "resourceType": "DiagnosticReport",
  "id": "test-dr-001",
  "status": "final",
  "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                                "code": "LAB", "display": "Laboratory" }] }],
  "code": { "coding": [{ "system": "http://loinc.org",
                          "code": "58410-2",
                          "display": "Complete blood count panel - Blood by Automated count" }] },
  "subject": { "reference": "Patient/test-pt-001" },
  "encounter": { "reference": "Encounter/test-enc-001" },
  "effectiveDateTime": "2024-03-15T11:00:00Z",
  "issued": "2024-03-15T12:00:00.000Z"
}
$JSON$),

-- ── Coverage 001: active, SUBSIDIZ type, self relationship, plan class ────────
(12, 1, 'JSON', $JSON$
{
  "resourceType": "Coverage",
  "id": "test-cov-001",
  "status": "active",
  "type": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                          "code": "SUBSIDIZ", "display": "Subsidized" }] },
  "subscriber": { "reference": "Patient/test-pt-001" },
  "subscriberId": "1EG4-TE5-MK72",
  "beneficiary": { "reference": "Patient/test-pt-001" },
  "relationship": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
                                  "code": "self", "display": "Self" }] },
  "period": { "start": "2024-01-01", "end": "2024-12-31" },
  "payor": [{ "identifier": { "system": "http://hl7.org/fhir/sid/us-npi",
                                "value": "1234567890" } }],
  "class": [{ "type": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                                      "code": "plan", "display": "Plan" }] },
               "value": "B37FC",
               "name": "Full Coverage Plan" }],
  "order": 1
}
$JSON$),

-- ── AllergyIntolerance 001: active, allergy, medication, high, severe reaction ─
(13, 1, 'JSON', $JSON$
{
  "resourceType": "AllergyIntolerance",
  "id": "test-ai-001",
  "clinicalStatus": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
                                    "code": "active" }] },
  "verificationStatus": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                                        "code": "confirmed" }] },
  "type": "allergy",
  "category": ["medication"],
  "criticality": "high",
  "code": { "coding": [{ "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
                          "code": "7980", "display": "Penicillin" }],
             "text": "Penicillin" },
  "patient": { "reference": "Patient/test-pt-001" },
  "onsetDateTime": "2020-03-01",
  "reaction": [{
    "manifestation": [{ "coding": [{ "system": "http://snomed.info/sct",
                                      "code": "271807003",
                                      "display": "Eruption of skin" }] }],
    "severity": "severe"
  }],
  "recordedDate": "2020-03-15"
}
$JSON$),

-- ── Immunization 001: completed, CVX 140, occurrenceDateTime, lot, site ───────
(14, 1, 'JSON', $JSON$
{
  "resourceType": "Immunization",
  "id": "test-imm-001",
  "status": "completed",
  "vaccineCode": { "coding": [{ "system": "http://hl7.org/fhir/sid/cvx",
                                  "code": "140",
                                  "display": "Influenza, seasonal, injectable, preservative free" }] },
  "patient": { "reference": "Patient/test-pt-001" },
  "encounter": { "reference": "Encounter/test-enc-001" },
  "occurrenceDateTime": "2024-10-15T10:00:00Z",
  "primarySource": true,
  "lotNumber": "LOT2024A",
  "expirationDate": "2025-03-01",
  "site": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v3-ActSite",
                          "code": "LA", "display": "left arm" }] },
  "route": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration",
                           "code": "IM", "display": "Injection, intramuscular" }] },
  "doseQuantity": { "value": 0.5, "unit": "mL" }
}
$JSON$),

-- ── Immunization 002: not-done, statusReason, occurrenceString ────────────────
(15, 1, 'JSON', $JSON$
{
  "resourceType": "Immunization",
  "id": "test-imm-002",
  "status": "not-done",
  "statusReason": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v3-ActReason",
                                  "code": "MEDPREC",
                                  "display": "Medical Precaution" }] },
  "vaccineCode": { "coding": [{ "system": "http://hl7.org/fhir/sid/cvx",
                                  "code": "140",
                                  "display": "Influenza vaccine" }] },
  "patient": { "reference": "Patient/test-pt-001" },
  "occurrenceString": "October 2024",
  "primarySource": false
}
$JSON$),

-- ── ServiceRequest 001: active order, colonoscopy, US Core 6.1 fields ─────────
(16, 1, 'JSON', $JSON$
{
  "resourceType": "ServiceRequest",
  "id": "test-sr-001",
  "status": "active",
  "intent": "order",
  "category": [{ "coding": [{ "system": "http://snomed.info/sct",
                                "code": "108252007",
                                "display": "Laboratory procedure" }] }],
  "code": { "coding": [{ "system": "http://www.ama-assn.org/go/cpt",
                          "code": "45378",
                          "display": "Colonoscopy, flexible; diagnostic" }],
             "text": "Colonoscopy" },
  "subject": { "reference": "Patient/test-pt-001" },
  "encounter": { "reference": "Encounter/test-enc-001" },
  "occurrenceDateTime": "2024-04-01T09:00:00Z",
  "authoredOn": "2024-03-15T10:00:00Z",
  "requester": { "reference": "Practitioner/test-prac-001" },
  "performer": [{ "reference": "Practitioner/test-prac-001" }],
  "reasonCode": [{ "coding": [{ "system": "http://snomed.info/sct",
                                  "code": "44273001",
                                  "display": "Screening for cancer" }] }],
  "doNotPerform": false,
  "priority": "routine",
  "insurance": [{ "reference": "Coverage/test-cov-001" }]
}
$JSON$),

-- ── ValueSet 001: pre-expanded, 3 CPT colonoscopy codes ──────────────────────
(17, 1, 'JSON', $JSON$
{
  "resourceType": "ValueSet",
  "id": "test-vs-001",
  "url": "http://example.org/test/colonoscopy",
  "expansion": {
    "contains": [
      { "system": "http://www.ama-assn.org/go/cpt", "code": "45378",
        "display": "Colonoscopy, flexible; diagnostic" },
      { "system": "http://www.ama-assn.org/go/cpt", "code": "44388",
        "display": "Colonoscopy through stoma; diagnostic" },
      { "system": "http://www.ama-assn.org/go/cpt", "code": "44393",
        "display": "Colonoscopy with ablation" }
    ]
  }
}
$JSON$);

-- ── 6. Assertions ─────────────────────────────────────────────────────────────
RAISE NOTICE '── Running view assertions ───────────────────────────────────────────';

DO $$
DECLARE
  v_pass    INTEGER := 0;
  v_fail    INTEGER := 0;
  v_txt     TEXT;
  v_num     NUMERIC;
  v_bool    BOOLEAN;
  v_date    DATE;
  v_ts      TIMESTAMP;

  -- Helper: assert TEXT equality
  PROCEDURE assert_eq(p_test TEXT, p_got TEXT, p_want TEXT) AS $$
  BEGIN
    IF p_got IS DISTINCT FROM p_want THEN
      RAISE WARNING '[FAIL] %: expected %, got %', p_test, COALESCE(p_want,'(null)'), COALESCE(p_got,'(null)');
      v_fail := v_fail + 1;
    ELSE
      RAISE NOTICE '  [PASS] %', p_test;
      v_pass := v_pass + 1;
    END IF;
  END $$;

  PROCEDURE assert_true(p_test TEXT, p_val BOOLEAN) AS $$
  BEGIN
    IF NOT COALESCE(p_val, FALSE) THEN
      RAISE WARNING '[FAIL] %', p_test;
      v_fail := v_fail + 1;
    ELSE
      RAISE NOTICE '  [PASS] %', p_test;
      v_pass := v_pass + 1;
    END IF;
  END $$;

  PROCEDURE assert_null(p_test TEXT, p_val TEXT) AS $$
  BEGIN
    IF p_val IS NOT NULL THEN
      RAISE WARNING '[FAIL] % — expected NULL, got %', p_test, p_val;
      v_fail := v_fail + 1;
    ELSE
      RAISE NOTICE '  [PASS] %', p_test;
      v_pass := v_pass + 1;
    END IF;
  END $$;

BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '┌─ patient_view ─────────────────────────────────────────────────';

  -- Demographics
  SELECT gender INTO v_txt FROM patient_view WHERE id = 'test-pt-001';
  CALL assert_eq('patient_view.gender',     v_txt,  'female');
  SELECT birthdate::text INTO v_txt FROM patient_view WHERE id = 'test-pt-001';
  CALL assert_eq('patient_view.birthdate',  v_txt,  '1975-06-15');
  SELECT active::text INTO v_txt FROM patient_view WHERE id = 'test-pt-001';
  CALL assert_eq('patient_view.active',     v_txt,  'true');
  -- Official name (should prefer use='official')
  SELECT name_family INTO v_txt FROM patient_view WHERE id = 'test-pt-001';
  CALL assert_eq('patient_view.name_family (official preferred)', v_txt, 'Testovic');
  SELECT name_given  INTO v_txt FROM patient_view WHERE id = 'test-pt-001';
  CALL assert_eq('patient_view.name_given',  v_txt,  'Ana');
  -- US Core extensions
  SELECT race_code INTO v_txt FROM patient_view WHERE id = 'test-pt-001';
  CALL assert_eq('patient_view.race_code',       v_txt,  '2106-3');
  SELECT ethnicity_code INTO v_txt FROM patient_view WHERE id = 'test-pt-001';
  CALL assert_eq('patient_view.ethnicity_code',  v_txt,  '2186-5');
  -- Deceased
  SELECT deceased::text INTO v_txt FROM patient_view WHERE id = 'test-pt-001';
  CALL assert_eq('patient_view.deceased (alive → false)',  v_txt, 'false');
  SELECT deceased::text INTO v_txt FROM patient_view WHERE id = 'test-pt-002';
  CALL assert_eq('patient_view.deceased (deceasedDateTime → true)', v_txt, 'true');
  SELECT deceased_datetime::date::text INTO v_txt FROM patient_view WHERE id = 'test-pt-002';
  CALL assert_eq('patient_view.deceased_datetime', v_txt, '2024-03-01');

  RAISE NOTICE '├─ encounter_view ───────────────────────────────────────────────';
  SELECT status INTO v_txt FROM encounter_view WHERE id = 'test-enc-001';
  CALL assert_eq('encounter_view.status',       v_txt, 'finished');
  SELECT class_code INTO v_txt FROM encounter_view WHERE id = 'test-enc-001';
  CALL assert_eq('encounter_view.class_code',   v_txt, 'AMB');
  SELECT type_code INTO v_txt FROM encounter_view WHERE id = 'test-enc-001';
  CALL assert_eq('encounter_view.type_code',    v_txt, '185349003');
  SELECT subject_id INTO v_txt FROM encounter_view WHERE id = 'test-enc-001';
  CALL assert_eq('encounter_view.subject_id',   v_txt, 'test-pt-001');
  SELECT period_start::date::text INTO v_txt FROM encounter_view WHERE id = 'test-enc-001';
  CALL assert_eq('encounter_view.period_start', v_txt, '2024-03-15');
  SELECT period_end::date::text INTO v_txt FROM encounter_view WHERE id = 'test-enc-001';
  CALL assert_eq('encounter_view.period_end',   v_txt, '2024-03-15');
  SELECT service_provider_id INTO v_txt FROM encounter_view WHERE id = 'test-enc-001';
  CALL assert_eq('encounter_view.service_provider_id', v_txt, 'test-org-001');

  RAISE NOTICE '├─ condition_view ───────────────────────────────────────────────';
  SELECT clinical_status INTO v_txt FROM condition_view WHERE id = 'test-cond-001';
  CALL assert_eq('condition_view.clinical_status',     v_txt, 'active');
  SELECT verification_status INTO v_txt FROM condition_view WHERE id = 'test-cond-001';
  CALL assert_eq('condition_view.verification_status', v_txt, 'confirmed');
  SELECT code INTO v_txt FROM condition_view WHERE id = 'test-cond-001';
  CALL assert_eq('condition_view.code',                v_txt, 'Z12.11');
  SELECT code_system INTO v_txt FROM condition_view WHERE id = 'test-cond-001';
  CALL assert_eq('condition_view.code_system',         v_txt, 'http://hl7.org/fhir/sid/icd-10-cm');
  SELECT category_code INTO v_txt FROM condition_view WHERE id = 'test-cond-001';
  CALL assert_eq('condition_view.category_code',       v_txt, 'problem-list-item');
  SELECT onset_datetime::date::text INTO v_txt FROM condition_view WHERE id = 'test-cond-001';
  CALL assert_eq('condition_view.onset_datetime',      v_txt, '2024-01-10');
  SELECT encounter_id INTO v_txt FROM condition_view WHERE id = 'test-cond-001';
  CALL assert_eq('condition_view.encounter_id',        v_txt, 'test-enc-001');

  RAISE NOTICE '├─ observation_view ─────────────────────────────────────────────';
  -- obs-001: effectiveDateTime, valueCodeableConcept
  SELECT status INTO v_txt FROM observation_view WHERE id = 'test-obs-001';
  CALL assert_eq('observation_view.status',             v_txt, 'final');
  SELECT category_code INTO v_txt FROM observation_view WHERE id = 'test-obs-001';
  CALL assert_eq('observation_view.category_code',      v_txt, 'laboratory');
  SELECT code INTO v_txt FROM observation_view WHERE id = 'test-obs-001';
  CALL assert_eq('observation_view.code',               v_txt, '14563-1');
  SELECT effective_datetime::date::text INTO v_txt FROM observation_view WHERE id = 'test-obs-001';
  CALL assert_eq('observation_view.effective_datetime (dateTime)', v_txt, '2024-03-15');
  SELECT value_code INTO v_txt FROM observation_view WHERE id = 'test-obs-001';
  CALL assert_eq('observation_view.value_code',         v_txt, '260373001');
  -- obs-002: effectivePeriod, valueQuantity
  SELECT effective_datetime::date::text INTO v_txt FROM observation_view WHERE id = 'test-obs-002';
  CALL assert_eq('observation_view.effective_datetime (period→start)', v_txt, '2024-03-15');
  SELECT effective_start::date::text INTO v_txt FROM observation_view WHERE id = 'test-obs-002';
  CALL assert_eq('observation_view.effective_start',    v_txt, '2024-03-15');
  SELECT value_quantity::text INTO v_txt FROM observation_view WHERE id = 'test-obs-002';
  CALL assert_eq('observation_view.value_quantity',     v_txt, '24.5');
  SELECT value_unit INTO v_txt FROM observation_view WHERE id = 'test-obs-002';
  CALL assert_eq('observation_view.value_unit',         v_txt, 'kg/m2');
  -- obs-001: value_quantity must be NULL (no valueQuantity in that resource)
  SELECT value_quantity::text INTO v_txt FROM observation_view WHERE id = 'test-obs-001';
  CALL assert_null('observation_view.value_quantity NULL for non-Quantity obs', v_txt);

  RAISE NOTICE '├─ procedure_view ───────────────────────────────────────────────';
  -- proc-001: performedDateTime
  SELECT status INTO v_txt FROM procedure_view WHERE id = 'test-proc-001';
  CALL assert_eq('procedure_view.status',                      v_txt, 'completed');
  SELECT code INTO v_txt FROM procedure_view WHERE id = 'test-proc-001';
  CALL assert_eq('procedure_view.code',                        v_txt, '45378');
  SELECT performed_datetime::date::text INTO v_txt FROM procedure_view WHERE id = 'test-proc-001';
  CALL assert_eq('procedure_view.performed_datetime (dateTime)', v_txt, '2024-03-15');
  SELECT category_code INTO v_txt FROM procedure_view WHERE id = 'test-proc-001';
  CALL assert_eq('procedure_view.category_code',               v_txt, '103693007');
  SELECT encounter_id INTO v_txt FROM procedure_view WHERE id = 'test-proc-001';
  CALL assert_eq('procedure_view.encounter_id',                v_txt, 'test-enc-001');
  -- proc-002: performedPeriod
  SELECT performed_datetime::date::text INTO v_txt FROM procedure_view WHERE id = 'test-proc-002';
  CALL assert_eq('procedure_view.performed_datetime (period→start)', v_txt, '2024-02-01');
  SELECT performed_start::date::text INTO v_txt FROM procedure_view WHERE id = 'test-proc-002';
  CALL assert_eq('procedure_view.performed_start',   v_txt, '2024-02-01');
  SELECT performed_end::date::text INTO v_txt FROM procedure_view WHERE id = 'test-proc-002';
  CALL assert_eq('procedure_view.performed_end',     v_txt, '2024-02-01');

  RAISE NOTICE '├─ medication_request_view ──────────────────────────────────────';
  -- med-001: medicationCodeableConcept
  SELECT status INTO v_txt FROM medication_request_view WHERE id = 'test-med-001';
  CALL assert_eq('medication_request_view.status',           v_txt, 'active');
  SELECT medication_code INTO v_txt FROM medication_request_view WHERE id = 'test-med-001';
  CALL assert_eq('medication_request_view.medication_code',  v_txt, '1049502');
  SELECT authored_on::date::text INTO v_txt FROM medication_request_view WHERE id = 'test-med-001';
  CALL assert_eq('medication_request_view.authored_on',      v_txt, '2024-03-15');
  SELECT encounter_id INTO v_txt FROM medication_request_view WHERE id = 'test-med-001';
  CALL assert_eq('medication_request_view.encounter_id',     v_txt, 'test-enc-001');
  -- med-002: medicationReference (code should be NULL, ref_id populated)
  SELECT medication_code INTO v_txt FROM medication_request_view WHERE id = 'test-med-002';
  CALL assert_null('medication_request_view.medication_code NULL for medicationReference', v_txt);
  SELECT medication_ref_id INTO v_txt FROM medication_request_view WHERE id = 'test-med-002';
  CALL assert_eq('medication_request_view.medication_ref_id', v_txt, 'test-medication-001');

  RAISE NOTICE '├─ diagnostic_report_view ──────────────────────────────────────';
  SELECT status INTO v_txt FROM diagnostic_report_view WHERE id = 'test-dr-001';
  CALL assert_eq('diagnostic_report_view.status',            v_txt, 'final');
  SELECT code INTO v_txt FROM diagnostic_report_view WHERE id = 'test-dr-001';
  CALL assert_eq('diagnostic_report_view.code',              v_txt, '58410-2');
  SELECT category_code INTO v_txt FROM diagnostic_report_view WHERE id = 'test-dr-001';
  CALL assert_eq('diagnostic_report_view.category_code',     v_txt, 'LAB');
  SELECT effective_datetime::date::text INTO v_txt FROM diagnostic_report_view WHERE id = 'test-dr-001';
  CALL assert_eq('diagnostic_report_view.effective_datetime', v_txt, '2024-03-15');
  SELECT issued::date::text INTO v_txt FROM diagnostic_report_view WHERE id = 'test-dr-001';
  CALL assert_eq('diagnostic_report_view.issued',            v_txt, '2024-03-15');
  SELECT encounter_id INTO v_txt FROM diagnostic_report_view WHERE id = 'test-dr-001';
  CALL assert_eq('diagnostic_report_view.encounter_id',      v_txt, 'test-enc-001');

  RAISE NOTICE '├─ coverage_view ────────────────────────────────────────────────';
  SELECT status INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.status',              v_txt, 'active');
  SELECT beneficiary_id INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.beneficiary_id',      v_txt, 'test-pt-001');
  SELECT type_code INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.type_code',           v_txt, 'SUBSIDIZ');
  SELECT relationship_code INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.relationship_code',   v_txt, 'self');
  SELECT subscriber_id_value INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.subscriber_id_value', v_txt, '1EG4-TE5-MK72');
  SELECT period_start::text INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.period_start',        v_txt, '2024-01-01');
  SELECT period_end::text INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.period_end',          v_txt, '2024-12-31');
  SELECT class_type_code INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.class_type_code',     v_txt, 'plan');
  SELECT class_value INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.class_value',         v_txt, 'B37FC');
  SELECT class_name INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.class_name',          v_txt, 'Full Coverage Plan');
  SELECT priority_order::text INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.priority_order',      v_txt, '1');
  -- payor via identifier (no reference ID)
  SELECT payor_identifier INTO v_txt FROM coverage_view WHERE id = 'test-cov-001';
  CALL assert_eq('coverage_view.payor_identifier',    v_txt, '1234567890');

  RAISE NOTICE '├─ allergy_intolerance_view ─────────────────────────────────────';
  SELECT clinical_status INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.clinical_status',     v_txt, 'active');
  SELECT verification_status INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.verification_status', v_txt, 'confirmed');
  SELECT type INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.type',                v_txt, 'allergy');
  SELECT criticality INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.criticality',         v_txt, 'high');
  SELECT code INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.code',                v_txt, '7980');
  SELECT patient_id INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.patient_id',          v_txt, 'test-pt-001');
  SELECT onset_datetime::date::text INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.onset_datetime',      v_txt, '2020-03-01');
  SELECT reaction_code INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.reaction_code',       v_txt, '271807003');
  SELECT reaction_severity INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.reaction_severity',   v_txt, 'severe');
  SELECT recorded_date::text INTO v_txt FROM allergy_intolerance_view WHERE id = 'test-ai-001';
  CALL assert_eq('allergy_intolerance_view.recorded_date',       v_txt, '2020-03-15');

  RAISE NOTICE '├─ immunization_view ────────────────────────────────────────────';
  -- imm-001: completed, CVX, occurrenceDateTime, lot
  SELECT status INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.status (completed)',           v_txt, 'completed');
  SELECT vaccine_code INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.vaccine_code',                 v_txt, '140');
  SELECT vaccine_system INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.vaccine_system (CVX)',         v_txt, 'http://hl7.org/fhir/sid/cvx');
  SELECT occurrence_datetime::date::text INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.occurrence_datetime',          v_txt, '2024-10-15');
  SELECT primary_source::text INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.primary_source',               v_txt, 'true');
  SELECT lot_number INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.lot_number',                   v_txt, 'LOT2024A');
  SELECT site_code INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.site_code',                    v_txt, 'LA');
  SELECT route_code INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.route_code',                   v_txt, 'IM');
  SELECT encounter_id INTO v_txt FROM immunization_view WHERE id = 'test-imm-001';
  CALL assert_eq('immunization_view.encounter_id',                 v_txt, 'test-enc-001');
  -- imm-002: not-done, statusReason, occurrenceString
  SELECT status INTO v_txt FROM immunization_view WHERE id = 'test-imm-002';
  CALL assert_eq('immunization_view.status (not-done)',            v_txt, 'not-done');
  SELECT status_reason_code INTO v_txt FROM immunization_view WHERE id = 'test-imm-002';
  CALL assert_eq('immunization_view.status_reason_code',           v_txt, 'MEDPREC');
  SELECT occurrence_string INTO v_txt FROM immunization_view WHERE id = 'test-imm-002';
  CALL assert_eq('immunization_view.occurrence_string',            v_txt, 'October 2024');
  SELECT occurrence_datetime::text INTO v_txt FROM immunization_view WHERE id = 'test-imm-002';
  CALL assert_null('immunization_view.occurrence_datetime NULL for occurrenceString', v_txt);

  RAISE NOTICE '├─ service_request_view (US Core 6.1) ───────────────────────────';
  SELECT status INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.status',         v_txt, 'active');
  SELECT intent INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.intent',         v_txt, 'order');
  SELECT code INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.code',           v_txt, '45378');
  SELECT code_system INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.code_system',    v_txt, 'http://www.ama-assn.org/go/cpt');
  SELECT category_code INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.category_code',  v_txt, '108252007');
  SELECT subject_id INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.subject_id',     v_txt, 'test-pt-001');
  SELECT encounter_id INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.encounter_id',   v_txt, 'test-enc-001');
  SELECT occurrence_datetime::date::text INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.occurrence_datetime', v_txt, '2024-04-01');
  SELECT authored_on::date::text INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.authored_on',    v_txt, '2024-03-15');
  SELECT reason_code INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.reason_code',    v_txt, '44273001');
  SELECT do_not_perform::text INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.do_not_perform', v_txt, 'false');
  SELECT priority INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.priority',       v_txt, 'routine');
  SELECT insurance_id INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.insurance_id',   v_txt, 'test-cov-001');
  SELECT performer_id INTO v_txt FROM service_request_view WHERE id = 'test-sr-001';
  CALL assert_eq('service_request_view.performer_id',   v_txt, 'test-prac-001');

  RAISE NOTICE '├─ value_set_expansion ──────────────────────────────────────────';
  SELECT COUNT(*)::text INTO v_txt FROM value_set_expansion
  WHERE value_set_id = 'http://example.org/test/colonoscopy';
  CALL assert_eq('value_set_expansion: 3 codes for test VS', v_txt, '3');
  SELECT code INTO v_txt FROM value_set_expansion
  WHERE value_set_id = 'http://example.org/test/colonoscopy' AND code = '45378';
  CALL assert_eq('value_set_expansion: CPT 45378 present', v_txt, '45378');
  -- Verify the URL comes from the ValueSet.url field (not FHIR_ID)
  SELECT COUNT(DISTINCT value_set_id)::text INTO v_txt FROM value_set_expansion
  WHERE value_set_id = 'http://example.org/test/colonoscopy';
  CALL assert_eq('value_set_expansion: canonical URL used as value_set_id', v_txt, '1');

  RAISE NOTICE '├─ deleted resource excluded ────────────────────────────────────';
  -- Insert a deleted patient; it must NOT appear in patient_view
  INSERT INTO HFJ_RESOURCE (RES_ID, FHIR_ID, RES_TYPE, RES_VER, RES_UPDATED, RES_DELETED_AT)
  VALUES (99, 'test-pt-deleted', 'Patient', 1, NOW(), NOW());
  INSERT INTO HFJ_RES_VER (RES_ID, RES_VER, RES_ENCODING, RES_TEXT_VC)
  VALUES (99, 1, 'JSON', '{"resourceType":"Patient","id":"test-pt-deleted","gender":"female","birthDate":"1990-01-01"}');
  SELECT COUNT(*)::text INTO v_txt FROM patient_view WHERE id = 'test-pt-deleted';
  CALL assert_eq('patient_view: deleted resource excluded (count=0)', v_txt, '0');

  RAISE NOTICE '└─ Summary ──────────────────────────────────────────────────────';
  RAISE NOTICE '';
  RAISE NOTICE '  Passed: %   Failed: %   Total: %', v_pass, v_fail, v_pass + v_fail;
  RAISE NOTICE '';

  IF v_fail > 0 THEN
    RAISE EXCEPTION '% test(s) FAILED — see WARNING messages above', v_fail;
  END IF;

END $$;

-- ── 7. Teardown ───────────────────────────────────────────────────────────────
-- ROLLBACK undoes the CREATE SCHEMA, all tables, views, and inserted data.
-- No persistent changes are made to the database.
ROLLBACK;

\echo 'All SQL view tests passed. Schema rolled back — no persistent changes.'
