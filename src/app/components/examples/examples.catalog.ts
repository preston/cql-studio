// Author: Preston Lee

import { ExamplePaths } from '../../constants/example-paths.constants';

export type ExampleBadge = 'CDS' | 'Measure' | 'Gaps in Care';

export const EXAMPLE_BADGES: readonly ExampleBadge[] = [
  'CDS',
  'Measure',
  'Gaps in Care'
] as const;

export interface ExampleCatalogEntry {
  id: string;
  title: string;
  path: string;
  badges: ExampleBadge[];
  description: string;
  packageId: string;
  /** Empty string means resolve dist-tags.latest in the importer. */
  packageVersion: string;
  /**
   * Same-origin or absolute URL to a FHIR package `.tgz`. When set, Examples deep-link
   * the importer with `source=url` instead of a registry package id.
   */
  packageUrl: string;
}

/** Not published to a FHIR package registry yet; shipped as a built-in `.tgz`. */
export const EXAMPLE_PACKAGE_LIPID = '';
export const EXAMPLE_PACKAGE_LIPID_VERSION = '';
export const EXAMPLE_PACKAGE_LIPID_URL = ExamplePaths.LIPID_MANAGEMENT_PACKAGE;
/** Not published to a FHIR package registry yet. */
export const EXAMPLE_PACKAGE_HOSPITAL_AT_HOME = '';
export const EXAMPLE_PACKAGE_HOSPITAL_AT_HOME_VERSION = '';

export const EXAMPLE_CATALOG: readonly ExampleCatalogEntry[] = [
  {
    id: 'lipid-management',
    title: 'Lipid Management',
    path: 'lipid-management',
    badges: ['Measure', 'Gaps in Care'],
    description:
      'CQL-based lipid management and cardiovascular risk workflows (including PREVENT-aligned scoring), with VSAC and custom value sets for therapy and observation criteria.',
    packageId: EXAMPLE_PACKAGE_LIPID,
    packageVersion: EXAMPLE_PACKAGE_LIPID_VERSION,
    packageUrl: EXAMPLE_PACKAGE_LIPID_URL
  },
  {
    id: 'hospital-at-home',
    title: 'Hospital at Home',
    path: 'hospital-at-home',
    badges: ['CDS', 'Gaps in Care'],
    description:
      'CDS and gaps-in-care libraries for determining eligibility of admitted patients to transfer to an at-home care environment.',
    packageId: EXAMPLE_PACKAGE_HOSPITAL_AT_HOME,
    packageVersion: EXAMPLE_PACKAGE_HOSPITAL_AT_HOME_VERSION,
    packageUrl: ''
  }
];

export function findExampleById(id: string): ExampleCatalogEntry | undefined {
  return EXAMPLE_CATALOG.find((e) => e.id === id);
}
