// Author: Preston Lee
// Demo wiring contributions: Eugene Vestel

import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, firstValueFrom, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { Bundle, Library, MeasureReport, Patient, ValueSet } from 'fhir/r4';
import type { PopulationCounts } from './elm-to-sql';
import { extractValueSets } from './elm-to-sql';
import { LibraryService } from '../../services/library.service';
import { SqlOnFhirPipelineService, type GenerateSqlResult } from '../../services/sql-on-fhir/sql-on-fhir-pipeline.service';
import { SqlOnFhirDemoService, decodeLibraryCql, CMS125_DATA_KEY } from '../../services/sql-on-fhir/sql-on-fhir-demo.service';
import {
  SqlOnFhirExecutionDataService,
  bundleHasClinicalResources,
  resourceTypesInBundle,
  summarizeBundleResources,
} from '../../services/sql-on-fhir/sql-on-fhir-execution-data.service';
import {
  bundledValueSetsForServerPublish,
  expandValueSetsForServerPublish,
} from '../../services/sql-on-fhir/sql-on-fhir-value-set-publish.lib';
import { PatientService } from '../../services/patient.service';
import { TranslationService } from '../../services/translation.service';
import { ToastService } from '../../services/toast.service';
import { isResourceType } from '../../services/fhir-resource-type.lib';
import { formatElmXml } from './format-elm-xml';
import {
  buildDefaultParameterValues,
  buildLibraryParameterSpecs,
  type LibraryParameterValues,
  type ParameterValue,
} from './library-parameters.lib';
import {
  assessMeasureLibraryCompatibility,
  hasBlockingCompatibilityIssues,
} from './measure-library-compatibility.lib';
import { resolveExecutionResourceTypes } from './measure-resource-types.lib';
import { SqlPipelineCqlStepComponent } from './pipeline-steps/sql-pipeline-cql-step.component';
import { SqlPipelineElmStepComponent } from './pipeline-steps/sql-pipeline-elm-step.component';
import { SqlPipelineExecuteStepComponent } from './pipeline-steps/sql-pipeline-execute-step.component';
import { SqlPipelineLibraryStepComponent } from './pipeline-steps/sql-pipeline-library-step.component';
import { SqlPipelineSqlGenStepComponent } from './pipeline-steps/sql-pipeline-sql-gen-step.component';

export type SqlWorkflowStep = 'library' | 'cql' | 'elm' | 'sqlGen' | 'execute';

const SQL_WORKFLOW_ORDER: SqlWorkflowStep[] = ['library', 'cql', 'elm', 'sqlGen', 'execute'];

@Component({
  selector: 'app-sql-on-fhir',
  imports: [
    FormsModule,
    SqlPipelineLibraryStepComponent,
    SqlPipelineCqlStepComponent,
    SqlPipelineElmStepComponent,
    SqlPipelineSqlGenStepComponent,
    SqlPipelineExecuteStepComponent
  ],
  templateUrl: './sql-on-fhir.component.html',

  styleUrl: './sql-on-fhir.component.scss'
})
export class SqlOnFhirComponent implements OnInit {
  private readonly libraryService = inject(LibraryService);
  private readonly pipeline = inject(SqlOnFhirPipelineService);
  private readonly translationService = inject(TranslationService);
  private readonly demoService = inject(SqlOnFhirDemoService);
  private readonly executionDataService = inject(SqlOnFhirExecutionDataService);
  private readonly patientService = inject(PatientService);
  private readonly toastService = inject(ToastService);

  /** Parsed population counts from the most recent executeSql, fed into MeasureReport generation. */
  private latestPopulationCounts: PopulationCounts | null = null;

  private elmRunId = 0;
  private sqlRunId = 0;
  /** Bumps when selection is cleared or a new library load starts; stale HTTP callbacks no-op. */
  private libraryLoadGeneration = 0;
  /** Library id for which executionParameters defaults were last applied. */
  private parameterDefaultsLibraryId: string | null = null;
  /** Library id for which executionResourceTypes defaults were last applied. */
  private resourceTypesDefaultsLibraryId: string | null = null;
  /** Bumps when patient compartment fetch starts; stale callbacks no-op. */
  private patientDataFetchGeneration = 0;
  /** Avoid duplicate CMS125 ValueSet publish runs for the same ELM + bundled content. */
  private cms125ValueSetPublishToken: string | null = null;
  private readonly patientSearchTrigger = new Subject<string>();

  protected readonly paginatedLibraries = signal<Library[]>([]);
  protected readonly currentPage = signal(1);
  protected readonly totalPages = signal(0);
  protected readonly totalLibraries = signal(0);
  protected readonly pageSize = signal(5);
  protected readonly librarySortBy = signal<'name' | 'version' | 'date'>('name');
  protected readonly librarySortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly isLoadingLibraries = signal(false);
  protected readonly libraryListSearchTerm = signal('');
  protected readonly listError = signal<string | null>(null);

