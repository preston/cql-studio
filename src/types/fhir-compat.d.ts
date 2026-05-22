import 'fhir/r4';

declare module 'fhir/r4' {
  interface Resource {
    readonly resourceType?: string;
  }
}

export {};
