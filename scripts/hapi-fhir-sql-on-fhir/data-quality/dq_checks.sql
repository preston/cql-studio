-- ============================================================
-- CQL Studio SQL-on-FHIR — Data Quality Pre-flight Checks
-- Target: HAPI FHIR JPA 6.x / 7.x on PostgreSQL 12+
--
-- Usage:
--   psql $DATABASE_URL -f data-quality/dq_checks.sql
--
-- Run AFTER install.sql and BEFORE executing CQL measure SQL queries.
-- Outputs a structured DQ report via RAISE NOTICE.
--
-- Severity levels:
--   CRITICAL — will cause measure queries to fail or produce wrong counts
--   WARNING  — data gaps that may cause undercounting; investigate before reporting
--   INFO     — resource volume counts; useful baseline for regression detection
--
-- Exit codes: script always completes (never aborts); check NOTICE output.
-- ============================================================

DO $$
DECLARE
  -- Counters
  v_critical  INTEGER := 0;
  v_warning   INTEGER := 0;

  -- Working variables
  v_count     INTEGER;
  v_pct       NUMERIC;
  v_rec       RECORD;

  -- ─── Inline helper: emit one DQ finding ──────────────────────────────────
  --   p_level    : 'CRITICAL' | 'WARNING' | 'INFO'
  --   p_resource : view name (e.g. 'patient_view')
  --   p_check    : short check name
  --   p_count    : number of affected rows (0 = pass)
  --   p_detail   : human-readable explanation
