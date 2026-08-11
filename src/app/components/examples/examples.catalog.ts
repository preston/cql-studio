// Author: Preston Lee

export type ExampleBadge = 'CDS' | 'Measure' | 'Guideline' | 'Gaps in Care';

export const EXAMPLE_BADGES: readonly ExampleBadge[] = [
  'CDS',
  'Measure',
  'Guideline',
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
}

/** Placeholder package ids — replace with real registry packages when known. */
export const EXAMPLE_PACKAGE_GLP1 = 'hl7.fhir.us.davinci-crd';
export const EXAMPLE_PACKAGE_GLP1_VERSION = '';
/** Not published to a FHIR package registry yet. */
export const EXAMPLE_PACKAGE_LIPID = '';
export const EXAMPLE_PACKAGE_LIPID_VERSION = '';
/** Not published to a FHIR package registry yet. */
export const EXAMPLE_PACKAGE_HOSPITAL_AT_HOME = '';
export const EXAMPLE_PACKAGE_HOSPITAL_AT_HOME_VERSION = '';

export const EXAMPLE_CATALOG: readonly ExampleCatalogEntry[] = [
  {
    id: 'glp1',
    title: 'GLP-1 Prescribing',
    path: 'glp1',
    badges: ['CDS', 'Guideline'],
    description:
      'Explore clinical decision support for GLP-1 receptor agonist prescribing, including eligibility and safety considerations.',
    packageId: EXAMPLE_PACKAGE_GLP1,
    packageVersion: EXAMPLE_PACKAGE_GLP1_VERSION
  },
  {
    id: 'lipid-management',
    title: 'Lipid Management',
    path: 'lipid-management',
    badges: ['Measure', 'Gaps in Care'],
    description:
      'CQL-based lipid management and cardiovascular risk workflows (including PREVENT-aligned scoring), with VSAC and custom value sets for therapy and observation criteria.',
    packageId: EXAMPLE_PACKAGE_LIPID,
    packageVersion: EXAMPLE_PACKAGE_LIPID_VERSION
  },
  {
    id: 'hospital-at-home',
    title: 'Hospital at Home',
    path: 'hospital-at-home',
    badges: ['CDS', 'Gaps in Care'],
    description:
      'CDS and gaps-in-care libraries for determining eligibility of admitted patients to transfer to an at-home care environment.',
    packageId: EXAMPLE_PACKAGE_HOSPITAL_AT_HOME,
    packageVersion: EXAMPLE_PACKAGE_HOSPITAL_AT_HOME_VERSION
  }
];

export function findExampleById(id: string): ExampleCatalogEntry | undefined {
  return EXAMPLE_CATALOG.find((e) => e.id === id);
}
