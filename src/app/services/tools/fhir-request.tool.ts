// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export function isWriteMethod(method: string): boolean {
  const m = String(method).toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

export class FhirRequestToolRead extends BaseBrowserTool {
  static readonly id = 'fhir_request_read';
  static override planModeAllowed = true;
  static override statusMessage = 'Reading from FHIR server...';

  readonly name = FhirRequestToolRead.id;
  readonly description = 'Perform read-only GET requests against the user-configured FHIR server. Path is relative to the FHIR base URL (e.g. Patient, Patient/123, Patient?name=foo). User references to patient records or requests for medical data should be presumed to be accessible via this tool.';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Resource path relative to FHIR base URL (e.g. Patient, Patient/123, Patient?name=foo)'
      }
    },
    required: ['path']
  };

  execute(_params: Record<string, unknown>): unknown {
    throw new Error('FHIR read requests are executed by the tool orchestrator.');
  }
}

export class FhirRequestToolWrite extends BaseBrowserTool {
  static readonly id = 'fhir_request_write';
  static override planModeAllowed = false;
  static override statusMessage = 'Sending write request to FHIR server...';

  readonly name = FhirRequestToolWrite.id;
  readonly description = 'Performs FHIR write requests (via HTTPPOST, PUT, PATCH, DELETE) against the user-configured FHIR server.';
  readonly parameters = {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        description: 'HTTP method: POST, PUT, PATCH, or DELETE',
        enum: ['POST', 'PUT', 'PATCH', 'DELETE']
      },
      path: {
        type: 'string',
        description: 'Resource path relative to FHIR base URL (e.g. Patient, Patient/123)'
      },
      body: {
        type: 'object',
        description: 'Request body for POST, PUT, or PATCH (optional for DELETE)'
      }
    },
    required: ['method', 'path']
  };

  execute(_params: Record<string, unknown>): unknown {
    throw new Error('FHIR write requests are executed by the tool orchestrator.');
  }
}
