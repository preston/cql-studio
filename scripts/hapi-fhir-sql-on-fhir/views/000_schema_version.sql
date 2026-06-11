-- ============================================================
-- CQL Studio SQL-on-FHIR View Schema Version Tracking
-- Safe to run multiple times (IF NOT EXISTS).
-- Preston's server boot code (Issue #20) runs this on startup.
-- ============================================================

CREATE TABLE IF NOT EXISTS cql_studio_view_version (
  view_name       VARCHAR(100)  NOT NULL,
  installed_ver   INTEGER       NOT NULL DEFAULT 0,
  installed_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hapi_schema_ver VARCHAR(20)   NULL,        -- detected HAPI FHIR version at install time
  notes           TEXT          NULL,
  CONSTRAINT pk_cql_studio_view_version PRIMARY KEY (view_name)
);

-- Helper: upsert a version record (call after creating/replacing each view)
CREATE OR REPLACE FUNCTION cql_studio_set_view_version(
  p_view_name     VARCHAR(100),
  p_version       INTEGER,
  p_notes         TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO cql_studio_view_version (view_name, installed_ver, installed_at, updated_at, notes)
  VALUES (p_view_name, p_version, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, p_notes)
  ON CONFLICT (view_name) DO UPDATE
    SET installed_ver = p_version,
        updated_at    = CURRENT_TIMESTAMP,
        notes         = COALESCE(p_notes, cql_studio_view_version.notes);
END;
$$ LANGUAGE plpgsql;

-- Helper: check if a view needs installing/upgrading
-- Returns TRUE if install is needed (not present or version < p_min_version)
CREATE OR REPLACE FUNCTION cql_studio_needs_install(
  p_view_name    VARCHAR(100),
  p_min_version  INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  v_current INTEGER;
BEGIN
  SELECT installed_ver INTO v_current
  FROM cql_studio_view_version
  WHERE view_name = p_view_name;

  RETURN v_current IS NULL OR v_current < p_min_version;
END;
$$ LANGUAGE plpgsql;
