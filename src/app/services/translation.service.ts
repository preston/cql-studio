// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import { 
  ModelManager, 
  LibraryManager, 
  CqlTranslator, 
  CqlCompilerException,
  createModelInfoProvider,
  createLibrarySourceProvider,
  createUcumService,
  stringAsSource
} from '@cqframework/cql/cql-to-elm';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';

export interface TranslationResult {
  elmXml: string | null;
  errors: string[];
  warnings: string[];
  messages: string[];
  hasErrors: boolean;
}

export interface RawTranslationResult {
  elmXml: string | null;
  errors: CqlCompilerException[];
  warnings: CqlCompilerException[];
  messages: CqlCompilerException[];
  hasErrors: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  private modelManager: ModelManager;
  private libraryManager: LibraryManager;
  private locatorUtils = inject(CqlLocatorUtilsService);
  
  // Hardcoded FHIR version - not configurable
  private readonly FHIR_VERSION = '4.0.1';

  private modelInfoCache = new Map<string, string>();
  private librarySourceCache = new Map<string, string>();
  private translationAssetsLoaded = false;
  private translationAssetsLoadPromise: Promise<void> | null = null;

  private async fetchTextResource(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }

  /**
   * Preload translation assets asynchronously to avoid blocking the UI thread.
   * Providers registered with @cqframework/cql are synchronous, so we cache the
   * fetched text and serve from memory synchronously during translation.
   */
  async ensureTranslationAssetsLoaded(): Promise<void> {
    if (this.translationAssetsLoaded) return;
    if (this.translationAssetsLoadPromise) return this.translationAssetsLoadPromise;

    this.translationAssetsLoadPromise = Promise.all([
      this.fetchTextResource('/cql/system-modelinfo.xml').then(text => {
        this.modelInfoCache.set('/cql/system-modelinfo.xml', text);
      }),
      this.fetchTextResource(`/cql/fhir-modelinfo-${this.FHIR_VERSION}.xml`).then(text => {
        this.modelInfoCache.set(`/cql/fhir-modelinfo-${this.FHIR_VERSION}.xml`, text);
      }),
      this.fetchTextResource(`/cql/FHIRHelpers-${this.FHIR_VERSION}.cql`).then(text => {
        this.librarySourceCache.set(`/cql/FHIRHelpers-${this.FHIR_VERSION}.cql`, text);
      })
    ]).then(() => {
      this.translationAssetsLoaded = true;
    });

    return this.translationAssetsLoadPromise;
  }

  constructor() {
    // Create ModelManager with default model info loading enabled
    this.modelManager = new ModelManager(undefined, true);
    
    // Create UCUM service for unit validation (same pattern as cql-to-elm-ui)
    const ucumUtils = ucum.UcumLhcUtils.getInstance();
    const validateUnit = (unit: string): string | null => {
      const result = ucumUtils.validateUnitString(unit);
      if (result.status === 'valid') {
        return null;
      } else {
        return result.msg[0];
      }
    };
    const ucumService = createUcumService(
      () => {
        throw new Error('Unsupported operation');
      },
      validateUnit
    );
    
    // Register model info provider for System and FHIR models
    const modelInfoProvider = createModelInfoProvider(
      (id: string, system: string | null | undefined, version: string | null | undefined) => {
        // System model
        if (id === 'System' && !system && !version) {
          const xml = this.modelInfoCache.get('/cql/system-modelinfo.xml');
          return xml ? stringAsSource(xml) : null;
        }
        
        // FHIR model - only support 4.0.1
        if (id === 'FHIR' && !system && version === this.FHIR_VERSION) {
          const xml = this.modelInfoCache.get(`/cql/fhir-modelinfo-${this.FHIR_VERSION}.xml`);
          return xml ? stringAsSource(xml) : null;
        }
        
        // Reject other FHIR versions
        if (id === 'FHIR' && version !== this.FHIR_VERSION) {
          console.warn(`FHIR version ${version} is not supported. Only ${this.FHIR_VERSION} is supported.`);
          return null;
        }
        
        return null;
      }
    );
    
    this.modelManager.modelInfoLoader.registerModelInfoProvider(modelInfoProvider, true);
    
    // Create LibraryManager with the ModelManager and UCUM service
    this.libraryManager = new LibraryManager(this.modelManager, undefined, undefined, ucumService);
    
    // Register library source provider for common libraries like FHIRHelpers
    const librarySourceProvider = createLibrarySourceProvider(
      (id: string, system: string | null | undefined, version: string | null | undefined) => {
        // FHIRHelpers library - only support 4.0.1
        if (id === 'FHIRHelpers' && !system && version === this.FHIR_VERSION) {
          const cql = this.librarySourceCache.get(`/cql/FHIRHelpers-${this.FHIR_VERSION}.cql`);
          return cql ? stringAsSource(cql) : null;
        }
        
        // Reject other FHIRHelpers versions
        if (id === 'FHIRHelpers' && version !== this.FHIR_VERSION) {
          console.warn(`FHIRHelpers version ${version} is not supported. Only ${this.FHIR_VERSION} is supported.`);
          return null;
        }
        
        return null;
      }
    );
    
    this.libraryManager.librarySourceLoader.registerProvider(librarySourceProvider);

    // Begin loading translation assets immediately to minimize latency.
    // Callers that need translation should still await ensureTranslationAssetsLoaded().
    void this.ensureTranslationAssetsLoaded();
  }

