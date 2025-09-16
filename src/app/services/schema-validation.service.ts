// Author: Preston Lee

import { Injectable } from '@angular/core';
import { CqlTestResults } from '../models/cql-test-results.model';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

@Injectable({
  providedIn: 'root'
})
export class SchemaValidationService {
  private readonly schemaUrl = '/cql-test-results.schema.json';
  private ajv: Ajv;
  private schema: any = null;

  constructor() {
    this.ajv = new Ajv({ 
      allErrors: true,
      removeAdditional: false      // Don't remove unknown properties
    });
    addFormats(this.ajv);  // Add format validation support
  }

  async validateResults(data: any): Promise<{ isValid: boolean; errors: string[] }> {
    try {
      // Load schema if not already loaded
      if (!this.schema) {
        await this.loadSchema();
      }

      // Validate data against schema
      const validate = this.ajv.compile(this.schema);
      const isValid = validate(data);

      if (isValid) {
        return { isValid: true, errors: [] };
      } else {
        // Format Ajv errors into readable messages
        const errors = validate.errors?.map(error => {
          const path = error.instancePath ? error.instancePath.substring(1) : 'root';
          return `${path}: ${error.message}`;
        }) || ['Unknown validation error'];
        
        return { isValid: false, errors };
      }
    } catch (error) {
      console.error('Error during validation:', error);
      return { 
        isValid: false, 
        errors: [`Validation failed: ${(error as Error).message}`] 
      };
    }
  }

  async loadSchema(): Promise<any> {
    if (this.schema) {
      return this.schema;
    }

    try {
      const response = await fetch(this.schemaUrl);
      if (!response.ok) {
        throw new Error(`Failed to load schema: ${response.statusText}`);
      }
      
      this.schema = await response.json();
      console.log('Schema loaded successfully');
      return this.schema;
    } catch (error) {
      console.error('Error loading schema:', error);
      throw error;
    }
  }
}
