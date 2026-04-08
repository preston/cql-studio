// Author: Preston Lee

/** Catalog row from GET {registry}/catalog?name= */
export interface FhirPackageCatalogEntry {
  Name: string;
  Description: string | null;
  FhirVersion: string;
}

/** NPM manifest for a FHIR package (subset of fields we use). */
export interface FhirNpmPackageManifest {
  _id?: string;
  name: string;
  description?: string;
  'dist-tags'?: { latest?: string; [tag: string]: string | undefined };
  versions: Record<
    string,
    {
      name?: string;
      version?: string;
      description?: string;
      dist?: { tarball?: string; shasum?: string };
      fhirVersion?: string;
      url?: string;
    }
  >;
}

/** FHIR package.json inside the tarball (NPM + FHIR fields). */
export interface FhirPackageJson {
  name?: string;
  version?: string;
  type?: string;
  canonical?: string;
  title?: string;
  description?: string;
  fhirVersions?: string[];
  'fhir-version-list'?: string[];
  dependencies?: Record<string, string>;
  jurisdiction?: string;
  url?: string;
  license?: string;
  author?: string;
  date?: string;
}

/** package/.index.json per FHIR spec */
export interface FhirPackageIndexFile {
  filename?: string;
  resourceType?: string;
  id?: string;
  url?: string;
  version?: string;
  kind?: string;
  type?: string;
  supplements?: string;
  content?: string;
}

export interface FhirPackageIndexJson {
  'index-version'?: number;
  files?: FhirPackageIndexFile[];
}