  // Translation assets are loaded via ensureTranslationAssetsLoaded() and cached.

  /**
   * Translate CQL to ELM using the @cqframework/cql library
   * @param cql The CQL code to translate
   * @returns TranslationResult containing ELM XML and any errors/warnings/messages
   */
  translateCqlToElm(cql: string): TranslationResult {
    try {
      if (!this.translationAssetsLoaded) {
        return {
          elmXml: null,
          errors: ['Translation assets are still loading. Please try again in a moment.'],
          warnings: [],
          messages: [],
          hasErrors: true
        };
      }

      const translator = CqlTranslator.fromText(cql, this.libraryManager);
      
      // Extract errors, warnings, and messages
      const errors = translator.errors?.asJsReadonlyArrayView() || [];
      const warnings = translator.warnings?.asJsReadonlyArrayView() || [];
      const messages = translator.messages?.asJsReadonlyArrayView() || [];
      
      // Format exception messages
      const errorMessages = errors
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));
      const warningMessages = warnings
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));
      const infoMessages = messages
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));
      
      // Get ELM XML (even if there are errors, we may still have partial results)
      let elmXml: string | null = null;
      try {
        elmXml = translator.toXml();
        // XML formatting is handled in the ELM tab component using Prism
      } catch (e) {
        // If toXml fails, elmXml remains null
        console.warn('Failed to generate ELM XML:', e);
      }
      
      return {
        elmXml,
        errors: errorMessages,
        warnings: warningMessages,
        messages: infoMessages,
        hasErrors: errorMessages.length > 0
      };
    } catch (error) {
      // Handle unexpected errors during translation
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        elmXml: null,
        errors: [`Translation failed: ${errorMessage}`],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
  }

  /**
   * Translate CQL to ELM and return raw exceptions (for validation use)
   * @param cql The CQL code to translate
   * @returns RawTranslationResult containing raw CqlCompilerException objects
   */
  translateCqlToElmRaw(cql: string): RawTranslationResult {
    try {
      if (!this.translationAssetsLoaded) {
        return {
          elmXml: null,
          errors: [{ message: 'Translation assets are still loading. Please try again in a moment.' } as CqlCompilerException],
          warnings: [],
          messages: [],
          hasErrors: true
        };
      }

      const translator = CqlTranslator.fromText(cql, this.libraryManager);
      
      // Extract raw errors, warnings, and messages
      const errors = translator.errors?.asJsReadonlyArrayView() || [];
      const warnings = translator.warnings?.asJsReadonlyArrayView() || [];
      const messages = translator.messages?.asJsReadonlyArrayView() || [];
      
      // Filter out null/undefined
      const rawErrors = errors.filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null);
      const rawWarnings = warnings.filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null);
      const rawMessages = messages.filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null);
      
      // Get ELM XML (even if there are errors, we may still have partial results)
      let elmXml: string | null = null;
      try {
        elmXml = translator.toXml();
      } catch (e) {
        console.warn('Failed to generate ELM XML:', e);
      }
      
      return {
        elmXml,
        errors: rawErrors,
        warnings: rawWarnings,
        messages: rawMessages,
        hasErrors: rawErrors.length > 0
      };
    } catch (error) {
      // Handle unexpected errors during translation
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorException: CqlCompilerException = {
        message: `Translation failed: ${errorMessage}`
      };
      return {
        elmXml: null,
        errors: [errorException],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
  }

  /**
   * Format a CqlCompilerException into a readable error message
   * Uses shared locator utility to extract line/column information
   */
  formatException(exception: CqlCompilerException): string {
    const message = exception.message || 'Unknown error';
    const locatorInfo = this.locatorUtils.extractLocatorInfo(exception);
    const locatorStr = this.locatorUtils.formatLocator(locatorInfo);
    
    return locatorStr ? `${message} ${locatorStr}` : message;
  }
}