  protected readonly selectedLibrary = signal<Library | null>(null);
  protected readonly selectedLibraryJson = signal('');
  protected readonly cqlPreview = signal('');
  protected readonly elmXmlRaw = signal<string | null>(null);
  protected readonly elmJsonRaw = signal<string | null>(null);
  protected readonly isLoadingDemo = signal(false);
  protected readonly demoLoadError = signal<string | null>(null);
  protected readonly isExecutingSql = signal(false);
  protected readonly isTranslatingElm = signal(false);
  protected readonly elmTranslationErrors = signal<string[]>([]);
  protected readonly elmTranslationWarnings = signal<string[]>([]);
  protected readonly elmTranslationMessages = signal<string[]>([]);
  protected readonly formattedElmXml = computed(() => {
    const xml = this.elmXmlRaw();
    if (!xml) {
      return '';
    }
    return formatElmXml(xml);
  });
  protected readonly sqlText = signal('');
  protected readonly sqlResultsRaw = signal('');
  protected readonly sqlExecuteFailed = signal(false);
  protected readonly generateSqlResult = signal<GenerateSqlResult | null>(null);
  protected readonly generateSqlError = signal<string | null>(null);
  protected readonly executionParameters = signal<LibraryParameterValues>({});
  protected readonly executionBundle = signal<Bundle | null>(null);
  protected readonly executionDataKey = signal<string>('');
  protected readonly usingCms125Preset = signal(false);
  protected readonly bundledValueSets = signal<ValueSet[]>([]);
  protected readonly cms125ValueSetsOnServer = signal(false);
  protected readonly selectedPatients = signal<Patient[]>([]);
  protected readonly patientSearchTerm = signal('');
  protected readonly patientSearchResults = signal<Patient[]>([]);
  protected readonly isLoadingPatients = signal(false);
  protected readonly isLoadingPatientData = signal(false);
  protected readonly patientSearchError = signal<string | null>(null);
  protected readonly executionResourceTypes = signal<string[]>(['Patient']);
  protected readonly measureReport = signal<MeasureReport | null>(null);
  protected readonly persistedMeasureReportId = signal<string | null>(null);
  private readonly persistedMeasureReportMeta = signal<MeasureReport['meta'] | null>(null);
  protected readonly sqlExecutionStatus = signal<string | null>(null);
  protected readonly measureReportStatus = signal<string | null>(null);

  protected readonly activeStep = signal<SqlWorkflowStep>('library');
  protected readonly workflowSteps = SQL_WORKFLOW_ORDER;

  protected readonly measureReportJson = computed(() => {
    const r = this.measureReport();
    return r ? JSON.stringify(r, null, 2) : '';
  });

  /** Non-null only when a library row is selected and JSON was loaded successfully; drives pipeline UI visibility. */
  protected readonly activePipelineLibrary = computed((): Library | null => {
    const lib = this.selectedLibrary();
    if (!lib?.id || this.selectedLibraryJson().trim().length === 0) {
      return null;
    }
    return lib;
  });

  protected readonly parameterSpecs = computed(() =>
    buildLibraryParameterSpecs(this.selectedLibrary(), this.elmJsonRaw()),
  );

  protected readonly resolvedResourceTypes = computed(() =>
    resolveExecutionResourceTypes({
      elmJson: this.elmJsonRaw(),
      library: this.selectedLibrary(),
    }),
  );

  protected readonly derivedResourceTypes = computed(
    () => this.resolvedResourceTypes().derivedTypes,
  );

  protected readonly unsupportedResourceTypes = computed(
    () => this.resolvedResourceTypes().unsupportedTypes,
  );

  protected readonly usesFhirPatientFetch = computed(
    () => !this.usingCms125Preset() && this.selectedPatients().length > 0,
  );

  protected readonly showResourceTypeSelection = computed(() => !this.usingCms125Preset());

  protected readonly executionBundleSummary = computed(() =>
    summarizeBundleResources(this.executionBundle()),
  );

  protected readonly compatibilityIssues = computed(() =>
    assessMeasureLibraryCompatibility({
      library: this.selectedLibrary(),
      cqlTranslationErrors: this.elmTranslationErrors(),
      elmJson: this.elmJsonRaw(),
      generateSqlResult: this.generateSqlResult(),
      generateSqlError: this.generateSqlError(),
      parameterSpecs: this.parameterSpecs(),
      parameterValues: this.executionParameters(),
      hasExecutionBundle: bundleHasClinicalResources(this.executionBundle()),
      derivedResourceTypes: this.derivedResourceTypes(),
      selectedResourceTypes: this.executionResourceTypes(),
      unsupportedResourceTypes: this.unsupportedResourceTypes(),
      usesFhirPatientFetch: this.usesFhirPatientFetch(),
    }),
  );

  protected readonly canExecuteSql = computed(
    () =>
      !hasBlockingCompatibilityIssues(this.compatibilityIssues()) &&
      this.sqlText().trim().length > 0 &&
      !this.isExecutingSql() &&
      !this.isLoadingPatientData(),
  );

  protected readonly compatibilityReady = computed(
    () =>
      this.generateSqlResult() != null &&
      this.generateSqlResult()!.populations.length > 0 &&
      !hasBlockingCompatibilityIssues(this.compatibilityIssues()),
  );

