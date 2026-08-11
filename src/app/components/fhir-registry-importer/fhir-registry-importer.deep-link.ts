// Author: Preston Lee

/**
 * Stable query parameter names for deep-linking into the FHIR Registry Importer.
 * External systems and in-app links (e.g. Learning Examples) should use these:
 *
 *   /fhir-registry-importer?package={npmPackageId}&version={version}
 *
 * `version` is optional; when omitted, the importer resolves dist-tags.latest
 * (or the highest available semver). The short alias `/fhir-registry` redirects
 * to the same route and preserves these query parameters.
 *
 * Local `.tgz` handoff from the FHIR Uploader:
 *
 *   /fhir-registry-importer?source=local
 *
 * The tarball bytes are passed via {@link FhirPackageLocalUploadStagingService}, not query params.
 */
export const FHIR_REGISTRY_IMPORTER_QUERY_PACKAGE = 'package';
export const FHIR_REGISTRY_IMPORTER_QUERY_VERSION = 'version';
export const FHIR_REGISTRY_IMPORTER_QUERY_SOURCE = 'source';
export const FHIR_REGISTRY_IMPORTER_SOURCE_LOCAL = 'local';