BEGIN

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  CQL Studio SQL-on-FHIR — Data Quality Report';
  RAISE NOTICE '  Run at: %', NOW();
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 1 — INFRASTRUCTURE: views installed
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 1: Installed views ────────────────────────────────────';

  FOR v_rec IN
    SELECT view_name, installed_ver, updated_at
    FROM cql_studio_view_version
    ORDER BY view_name
  LOOP
    RAISE NOTICE '  [OK]  %-40s v%s', v_rec.view_name, v_rec.installed_ver;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 2 — RESOURCE VOLUMES (INFO)
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 2: Resource volumes ───────────────────────────────────';

  SELECT COUNT(*) INTO v_count FROM patient_view;
  RAISE NOTICE '  [INFO]  patient_view              %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM encounter_view;
  RAISE NOTICE '  [INFO]  encounter_view            %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM condition_view;
  RAISE NOTICE '  [INFO]  condition_view            %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM observation_view;
  RAISE NOTICE '  [INFO]  observation_view          %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM procedure_view;
  RAISE NOTICE '  [INFO]  procedure_view            %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM medication_request_view;
  RAISE NOTICE '  [INFO]  medication_request_view   %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM diagnostic_report_view;
  RAISE NOTICE '  [INFO]  diagnostic_report_view    %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM immunization_view;
  RAISE NOTICE '  [INFO]  immunization_view         %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM coverage_view;
  RAISE NOTICE '  [INFO]  coverage_view             %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM allergy_intolerance_view;
  RAISE NOTICE '  [INFO]  allergy_intolerance_view  %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM service_request_view;
  RAISE NOTICE '  [INFO]  service_request_view      %s rows', v_count;
  SELECT COUNT(*) INTO v_count FROM value_set_expansion;
  RAISE NOTICE '  [INFO]  value_set_expansion       %s codes across %s value sets',
    v_count,
    (SELECT COUNT(DISTINCT value_set_id) FROM value_set_expansion);

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 3 — PATIENT INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 3: Patient integrity ──────────────────────────────────';

  -- CRITICAL: NULL birthDate → AgeInYearsAt() will return NULL → age filter skips patient
  SELECT COUNT(*) INTO v_count FROM patient_view WHERE birthdate IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] patient_view: % patient(s) with NULL birthdate — AgeInYearsAt() will return NULL, those patients will be excluded from all age-filtered measures', v_count;
  ELSE
    RAISE NOTICE '  [OK]  patient_view: all patients have birthdate';
  END IF;

  -- CRITICAL: future birthdate → age calculation produces negative/wrong values
  SELECT COUNT(*) INTO v_count FROM patient_view WHERE birthdate > CURRENT_DATE;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] patient_view: % patient(s) with future birthdate (%)', v_count, 'may be test data or bad ETL';
  ELSE
    RAISE NOTICE '  [OK]  patient_view: no future birthdates';
  END IF;

  -- WARNING: implausible age > 150 years
  SELECT COUNT(*) INTO v_count FROM patient_view
  WHERE birthdate < CURRENT_DATE - INTERVAL '150 years';
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] patient_view: % patient(s) with birthdate > 150 years ago — likely bad data', v_count;
  ELSE
    RAISE NOTICE '  [OK]  patient_view: no implausible birthdates (> 150 years)';
  END IF;

  -- WARNING: invalid gender codes (R4 allows: male | female | other | unknown)
  SELECT COUNT(*) INTO v_count FROM patient_view
  WHERE gender NOT IN ('male','female','other','unknown') OR gender IS NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] patient_view: % patient(s) with NULL or non-standard gender code', v_count;
  ELSE
    RAISE NOTICE '  [OK]  patient_view: all gender codes valid (male/female/other/unknown)';
  END IF;

  -- INFO: deceased patients
  SELECT COUNT(*) INTO v_count FROM patient_view WHERE deceased = TRUE;
  RAISE NOTICE '  [INFO]  patient_view: % deceased patient(s)', v_count;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 4 — ENCOUNTER INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 4: Encounter integrity ────────────────────────────────';

  -- CRITICAL: NULL period_start → During / In Period check will always fail
  SELECT COUNT(*) INTO v_count FROM encounter_view WHERE period_start IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] encounter_view: % encounter(s) with NULL period_start — timing-based filters will exclude these', v_count;
  ELSE
    RAISE NOTICE '  [OK]  encounter_view: all encounters have period_start';
  END IF;

  -- WARNING: period_end before period_start (inverted interval)
  SELECT COUNT(*) INTO v_count FROM encounter_view
  WHERE period_end IS NOT NULL AND period_start IS NOT NULL
    AND period_end < period_start;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] encounter_view: % encounter(s) with period_end < period_start (inverted interval)', v_count;
  ELSE
    RAISE NOTICE '  [OK]  encounter_view: no inverted period intervals';
  END IF;

  -- WARNING: NULL subject_id (orphaned encounter — no patient link)
  SELECT COUNT(*) INTO v_count FROM encounter_view WHERE subject_id IS NULL OR subject_id = '';
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] encounter_view: % encounter(s) with no subject reference', v_count;
  ELSE
    RAISE NOTICE '  [OK]  encounter_view: all encounters have subject reference';
  END IF;

  -- CRITICAL: encounter subject_id references a patient not in patient_view
  SELECT COUNT(*) INTO v_count
  FROM encounter_view e
  WHERE NOT EXISTS (SELECT 1 FROM patient_view p WHERE p.id = e.subject_id);
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] encounter_view: % encounter(s) reference a patient_id not found in patient_view — broken reference', v_count;
  ELSE
    RAISE NOTICE '  [OK]  encounter_view: all encounter subjects exist in patient_view';
  END IF;

  -- INFO: encounter status breakdown
  RAISE NOTICE '  [INFO]  encounter_view status distribution:';
  FOR v_rec IN
    SELECT status, COUNT(*) AS n FROM encounter_view GROUP BY status ORDER BY n DESC
  LOOP
    RAISE NOTICE '            %-25s %s', v_rec.status, v_rec.n;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 5 — CONDITION INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 5: Condition integrity ────────────────────────────────';

  -- CRITICAL: NULL code → value set lookup code IN (SELECT code FROM ...) will never match
  SELECT COUNT(*) INTO v_count FROM condition_view WHERE code IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] condition_view: % condition(s) with NULL code — value set membership checks will not match these', v_count;
  ELSE
    RAISE NOTICE '  [OK]  condition_view: all conditions have a code';
  END IF;

  -- WARNING: NULL clinical_status (e.g. can''t filter active/inactive)
  SELECT COUNT(*) INTO v_count FROM condition_view WHERE clinical_status IS NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] condition_view: % condition(s) with NULL clinical_status', v_count;
  ELSE
    RAISE NOTICE '  [OK]  condition_view: all conditions have clinical_status';
  END IF;

  -- INFO: condition clinical status breakdown
  RAISE NOTICE '  [INFO]  condition_view clinical_status distribution:';
  FOR v_rec IN
    SELECT clinical_status, COUNT(*) AS n FROM condition_view
    GROUP BY clinical_status ORDER BY n DESC
  LOOP
    RAISE NOTICE '            %-25s %s', COALESCE(v_rec.clinical_status,'(null)'), v_rec.n;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 6 — OBSERVATION INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 6: Observation integrity ─────────────────────────────';

  -- CRITICAL: NULL effective_datetime → During / timing checks fail
  SELECT COUNT(*) INTO v_count FROM observation_view
  WHERE effective_datetime IS NULL AND effective_start IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] observation_view: % observation(s) with no effective date (datetime or period) — will be excluded from all time-window checks', v_count;
  ELSE
    RAISE NOTICE '  [OK]  observation_view: all observations have an effective date';
  END IF;

  -- CRITICAL: NULL code → value set membership will never match
  SELECT COUNT(*) INTO v_count FROM observation_view WHERE code IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] observation_view: % observation(s) with NULL code', v_count;
  ELSE
    RAISE NOTICE '  [OK]  observation_view: all observations have a code';
  END IF;

  -- WARNING: status is not ''final'' or ''amended'' (may want to exclude preliminary/entered-in-error)
  SELECT COUNT(*) INTO v_count FROM observation_view
  WHERE status NOT IN ('final','amended','corrected') OR status IS NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] observation_view: % observation(s) with non-final status (preliminary/entered-in-error/unknown) — CQL measures typically filter status = ''final''', v_count;
  ELSE
    RAISE NOTICE '  [OK]  observation_view: all observations have final/amended/corrected status';
  END IF;

  -- INFO: observation category breakdown
  RAISE NOTICE '  [INFO]  observation_view category_code distribution (top 10):';
  FOR v_rec IN
    SELECT category_code, COUNT(*) AS n FROM observation_view
    GROUP BY category_code ORDER BY n DESC LIMIT 10
  LOOP
    RAISE NOTICE '            %-30s %s', COALESCE(v_rec.category_code,'(null)'), v_rec.n;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 7 — PROCEDURE INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 7: Procedure integrity ────────────────────────────────';

  -- CRITICAL: NULL performed date → timing checks will fail
  SELECT COUNT(*) INTO v_count FROM procedure_view
  WHERE performed_datetime IS NULL AND performed_start IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] procedure_view: % procedure(s) with no performed date — will be excluded from all time-window checks', v_count;
  ELSE
    RAISE NOTICE '  [OK]  procedure_view: all procedures have a performed date';
  END IF;

  -- CRITICAL: NULL code → value set membership will not match
  SELECT COUNT(*) INTO v_count FROM procedure_view WHERE code IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] procedure_view: % procedure(s) with NULL code', v_count;
  ELSE
    RAISE NOTICE '  [OK]  procedure_view: all procedures have a code';
  END IF;

  -- WARNING: procedure status not ''completed''
  SELECT COUNT(*) INTO v_count FROM procedure_view
  WHERE status NOT IN ('completed','in-progress') OR status IS NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] procedure_view: % procedure(s) with non-completed status', v_count;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 8 — MEDICATION REQUEST INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 8: MedicationRequest integrity ────────────────────────';

  -- WARNING: NULL authored_on → can''t place order in measurement period
  SELECT COUNT(*) INTO v_count FROM medication_request_view WHERE authored_on IS NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] medication_request_view: % request(s) with NULL authored_on', v_count;
  ELSE
    RAISE NOTICE '  [OK]  medication_request_view: all requests have authored_on';
  END IF;

  -- CRITICAL: NULL medication_code (can''t match value sets)
  SELECT COUNT(*) INTO v_count FROM medication_request_view WHERE medication_code IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] medication_request_view: % request(s) with NULL medication_code — may use medicationReference (not flattened)', v_count;
  ELSE
    RAISE NOTICE '  [OK]  medication_request_view: all requests have medication_code';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 9 — DIAGNOSTIC REPORT INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 9: DiagnosticReport integrity ─────────────────────────';

  SELECT COUNT(*) INTO v_count FROM diagnostic_report_view
  WHERE effective_datetime IS NULL AND issued IS NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] diagnostic_report_view: % report(s) with no date (effective or issued)', v_count;
  ELSE
    RAISE NOTICE '  [OK]  diagnostic_report_view: all reports have a date';
  END IF;

  SELECT COUNT(*) INTO v_count FROM diagnostic_report_view WHERE code IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] diagnostic_report_view: % report(s) with NULL code', v_count;
  ELSE
    RAISE NOTICE '  [OK]  diagnostic_report_view: all reports have a code';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 10 — COVERAGE INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 10: Coverage integrity ────────────────────────────────';

  SELECT COUNT(*) INTO v_count FROM coverage_view WHERE beneficiary_id IS NULL OR beneficiary_id = '';
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] coverage_view: % coverage(s) with no beneficiary_id', v_count;
  ELSE
    RAISE NOTICE '  [OK]  coverage_view: all coverages have beneficiary_id';
  END IF;

  SELECT COUNT(*) INTO v_count FROM coverage_view WHERE payor_id IS NULL AND payor_identifier IS NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] coverage_view: % coverage(s) with no payor (id or identifier)', v_count;
  ELSE
    RAISE NOTICE '  [OK]  coverage_view: all coverages have a payor';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 11 — IMMUNIZATION INTEGRITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 11: Immunization integrity ────────────────────────────';

  SELECT COUNT(*) INTO v_count FROM immunization_view WHERE vaccine_code IS NULL;
  IF v_count > 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] immunization_view: % immunization(s) with NULL vaccine_code', v_count;
  ELSE
    RAISE NOTICE '  [OK]  immunization_view: all immunizations have a vaccine_code';
  END IF;

  SELECT COUNT(*) INTO v_count FROM immunization_view WHERE occurrence_datetime IS NULL AND occurrence_string IS NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] immunization_view: % immunization(s) with no occurrence date', v_count;
  ELSE
    RAISE NOTICE '  [OK]  immunization_view: all immunizations have an occurrence';
  END IF;

  -- INFO: not-done immunizations (important for exclusion measures)
  SELECT COUNT(*) INTO v_count FROM immunization_view WHERE status = 'not-done';
  RAISE NOTICE '  [INFO]  immunization_view: % ''not-done'' immunization(s)', v_count;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 12 — VALUE SET EXPANSION COVERAGE
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 12: Value set expansion ───────────────────────────────';

  -- Overall expansion health
  SELECT COUNT(DISTINCT value_set_id) INTO v_count FROM value_set_expansion;
  RAISE NOTICE '  [INFO]  % distinct value set(s) loaded in value_set_expansion', v_count;

  IF v_count = 0 THEN
    v_critical := v_critical + 1;
    RAISE NOTICE '  [CRITICAL] value_set_expansion is empty — ALL value set membership checks will return no matches';
  END IF;

  -- Value sets with very few codes (potential partial expansion)
  RAISE NOTICE '  [INFO]  Value sets with < 5 codes (possible partial expansions):';
  FOR v_rec IN
    SELECT value_set_id, COUNT(*) AS n
    FROM value_set_expansion
    GROUP BY value_set_id
    HAVING COUNT(*) < 5
    ORDER BY n, value_set_id
    LIMIT 20
  LOOP
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] value_set_expansion: % — only % code(s)', v_rec.value_set_id, v_rec.n;
  END LOOP;

  -- Value sets with extremely large expansions (potential performance concern)
  FOR v_rec IN
    SELECT value_set_id, COUNT(*) AS n
    FROM value_set_expansion
    GROUP BY value_set_id
    HAVING COUNT(*) > 10000
    ORDER BY n DESC
  LOOP
    RAISE NOTICE '  [INFO]  value_set_expansion: % — % codes (large set, may affect query performance)', v_rec.value_set_id, v_rec.n;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 13 — DATE RANGE SANITY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 13: Date range sanity ─────────────────────────────────';

  -- Check for any encounter dates far in the future (> 1 year ahead — likely test/bad data)
  SELECT COUNT(*) INTO v_count FROM encounter_view
  WHERE period_start > CURRENT_DATE + INTERVAL '1 year';
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] encounter_view: % encounter(s) with period_start > 1 year in the future', v_count;
  ELSE
    RAISE NOTICE '  [OK]  encounter_view: no unreasonably future encounter dates';
  END IF;

  -- Check for observations dated before 1900
  SELECT COUNT(*) INTO v_count FROM observation_view
  WHERE effective_datetime < '1900-01-01'::timestamp;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] observation_view: % observation(s) with effective_datetime before 1900', v_count;
  END IF;

  -- Procedures before 1900
  SELECT COUNT(*) INTO v_count FROM procedure_view
  WHERE performed_datetime < '1900-01-01'::timestamp;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] procedure_view: % procedure(s) with performed_datetime before 1900', v_count;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SECTION 14 — CODE SYSTEM COVERAGE (spot check)
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── Section 14: Code system spot-check ────────────────────────────';

  -- Conditions: expect mostly ICD-10-CM or SNOMED
  SELECT COUNT(*) INTO v_count FROM condition_view
  WHERE code_system NOT IN (
    'http://hl7.org/fhir/sid/icd-10-cm',
    'http://hl7.org/fhir/sid/icd-9-cm',
    'http://snomed.info/sct',
    'http://www.icd10data.com/icd10pcs'
  ) AND code_system IS NOT NULL;
  IF v_count > 0 THEN
    RAISE NOTICE '  [INFO]  condition_view: % condition(s) use a non-standard code system (may be OK, verify)', v_count;
  ELSE
    RAISE NOTICE '  [OK]  condition_view: code systems look standard (ICD-10-CM / SNOMED)';
  END IF;

  -- Procedures: expect CPT, SNOMED, ICD-10-PCS, HCPCS
  SELECT COUNT(*) INTO v_count FROM procedure_view
  WHERE code_system NOT IN (
    'http://www.ama-assn.org/go/cpt',
    'http://snomed.info/sct',
    'http://www.icd10data.com/icd10pcs',
    'https://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets'
  ) AND code_system IS NOT NULL;
  IF v_count > 0 THEN
    RAISE NOTICE '  [INFO]  procedure_view: % procedure(s) use a non-CPT/SNOMED/ICD-10-PCS code system', v_count;
  ELSE
    RAISE NOTICE '  [OK]  procedure_view: code systems look standard (CPT / SNOMED / ICD-10-PCS)';
  END IF;

  -- Observations: expect LOINC for lab/vital
  SELECT COUNT(*) INTO v_count FROM observation_view
  WHERE category_code IN ('laboratory','vital-signs')
    AND code_system != 'http://loinc.org'
    AND code_system IS NOT NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] observation_view: % lab/vital-sign observation(s) NOT using LOINC — value set matching may fail if value sets expect LOINC codes', v_count;
  ELSE
    RAISE NOTICE '  [OK]  observation_view: lab/vital-sign observations use LOINC';
  END IF;

  -- Immunizations: expect CVX system
  SELECT COUNT(*) INTO v_count FROM immunization_view
  WHERE vaccine_system != 'http://hl7.org/fhir/sid/cvx'
    AND vaccine_system IS NOT NULL;
  IF v_count > 0 THEN
    v_warning := v_warning + 1;
    RAISE NOTICE '  [WARNING] immunization_view: % immunization(s) NOT using CVX vaccine codes — immunization measures use CVX by default', v_count;
  ELSE
    RAISE NOTICE '  [OK]  immunization_view: immunizations use CVX vaccine codes';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SUMMARY
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  SUMMARY';
  RAISE NOTICE '  CRITICAL issues: %  (measure results will be wrong)', v_critical;
  RAISE NOTICE '  WARNING  issues: %  (measure results may be incomplete)', v_warning;
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';

  IF v_critical > 0 THEN
    RAISE NOTICE '  ACTION REQUIRED: resolve CRITICAL issues before running measures.';
  ELSIF v_warning > 0 THEN
    RAISE NOTICE '  REVIEW WARNINGS: investigate before reporting measure results.';
  ELSE
    RAISE NOTICE '  All checks passed — data looks ready for measure execution.';
  END IF;
  RAISE NOTICE '';

END $$;