  constructor() {
    effect(() => {
      const lib = this.selectedLibrary();
      const cql = this.cqlPreview().trim();
      if (!lib?.id) {
        this.elmRunId++;
        this.elmXmlRaw.set(null);
        this.elmJsonRaw.set(null);
        this.elmTranslationErrors.set([]);
        this.elmTranslationWarnings.set([]);
        this.elmTranslationMessages.set([]);
        this.isTranslatingElm.set(false);
        return;
      }
      if (!cql) {
        this.elmXmlRaw.set(null);
        this.elmJsonRaw.set(null);
        this.elmTranslationErrors.set([]);
        this.elmTranslationWarnings.set([]);
        this.elmTranslationMessages.set([]);
        this.isTranslatingElm.set(false);
        return;
      }

      const runId = ++this.elmRunId;
      this.isTranslatingElm.set(true);
      this.elmTranslationErrors.set([]);
      this.elmTranslationWarnings.set([]);
      this.elmTranslationMessages.set([]);

      void this.translationService
        .translateCqlToElmAsync(cql)
        .then(result => {
          if (runId !== this.elmRunId) {
            return;
          }
          this.isTranslatingElm.set(false);
          this.elmXmlRaw.set(result.elmXml ?? '');
          this.elmJsonRaw.set(result.elmJson ?? null);
          this.elmTranslationErrors.set(result.errors);
          this.elmTranslationWarnings.set(result.warnings);
          this.elmTranslationMessages.set(result.messages);
        })
        .catch((e: unknown) => {
          if (runId !== this.elmRunId) {
            return;
          }
          this.isTranslatingElm.set(false);
          this.elmXmlRaw.set(null);
          this.elmJsonRaw.set(null);
          const msg = e instanceof Error ? e.message : String(e);
          this.elmTranslationErrors.set([`Failed to load translation assets: ${msg}`]);
          this.elmTranslationWarnings.set([]);
          this.elmTranslationMessages.set([]);
        });
    });

    effect(() => {
      const lib = this.selectedLibrary();
      const elmJson = this.elmJsonRaw();
      if (!lib?.id || !elmJson?.trim()) {
        this.executionParameters.set({});
        this.parameterDefaultsLibraryId = null;
        return;
      }
      if (this.parameterDefaultsLibraryId === lib.id) {
        return;
      }
      const specs = buildLibraryParameterSpecs(lib, elmJson);
      this.executionParameters.set(buildDefaultParameterValues(specs, lib, elmJson));
      this.parameterDefaultsLibraryId = lib.id;
    });

    effect(() => {
      const lib = this.selectedLibrary();
      const elmJson = this.elmJsonRaw();
      if (!lib?.id || !elmJson?.trim()) {
        this.executionResourceTypes.set(['Patient']);
        this.resourceTypesDefaultsLibraryId = null;
        return;
      }
      if (this.resourceTypesDefaultsLibraryId === lib.id) {
        return;
      }
      const { derivedTypes } = resolveExecutionResourceTypes({
        elmJson,
        library: lib,
      });
      this.executionResourceTypes.set(derivedTypes.length > 0 ? derivedTypes : ['Patient']);
      this.resourceTypesDefaultsLibraryId = lib.id;
    });

    effect(() => {
      if (this.usingCms125Preset()) {
        return;
      }
      const patients = this.selectedPatients();
      const resourceTypes = this.executionResourceTypes();
      void this.refreshExecutionBundleFromPatients(patients, resourceTypes);
    });

    effect(() => {
      const lib = this.selectedLibrary();
      const elmJson = this.elmJsonRaw();
      const params = this.executionParameters();
      if (!lib?.id || elmJson == null || elmJson.trim() === '') {
        this.sqlRunId++;
        this.sqlText.set('');
        this.generateSqlResult.set(null);
        this.generateSqlError.set(null);
        return;
      }
      const runId = ++this.sqlRunId;
      this.pipeline.generateSql(elmJson, lib, params).subscribe({
        next: result => {
          if (runId !== this.sqlRunId) {
            return;
          }
          this.sqlText.set(result.sql);
          this.generateSqlResult.set(result);
          this.generateSqlError.set(null);
        },
        error: (err: unknown) => {
          if (runId !== this.sqlRunId) {
            return;
          }
          this.sqlText.set('');
          this.generateSqlResult.set(null);
          const msg = err instanceof Error ? err.message : String(err);
          this.generateSqlError.set(msg);
        },
      });
    });

    effect(() => {
      if (!this.selectedLibrary()) {
        return;
      }
      const first = this.firstIncompleteStep();
      if (first == null) {
        return;
      }
      const ai = SQL_WORKFLOW_ORDER.indexOf(this.activeStep());
      const fi = SQL_WORKFLOW_ORDER.indexOf(first);
      if (ai > fi) {
        this.activeStep.set(first);
      }
    });

    effect(() => {
      if (this.executionDataKey() !== CMS125_DATA_KEY) {
        return;
      }
      const elmJson = this.elmJsonRaw();
      const bundled = this.bundledValueSets();
      if (!elmJson?.trim() || bundled.length === 0) {
        return;
      }
      const token = `${elmJson.length}:${bundled.map(v => v.id).join(',')}`;
      if (this.cms125ValueSetPublishToken === token) {
        return;
      }
      this.cms125ValueSetPublishToken = token;
      void this.publishCms125ValueSetsToServer(elmJson, bundled, token);
    });

    this.patientSearchTrigger.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(term => {
        const trimmed = term.trim();
        if (trimmed.length === 0) {
          this.isLoadingPatients.set(false);
          this.patientSearchResults.set([]);
          this.patientSearchError.set(null);
          return of(null);
        }
        this.isLoadingPatients.set(true);
        this.patientSearchError.set(null);
        return this.patientService.search(trimmed).pipe(
          catchError((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.patientSearchError.set(msg);
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe(bundle => {
      this.isLoadingPatients.set(false);
      if (bundle == null) {
        return;
      }
      const patients =
        bundle.entry
          ?.map(e => e.resource)
          .filter((r): r is Patient => isResourceType(r, 'Patient')) ?? [];
      this.patientSearchResults.set(patients);
    });
  }

  ngOnInit(): void {
    this.loadPaginatedLibraries();
  }

  protected loadPaginatedLibraries(): void {
    this.isLoadingLibraries.set(true);
    this.listError.set(null);
    this.libraryService
      .getAll(this.currentPage(), this.pageSize(), this.librarySortBy(), this.librarySortOrder())
      .subscribe({
        next: (bundle: Bundle) => {
          this.isLoadingLibraries.set(false);
          this.paginatedLibraries.set(
            bundle.entry
              ? bundle.entry
                  .map(e => e.resource)
                  .filter((resource): resource is Library => isResourceType(resource, 'Library'))
              : []
          );
          this.applyBundlePagination(bundle);
        },
        error: (err: unknown) => {
          this.isLoadingLibraries.set(false);
          const msg = this.errorMessage(err);
          this.listError.set(msg);
          this.paginatedLibraries.set([]);
          this.totalPages.set(0);
          this.totalLibraries.set(0);
        }
      });
  }

  private applyBundlePagination(bundle: Bundle): void {
    const entries = bundle.entry?.length ?? 0;
    const hasNextPage = bundle.link?.some(l => l.relation === 'next');
    if (bundle.total != null && bundle.total > 0) {
      this.totalLibraries.set(bundle.total);
      this.totalPages.set(Math.ceil(bundle.total / this.pageSize()));
    } else if (hasNextPage) {
      this.totalLibraries.set(this.currentPage() * this.pageSize() + 1);
      this.totalPages.set(this.currentPage() + 1);
    } else {
      this.totalLibraries.set((this.currentPage() - 1) * this.pageSize() + entries);
      this.totalPages.set(this.currentPage());
    }
  }

  protected loadLibraries(): void {
    if (this.libraryListSearchTerm().trim()) {
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  protected loadSearchedLibraries(): void {
    this.isLoadingLibraries.set(true);
    this.listError.set(null);
    this.libraryService
      .searchPaginated(
        this.libraryListSearchTerm(),
        this.currentPage(),
        this.pageSize(),
        this.librarySortBy(),
        this.librarySortOrder()
      )
      .subscribe({
        next: (bundle: Bundle) => {
          this.isLoadingLibraries.set(false);
          this.paginatedLibraries.set(
            bundle.entry
              ? bundle.entry
                  .map(e => e.resource)
                  .filter((resource): resource is Library => isResourceType(resource, 'Library'))
              : []
          );
          this.applyBundlePagination(bundle);
        },
        error: (err: unknown) => {
          this.isLoadingLibraries.set(false);
          this.listError.set(this.errorMessage(err));
          this.paginatedLibraries.set([]);
          this.totalPages.set(0);
          this.totalLibraries.set(0);
        }
      });
  }

  private errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    return 'Unable to load libraries from server';
  }

  protected onLibraryListSearch(): void {
    this.currentPage.set(1);
    if (this.libraryListSearchTerm().trim()) {
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  protected goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages() && page !== this.currentPage()) {
      this.currentPage.set(page);
      this.loadLibraries();
    }
  }

  protected nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.goToPage(this.currentPage() + 1);
    }
  }

  protected previousPage(): void {
    if (this.currentPage() > 1) {
      this.goToPage(this.currentPage() - 1);
    }
  }

  protected changePageSize(newPageSize: number): void {
    this.pageSize.set(Number(newPageSize));
    this.currentPage.set(1);
    this.loadLibraries();
  }

  protected changeSortField(value: string): void {
    this.changeSorting(value as 'name' | 'version' | 'date');
  }

  protected changeSorting(sortBy: 'name' | 'version' | 'date'): void {
    if (this.librarySortBy() === sortBy) {
      this.librarySortOrder.update(o => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      this.librarySortBy.set(sortBy);
      this.librarySortOrder.set('asc');
    }
    this.currentPage.set(1);
    this.loadLibraries();
  }

  protected selectLibraryFromList(library: Library): void {
    if (!library.id) {
      return;
    }
    if (this.selectedLibrary()?.id === library.id) {
      this.clearLibrarySelection();
      return;
    }

    this.clearExecuteStepStatus();
    const gen = ++this.libraryLoadGeneration;

    this.libraryService.get(library.id).subscribe({
      next: fresh => {
        if (gen !== this.libraryLoadGeneration) {
          return;
        }
        if (!fresh.id) {
          return;
        }
        this.clearPipelineOutputs();
        this.selectedLibrary.set(fresh);
        this.selectedLibraryJson.set(JSON.stringify(fresh, null, 2));
        this.libraryService.getCqlContent(fresh).subscribe({
          next: ({ cqlContent }) => {
            if (gen !== this.libraryLoadGeneration) {
              return;
            }
            this.cqlPreview.set(cqlContent ?? '');
          },
          error: () => {
            if (gen !== this.libraryLoadGeneration) {
              return;
            }
            this.cqlPreview.set('');
          }
        });
      },
      error: (err: unknown) => {
        if (gen !== this.libraryLoadGeneration) {
          return;
        }
        this.listError.set(this.errorMessage(err));
        this.selectedLibrary.set(null);
        this.selectedLibraryJson.set('');
      }
    });
  }

  private clearLibrarySelection(): void {
    this.libraryLoadGeneration++;
    this.clearExecuteStepStatus();
    this.clearPipelineOutputs();
    this.selectedLibrary.set(null);
    this.selectedLibraryJson.set('');
  }

  private clearPipelineOutputs(clearExecution = true): void {
    this.elmRunId++;
    this.sqlRunId++;
    this.activeStep.set('library');
    this.sqlExecuteFailed.set(false);
    this.elmXmlRaw.set(null);
    this.elmJsonRaw.set(null);
    this.elmTranslationErrors.set([]);
    this.elmTranslationWarnings.set([]);
    this.elmTranslationMessages.set([]);
    this.isTranslatingElm.set(false);
    this.sqlText.set('');
    this.sqlResultsRaw.set('');
    this.measureReport.set(null);
    this.persistedMeasureReportId.set(null);
    this.persistedMeasureReportMeta.set(null);
    this.cqlPreview.set('');
    this.latestPopulationCounts = null;
    this.generateSqlResult.set(null);
    this.generateSqlError.set(null);
    this.executionParameters.set({});
    this.parameterDefaultsLibraryId = null;
    this.resourceTypesDefaultsLibraryId = null;
    this.patientDataFetchGeneration++;
    this.isLoadingPatientData.set(false);
    if (clearExecution) {
      this.executionResourceTypes.set(['Patient']);
      this.executionBundle.set(null);
      this.executionDataKey.set('');
      this.usingCms125Preset.set(false);
      this.bundledValueSets.set([]);
      this.cms125ValueSetsOnServer.set(false);
      this.cms125ValueSetPublishToken = null;
      this.selectedPatients.set([]);
    }
    this.patientSearchResults.set([]);
    this.clearExecuteStepStatus();
  }

  private clearExecuteStepStatus(): void {
    this.sqlExecutionStatus.set(null);
    this.measureReportStatus.set(null);
  }

  protected executeSql(): void {
    if (!this.canExecuteSql()) {
      return;
    }
    const elmJson = this.elmJsonRaw();
    if (!elmJson?.trim()) {
      return;
    }
    this.sqlExecutionStatus.set(null);
    this.measureReportStatus.set(null);
    this.measureReport.set(null);
    this.sqlExecuteFailed.set(false);
    this.isExecutingSql.set(true);

    void this.prepareExecutionSeedData(elmJson)
      .then(seedData => {
        if (!seedData) {
          this.isExecutingSql.set(false);
          return;
        }
        this.pipeline.executeSql(this.sqlText(), seedData).subscribe({
          next: result => {
            this.isExecutingSql.set(false);
            this.sqlResultsRaw.set(result.raw);
            this.latestPopulationCounts = result.counts;
            this.sqlExecuteFailed.set(false);
            this.toastService.showSuccess(`SQL executed in ${result.durationMs.toFixed(0)} ms.`, 'Execute SQL');
            this.generateMeasureReport();
          },
          error: (err: unknown) => {
            this.isExecutingSql.set(false);
            this.sqlExecuteFailed.set(true);
            const msg = err instanceof Error ? err.message : String(err);
            this.sqlExecutionStatus.set(`SQL execution failed: ${msg}`);
          },
        });
      })
      .catch((err: unknown) => {
        this.isExecutingSql.set(false);
        this.sqlExecuteFailed.set(true);
        const msg = err instanceof Error ? err.message : String(err);
        this.sqlExecutionStatus.set(`SQL execution failed: ${msg}`);
      });
  }

  private async prepareExecutionSeedData(elmJson: string) {
    const bundle = this.executionBundle();
    if (!bundle || !bundleHasClinicalResources(bundle)) {
      this.sqlExecutionStatus.set(
        'No clinical data selected — choose patients from the FHIR server or load the CMS125 preset bundle.',
      );
      this.sqlExecuteFailed.set(true);
      return null;
    }
    let bundledForRows = this.bundledValueSets();
    if (this.executionDataKey() === CMS125_DATA_KEY) {
      try {
        await this.ensureCms125ValueSetsOnServer(elmJson);
        bundledForRows = await this.resolveCms125BundledValueSets();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sqlExecutionStatus.set(`Value set loading failed: ${msg}`);
        this.sqlExecuteFailed.set(true);
        return null;
      }
    }
    const { rows, errors } = await this.executionDataService.prepareValueSetRows(elmJson, bundledForRows);
    if (errors.length) {
      this.sqlExecutionStatus.set(`Value set loading failed: ${errors.join('; ')}`);
      this.sqlExecuteFailed.set(true);
      return null;
    }
    const bundleKey = this.executionDataService.buildDataKeyFromBundle(bundle);
    const patientKey = this.executionDataKey();
    const dataKey = patientKey ? `${patientKey}|${bundleKey}` : bundleKey;
    return {
      dataKey,
      bundle,
      valueSetRows: rows,
    };
  }

  protected loadCms125Demo(): void {
    this.isLoadingDemo.set(true);
    this.demoLoadError.set(null);
    this.clearExecuteStepStatus();
    this.demoService.loadCms125().subscribe({
      next: content => {
        this.libraryLoadGeneration++;
        this.patientDataFetchGeneration++;
        this.clearPipelineOutputs(false);
        this.usingCms125Preset.set(true);
        this.selectedLibrary.set(content.library);
        this.selectedLibraryJson.set(JSON.stringify(content.library, null, 2));
        this.cqlPreview.set(content.cqlSource || decodeLibraryCql(content.library));
        this.executionBundle.set(content.bundle);
        this.executionDataKey.set(content.dataKey);
        this.bundledValueSets.set(content.valueSets);
        this.executionResourceTypes.set(resourceTypesInBundle(content.bundle));
        this.resourceTypesDefaultsLibraryId = content.library.id ?? null;
        this.selectedPatients.set([]);
        this.patientDataFetchGeneration++;
        void this.publishCms125DemoToServerInitial(content.valueSets, content.bundle).finally(() => {
          this.isLoadingDemo.set(false);
        });
      },
      error: (err: unknown) => {
        this.isLoadingDemo.set(false);
        const msg = err instanceof Error ? err.message : String(err);
        this.demoLoadError.set(`Failed to load CMS125 demo: ${msg}`);
      }
    });
  }

  protected selectWorkflowStep(step: SqlWorkflowStep): void {
    if (!this.canNavigateToStep(step)) {
      return;
    }
    this.activeStep.set(step);
  }

  protected canNavigateToStep(step: SqlWorkflowStep): boolean {
    const i = SQL_WORKFLOW_ORDER.indexOf(step);
    if (i <= 0) {
      return this.selectedLibrary() != null;
    }
    for (let j = 0; j < i; j++) {
      if (!this.stepSatisfied(SQL_WORKFLOW_ORDER[j])) {
        return false;
      }
    }
    return this.selectedLibrary() != null;
  }

  private stepSatisfied(step: SqlWorkflowStep): boolean {
    switch (step) {
      case 'library':
        return this.libraryStepComplete();
      case 'cql':
        return this.cqlStepComplete();
      case 'elm':
        return this.elmStepComplete();
      case 'sqlGen':
        return this.sqlGenStepComplete();
      case 'execute':
        return this.sqlGenStepComplete();
      default:
        return false;
    }
  }

  protected libraryStepComplete(): boolean {
    return !!this.selectedLibrary()?.id && this.selectedLibraryJson().trim().length > 0;
  }

  protected cqlStepComplete(): boolean {
    return this.libraryStepComplete() && this.cqlPreview().trim().length > 0;
  }

  protected elmStepComplete(): boolean {
    return (
      this.cqlStepComplete() &&
      !this.isTranslatingElm() &&
      !this.hasElmTranslationErrors() &&
      (this.elmXmlRaw()?.trim() ?? '').length > 0
    );
  }

  protected sqlGenStepComplete(): boolean {
    return this.elmStepComplete() && this.sqlText().trim().length > 0;
  }

  /** First step whose prerequisites are not fully satisfied (where the user should resume). */
  protected firstIncompleteStep(): SqlWorkflowStep | null {
    if (!this.libraryStepComplete()) {
      return 'library';
    }
    if (!this.cqlStepComplete()) {
      return 'cql';
    }
    if (!this.elmStepComplete()) {
      return 'elm';
    }
    if (!this.sqlGenStepComplete()) {
      return 'sqlGen';
    }
    return null;
  }

  protected workflowStepLabel(step: SqlWorkflowStep): string {
    const labels: Record<SqlWorkflowStep, string> = {
      library: 'FHIR Library',
      cql: 'Decoded CQL',
      elm: 'ELM Translation',
      sqlGen: 'Generated SQL',
      execute: 'Execute SQL'
    };
    return labels[step];
  }

  protected workflowStepStatus(step: SqlWorkflowStep): 'locked' | 'loading' | 'ok' | 'warn' | 'error' {
    if (!this.canNavigateToStep(step)) {
      return 'locked';
    }
    switch (step) {
      case 'library':
        return this.libraryStepComplete() ? 'ok' : 'warn';
      case 'cql':
        return this.cqlPreview().trim() ? 'ok' : 'warn';
      case 'elm':
        if (this.isTranslatingElm()) {
          return 'loading';
        }
        if (this.hasElmTranslationErrors()) {
          return 'error';
        }
        if (!this.formattedElmXml()) {
          return this.cqlPreview().trim() ? 'warn' : 'warn';
        }
        return this.hasElmTranslationWarnings() ? 'warn' : 'ok';
      case 'sqlGen':
        return this.sqlText().trim() ? 'ok' : 'warn';
      case 'execute':
        if (this.sqlExecuteFailed()) {
          return 'error';
        }
        return this.sqlResultsRaw().trim() ? 'ok' : 'warn';
      default:
        return 'warn';
    }
  }

  protected workflowStepIconClasses(step: SqlWorkflowStep): string {
    const s = this.workflowStepStatus(step);
    switch (s) {
      case 'locked':
        return 'bi bi-lock-fill text-muted';
      case 'loading':
        return 'bi bi-hourglass-split text-primary';
      case 'ok':
        return 'bi bi-check-circle-fill text-success';
      case 'warn':
        return 'bi bi-exclamation-triangle-fill text-warning';
      case 'error':
        return 'bi bi-x-circle-fill text-danger';
      default:
        return 'bi bi-circle text-muted';
    }
  }

  protected generateMeasureReport(): void {
    const lib = this.selectedLibrary();
    const counts = this.latestPopulationCounts;
    if (!counts) {
      this.measureReportStatus.set('Run "Execute SQL" first — no population counts available yet.');
      return;
    }
    this.measureReportStatus.set(null);
    this.pipeline.generateMeasureReport(counts, lib, this.executionParameters()).subscribe({
      next: r => {
        this.measureReport.set(r);
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.measureReportStatus.set(`MeasureReport generation failed: ${msg}`);
      }
    });
  }

  protected saveMeasureReport(): void {
    const r = this.measureReport();
    if (!r) {
      this.measureReportStatus.set('Nothing to save.');
      return;
    }
    this.measureReportStatus.set(null);
    this.pipeline.saveMeasureReport(
      r,
      this.persistedMeasureReportId(),
      this.persistedMeasureReportMeta(),
    ).subscribe({
      next: saved => {
        this.measureReport.set(saved);
        if (saved.id) {
          this.persistedMeasureReportId.set(saved.id);
        }
        if (saved.meta) {
          this.persistedMeasureReportMeta.set(saved.meta);
        }
        this.toastService.showSuccess(`MeasureReport saved (id: ${saved.id ?? 'unknown'}).`, 'Save');
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.measureReportStatus.set(`MeasureReport save failed: ${msg}`);
      }
    });
  }

  protected getLibraryDisplayName(library: Library): string {
    return library.name || library.id || 'Unknown';
  }

  protected getLibraryVersion(library: Library): string {
    return library.version || 'N/A';
  }

  protected getPageNumbers(): (number | string)[] {
    const totalPages = this.totalPages();
    const currentPage = this.currentPage();
    const pages: (number | string)[] = [];
    const maxVisiblePages = 5;
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      if (currentPage > 3) {
        pages.push('...');
      }
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) {
        if (i !== 1 && i !== totalPages) {
          pages.push(i);
        }
      }
      if (currentPage < totalPages - 2) {
        pages.push('...');
      }
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }
    return pages;
  }

  protected onPageClick(page: number | string): void {
    if (typeof page === 'number') {
      this.goToPage(page);
    }
  }

  protected trackByLibraryId(_index: number, library: Library): string {
    return library.id ?? _index.toString();
  }

  protected readonly hasElmTranslationErrors = computed(() => this.elmTranslationErrors().length > 0);
  protected readonly hasElmTranslationWarnings = computed(() => this.elmTranslationWarnings().length > 0);

  protected readonly bundleHasClinicalResources = bundleHasClinicalResources;

  protected onPatientSearchTermChange(term: string): void {
    this.patientSearchTerm.set(term);
    this.patientSearchTrigger.next(term);
  }

  protected onPatientSearchNow(): void {
    const term = this.patientSearchTerm().trim();
    if (term.length === 0) {
      this.patientSearchResults.set([]);
      this.patientSearchError.set(null);
      return;
    }
    this.isLoadingPatients.set(true);
    this.patientSearchError.set(null);
    this.patientService.search(term).subscribe({
      next: bundle => {
        this.isLoadingPatients.set(false);
        const patients =
          bundle.entry
            ?.map(e => e.resource)
            .filter((r): r is Patient => isResourceType(r, 'Patient')) ?? [];
        this.patientSearchResults.set(patients);
      },
      error: (err: unknown) => {
        this.isLoadingPatients.set(false);
        const msg = err instanceof Error ? err.message : String(err);
        this.patientSearchError.set(msg);
        this.patientSearchResults.set([]);
      },
    });
  }

  protected togglePatient(patient: Patient): void {
    const current = this.selectedPatients();
    const exists = current.some(p => p.id === patient.id);
    const next = exists ? current.filter(p => p.id !== patient.id) : [...current, patient];
    if (this.usingCms125Preset() && !exists) {
      this.usingCms125Preset.set(false);
      this.executionBundle.set(null);
      this.executionDataKey.set('');
      this.bundledValueSets.set([]);
      this.cms125ValueSetsOnServer.set(false);
      this.cms125ValueSetPublishToken = null;
    } else if (!this.usingCms125Preset()) {
      this.bundledValueSets.set([]);
    }
    this.selectedPatients.set(next);
  }

  protected removeSelectedPatient(patientId: string): void {
    const next = this.selectedPatients().filter(p => p.id !== patientId);
    this.selectedPatients.set(next);
    if (!this.usingCms125Preset()) {
      this.bundledValueSets.set([]);
    }
  }

  protected onExecutionResourceTypesChange(types: string[]): void {
    const withPatient = types.includes('Patient') ? types : ['Patient', ...types];
    this.executionResourceTypes.set([...new Set(withPatient)].sort());
  }

  protected toggleExecutionResourceType(type: string, checked: boolean): void {
    if (type === 'Patient' && !checked) {
      return;
    }
    const current = new Set(this.executionResourceTypes());
    if (checked) {
      current.add(type);
    } else {
      current.delete(type);
    }
    this.onExecutionResourceTypesChange([...current]);
  }

  protected setAllNonPatientResourceTypes(selected: boolean): void {
    const derived = this.derivedResourceTypes().filter(t => t !== 'Patient');
    const next = selected
      ? [...new Set([...this.executionResourceTypes(), ...derived, 'Patient'])]
      : ['Patient'];
    this.onExecutionResourceTypesChange(next);
  }

  protected isExecutionResourceTypeSelected(type: string): boolean {
    return this.executionResourceTypes().includes(type);
  }

  protected isPatientSelected(patient: Patient): boolean {
    return this.selectedPatients().some(p => p.id === patient.id);
  }

  protected getPatientDisplayName(patient: Patient): string {
    const name = patient.name?.[0];
    if (name?.text) {
      return name.text;
    }
    const given = name?.given?.join(' ') ?? '';
    const family = name?.family ?? '';
    return `${given} ${family}`.trim() || patient.id || 'Patient';
  }

  private async refreshExecutionBundleFromPatients(
    patients: Patient[],
    resourceTypes: string[],
  ): Promise<void> {
    const generation = ++this.patientDataFetchGeneration;
    if (patients.length === 0) {
      if (generation !== this.patientDataFetchGeneration) {
        return;
      }
      if (this.usingCms125Preset()) {
        return;
      }
      this.executionBundle.set(null);
      this.executionDataKey.set('');
      this.isLoadingPatientData.set(false);
      return;
    }
    this.isLoadingPatientData.set(true);
    try {
      const bundle = await this.executionDataService.buildBundleFromPatients(patients, {
        resourceTypes,
      });
      if (generation !== this.patientDataFetchGeneration) {
        return;
      }
      this.executionBundle.set(bundle);
      this.executionDataKey.set(
        this.executionDataService.buildDataKeyFromPatients(patients, resourceTypes),
      );
    } catch (err: unknown) {
      if (generation !== this.patientDataFetchGeneration) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.sqlExecutionStatus.set(`Failed to load patient data: ${msg}`);
      this.executionBundle.set(null);
      this.executionDataKey.set('');
    } finally {
      if (generation === this.patientDataFetchGeneration) {
        this.isLoadingPatientData.set(false);
      }
    }
  }

  protected setParameterValue(name: string, value: ParameterValue): void {
    this.executionParameters.update(v => ({ ...v, [name]: value }));
  }

  protected setPeriodField(name: string, field: 'start' | 'end', localValue: string): void {
    const current = this.executionParameters()[name];
    const iso = localValue ? `${localValue}:00.000Z` : '';
    if (current?.kind === 'period') {
      this.setParameterValue(name, {
        kind: 'period',
        start: field === 'start' ? iso : current.start,
        end: field === 'end' ? iso : current.end,
      });
    } else {
      this.setParameterValue(name, {
        kind: 'period',
        start: field === 'start' ? iso : '',
        end: field === 'end' ? iso : '',
      });
    }
  }

  protected periodFieldValue(name: string, field: 'start' | 'end'): string {
    const v = this.executionParameters()[name];
    if (v?.kind !== 'period') {
      return '';
    }
    const iso = field === 'start' ? v.start : v.end;
    return iso?.length >= 16 ? iso.slice(0, 16) : iso;
  }

  protected setScalarParameter(name: string, kind: 'string' | 'boolean' | 'integer' | 'decimal' | 'dateTime', raw: string | boolean): void {
    switch (kind) {
      case 'string':
        this.setParameterValue(name, { kind: 'string', value: String(raw) });
        break;
      case 'boolean':
        this.setParameterValue(name, { kind: 'boolean', value: Boolean(raw) });
        break;
      case 'integer':
        this.setParameterValue(name, { kind: 'integer', value: Number.parseInt(String(raw), 10) || 0 });
        break;
      case 'decimal':
        this.setParameterValue(name, { kind: 'decimal', value: Number.parseFloat(String(raw)) || 0 });
        break;
      case 'dateTime':
        this.setParameterValue(name, {
          kind: 'dateTime',
          value: raw ? `${String(raw)}:00.000Z` : new Date().toISOString(),
        });
        break;
    }
  }

  protected scalarParameterValue(name: string, kind: 'string' | 'integer' | 'decimal'): string | number {
    const v = this.executionParameters()[name];
    if (v?.kind === kind) {
      return v.value;
    }
    return kind === 'string' ? '' : 0;
  }

  protected booleanParameterValue(name: string): boolean {
    const v = this.executionParameters()[name];
    return v?.kind === 'boolean' ? v.value : false;
  }

  protected dateTimeParameterValue(name: string): string {
    const v = this.executionParameters()[name];
    if (v?.kind === 'dateTime' && v.value.length >= 16) {
      return v.value.slice(0, 16);
    }
    return v?.kind === 'dateTime' ? v.value : '';
  }

  private async resolveCms125BundledValueSets(): Promise<ValueSet[]> {
    const bundled = this.bundledValueSets();
    if (bundled.length > 0) {
      return bundled;
    }
    const loaded = await firstValueFrom(this.demoService.loadCms125ValueSets());
    this.bundledValueSets.set(loaded);
    return loaded;
  }

  private buildCms125ValueSetsForServer(elmJson: string, bundled: ValueSet[]): ValueSet[] {
    const parsed = JSON.parse(elmJson) as { library?: unknown };
    const wrapper = 'library' in parsed ? parsed : { library: parsed };
    const refs = extractValueSets(wrapper as Parameters<typeof extractValueSets>[0]);
    return expandValueSetsForServerPublish(refs, bundled);
  }

  private async ensureCms125ValueSetsOnServer(elmJson: string): Promise<void> {
    if (this.cms125ValueSetsOnServer()) {
      return;
    }
    const bundled = await this.resolveCms125BundledValueSets();
    const toPublish = this.buildCms125ValueSetsForServer(elmJson, bundled);
    if (toPublish.length === 0) {
      throw new Error('No CMS125 value sets matched the translated ELM library');
    }
    await this.executionDataService.publishValueSetsToServer(toPublish);
    this.cms125ValueSetsOnServer.set(true);
  }

  private async publishCms125DemoToServerInitial(bundled: ValueSet[], bundle: Bundle): Promise<void> {
    try {
      const toPublish = bundledValueSetsForServerPublish(bundled);
      await this.executionDataService.publishValueSetsToServer(toPublish);
      await this.executionDataService.publishBundleToServer(bundle);
      this.cms125ValueSetsOnServer.set(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.demoLoadError.set(
        `CMS125 demo loaded locally, but upload to the FHIR server failed: ${msg}`,
      );
    }
  }

  private async publishCms125ValueSetsToServer(
    elmJson: string,
    bundled: ValueSet[],
    token: string,
  ): Promise<void> {
    try {
      const toPublish = this.buildCms125ValueSetsForServer(elmJson, bundled);
      if (toPublish.length === 0) {
        this.cms125ValueSetPublishToken = null;
        return;
      }
      await this.executionDataService.publishValueSetsToServer(toPublish);
      this.cms125ValueSetsOnServer.set(true);
    } catch (err: unknown) {
      this.cms125ValueSetPublishToken = null;
      const msg = err instanceof Error ? err.message : String(err);
      this.demoLoadError.set(`CMS125 ValueSet upload failed after ELM translation: ${msg}`);
    } finally {
      if (this.cms125ValueSetPublishToken !== token) {
        return;
      }
    }
  }
}
