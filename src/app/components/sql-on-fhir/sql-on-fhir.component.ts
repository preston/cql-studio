// Author: Preston Lee

import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Bundle, Library, MeasureReport } from 'fhir/r4';
import { LibraryService } from '../../services/library.service';
import { SqlOnFhirPipelineService } from '../../services/sql-on-fhir-pipeline.service';
import { TranslationService } from '../../services/translation.service';
import { formatElmXml } from './format-elm-xml';
import { SqlPipelineCqlStepComponent } from './pipeline-steps/sql-pipeline-cql-step.component';
import { SqlPipelineElmStepComponent } from './pipeline-steps/sql-pipeline-elm-step.component';
import { SqlPipelineExecuteStepComponent } from './pipeline-steps/sql-pipeline-execute-step.component';
import { SqlPipelineLibraryStepComponent } from './pipeline-steps/sql-pipeline-library-step.component';
import { SqlPipelineSqlGenStepComponent } from './pipeline-steps/sql-pipeline-sql-gen-step.component';

export type SqlWorkflowStep = 'library' | 'cql' | 'elm' | 'sqlGen' | 'execute';

const SQL_WORKFLOW_ORDER: SqlWorkflowStep[] = ['library', 'cql', 'elm', 'sqlGen', 'execute'];

@Component({
  selector: 'app-sql-on-fhir',
  standalone: true,
  imports: [
    CommonModule,
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

  private elmRunId = 0;
  private sqlRunId = 0;
  /** Bumps when selection is cleared or a new library load starts; stale HTTP callbacks no-op. */
  private libraryLoadGeneration = 0;

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
  /** Set true when stub executeSql subscribe errors; cleared on success and pipeline clear. */
  protected readonly sqlExecuteFailed = signal(false);
  protected readonly measureReport = signal<MeasureReport | null>(null);
  protected readonly pipelineStatus = signal<string | null>(null);

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

  constructor() {
    effect(() => {
      const lib = this.selectedLibrary();
      const cql = this.cqlPreview().trim();
      if (!lib?.id) {
        this.elmRunId++;
        this.elmXmlRaw.set(null);
        this.elmTranslationErrors.set([]);
        this.elmTranslationWarnings.set([]);
        this.elmTranslationMessages.set([]);
        this.isTranslatingElm.set(false);
        return;
      }
      if (!cql) {
        this.elmXmlRaw.set(null);
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
        .ensureTranslationAssetsLoaded()
        .then(() => {
          if (runId !== this.elmRunId) {
            return;
          }
          const result = this.translationService.translateCqlToElm(cql);
          if (runId !== this.elmRunId) {
            return;
          }
          this.isTranslatingElm.set(false);
          this.elmXmlRaw.set(result.elmXml ?? '');
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
          const msg = e instanceof Error ? e.message : String(e);
          this.elmTranslationErrors.set([`Failed to load translation assets: ${msg}`]);
          this.elmTranslationWarnings.set([]);
          this.elmTranslationMessages.set([]);
        });
    });

    effect(() => {
      const lib = this.selectedLibrary();
      const elm = this.elmXmlRaw();
      if (!lib?.id || elm == null || elm.trim() === '') {
        this.sqlRunId++;
        this.sqlText.set('');
        return;
      }
      const runId = ++this.sqlRunId;
      this.pipeline.generateSql(elm, lib).subscribe({
        next: sql => {
          if (runId !== this.sqlRunId) {
            return;
          }
          this.sqlText.set(sql);
        },
        error: () => {
          if (runId !== this.sqlRunId) {
            return;
          }
          this.sqlText.set('');
        }
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
        next: (bundle: Bundle<Library>) => {
          this.isLoadingLibraries.set(false);
          this.paginatedLibraries.set(
            bundle.entry ? bundle.entry.map(e => e.resource!).filter(Boolean) : []
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

  private applyBundlePagination(bundle: Bundle<Library>): void {
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
        next: (bundle: Bundle<Library>) => {
          this.isLoadingLibraries.set(false);
          this.paginatedLibraries.set(
            bundle.entry ? bundle.entry.map(e => e.resource!).filter(Boolean) : []
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

    this.pipelineStatus.set(null);
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
        this.pipelineStatus.set(this.errorMessage(err));
        this.selectedLibrary.set(null);
        this.selectedLibraryJson.set('');
      }
    });
  }

  private clearLibrarySelection(): void {
    this.libraryLoadGeneration++;
    this.pipelineStatus.set(null);
    this.clearPipelineOutputs();
    this.selectedLibrary.set(null);
    this.selectedLibraryJson.set('');
  }

  private clearPipelineOutputs(): void {
    this.elmRunId++;
    this.sqlRunId++;
    this.activeStep.set('library');
    this.sqlExecuteFailed.set(false);
    this.elmXmlRaw.set(null);
    this.elmTranslationErrors.set([]);
    this.elmTranslationWarnings.set([]);
    this.elmTranslationMessages.set([]);
    this.isTranslatingElm.set(false);
    this.sqlText.set('');
    this.sqlResultsRaw.set('');
    this.measureReport.set(null);
    this.cqlPreview.set('');
  }

  protected executeSql(): void {
    this.pipelineStatus.set(null);
    this.sqlExecuteFailed.set(false);
    this.pipeline.executeSql(this.sqlText()).subscribe({
      next: raw => {
        this.sqlResultsRaw.set(raw);
        this.sqlExecuteFailed.set(false);
        this.pipelineStatus.set('SQL execution (stub) completed.');
      },
      error: () => {
        this.sqlExecuteFailed.set(true);
        this.pipelineStatus.set('SQL execution stub failed.');
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
    this.pipelineStatus.set(null);
    this.pipeline.generateMeasureReport(this.sqlResultsRaw(), lib).subscribe({
      next: r => {
        this.measureReport.set(r);
        this.pipelineStatus.set('MeasureReport (stub) generated.');
      },
      error: () => this.pipelineStatus.set('MeasureReport stub failed.')
    });
  }

  protected saveMeasureReport(): void {
    const r = this.measureReport();
    if (!r) {
      this.pipelineStatus.set('Nothing to save.');
      return;
    }
    this.pipelineStatus.set(null);
    this.pipeline.saveMeasureReport(r).subscribe({
      next: saved => {
        this.measureReport.set(saved);
        this.pipelineStatus.set('MeasureReport save (stub) succeeded.');
      },
      error: () => this.pipelineStatus.set('MeasureReport save stub failed.')
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
}
