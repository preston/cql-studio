// Author: Preston Lee

import { afterNextRender, Component, computed, inject, Injector, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { SettingsService } from '../../services/settings.service';
import { FhirPackageRegistryService } from '../../services/fhir-package-registry.service';
import { FhirPackageMetadataService } from '../../services/fhir-package-metadata.service';
import {
  FhirPackageLoadService,
  ParsedFhirPackageTarball
} from '../../services/fhir-package-load.service';
import { FhirPackageDependencyResolverService } from '../../services/fhir-package-dependency-resolver.service';
import { FhirPackageImportService } from '../../services/fhir-package-import.service';
import {
  FhirNpmPackageManifest,
  FhirPackageCatalogEntry,
  FhirPackageJson
} from '../../models/fhir-package-registry.types';
import { IndexedResourceRowVm } from '../../models/fhir-package-view.model';
import {
  PackageImportState,
  PackageLoadStatus,
  RegistryImportResultRow,
  RegistryImportResultSortColumn,
  ResolvedPackageNode
} from '../../models/fhir-package-import.types';
import { packageInstanceKey } from '../../services/fhir-package-dependency-resolver.lib';
import { FhirPackageLocalUploadStagingService } from '../../services/fhir-package-local-upload-staging.service';
import {
  FHIR_REGISTRY_IMPORTER_QUERY_PACKAGE,
  FHIR_REGISTRY_IMPORTER_QUERY_SOURCE,
  FHIR_REGISTRY_IMPORTER_QUERY_VERSION,
  FHIR_REGISTRY_IMPORTER_SOURCE_LOCAL
} from './fhir-registry-importer.deep-link';
import { ImplementationGuidePanelComponent } from '../shared/implementation-guide-panel/implementation-guide-panel.component';
import { ImplementationGuide } from 'fhir/r4';
import {
  defaultSelectedIgEntryKeys,
  enrichIgEntriesForArchive,
  IgResourceEntryVm,
  isDefaultIgImportableResourceType,
  parseImplementationGuideEntries,
  parseImplementationGuideFromPackageFiles
} from '../../services/implementation-guide.lib';
import { IgImportSanitizeOptions } from '../../services/fhir-package-import.service';
import { isConformanceResourceType } from '../../services/fhir-resource-endpoint.lib';

type QuickFilter = 'all' | 'terminology' | 'conformance' | 'examples';

function isFhirPackageArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.tgz') || lower.endsWith('.tar.gz');
}

const LOAD_STATUS_LABEL: Record<PackageLoadStatus, string> = {
  pending: 'Not loaded',
  loading: 'Loading',
  loaded: 'Loaded',
  error: 'Error'
};

const DOM_IMPORT_WORKSPACE = 'fhir-registry-importer-import-workspace';
const DOM_PACKAGE_DETAIL = 'fhir-registry-importer-package-detail-panel';

@Component({
  selector: 'app-fhir-registry-importer',
  imports: [NgTemplateOutlet, FormsModule, ImplementationGuidePanelComponent],

  templateUrl: './fhir-registry-importer.component.html'
})
export class FhirRegistryImporterComponent {
  protected readonly catalogFhirVersionOptions: { label: string; value: string | null }[] = [
    { label: 'Any', value: null },
    { label: 'R4', value: 'R4' },
    { label: 'R5', value: 'R5' },
    { label: 'R6', value: 'R6' },
    { label: 'STU3', value: 'STU3' },
    { label: 'DSTU2', value: 'DSTU2' }
  ];

  private readonly settingsService = inject(SettingsService);
  private readonly registryService = inject(FhirPackageRegistryService);
  private readonly metadataService = inject(FhirPackageMetadataService);
  private readonly packageLoadService = inject(FhirPackageLoadService);
  private readonly dependencyResolver = inject(FhirPackageDependencyResolverService);
  private readonly packageImportService = inject(FhirPackageImportService);
  private readonly packageStaging = inject(FhirPackageLocalUploadStagingService);
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute);

  protected readonly searchQuery = signal('');
  protected readonly catalogFhirVersionFilter = signal<string | null>(null);
  protected readonly searchLoading = signal(false);
  protected readonly searchError = signal<string | null>(null);
  protected readonly catalogResults = signal<FhirPackageCatalogEntry[]>([]);

  protected readonly manifestLoading = signal(false);
  protected readonly manifestError = signal<string | null>(null);
  protected readonly selectedPackageId = signal<string | null>(null);
  protected readonly manifest = signal<FhirNpmPackageManifest | null>(null);

  protected readonly selectedVersion = signal<string | null>(null);
  protected readonly packageLoading = signal(false);
  protected readonly packageError = signal<string | null>(null);

  /** Resolved dependency graph (null until Resolve or root-only). */
  protected readonly resolvedNodes = signal<Map<string, ResolvedPackageNode> | null>(null);
  /** Import-safe order of package names (dependencies first). */
  protected readonly importOrderNames = signal<string[]>([]);
  protected readonly resolveBusy = signal(false);
  protected readonly dependencyWarnings = signal<string[]>([]);
  protected readonly dependencyErrors = signal<string[]>([]);

  protected readonly packagesByName = signal<Map<string, PackageImportState>>(new Map());
  /** Canonical NPM name for the root package (from tarball package.json). */
  protected readonly rootPackageName = signal<string | null>(null);
  protected readonly activePackageName = signal<string | null>(null);
  protected readonly findPackagesExpanded = signal(true);
  /** When set, root package came from a local `.tgz` (not the registry). */
  protected readonly localSourceFileName = signal<string | null>(null);
  protected readonly localPackageLoading = signal(false);
  protected readonly localPackageError = signal<string | null>(null);

  protected readonly igSanitizeBeforeImport = signal(true);
  /**
   * Per package-instance (`packageKey`) IG selection so switching packages/versions doesn't lose
   * review state or apply another version's keys.
   */
  private readonly igSelectionByPackage = signal<
    Map<string, { entryKeys: ReadonlySet<string>; globalIndices: ReadonlySet<number> }>
  >(new Map());
  protected readonly igSelectedEntryKeys = computed<ReadonlySet<string>>(() => {
    const key = this.activeIgSelectionKey();
    return (key && this.igSelectionByPackage().get(key)?.entryKeys) || new Set();
  });
  protected readonly igSelectedGlobalIndices = computed<ReadonlySet<number>>(() => {
    const key = this.activeIgSelectionKey();
    return (key && this.igSelectionByPackage().get(key)?.globalIndices) || new Set();
  });

  /** Last deep-link key applied from query params (avoids reload loops). */
  private lastAppliedDeepLinkKey: string | null = null;
  private deepLinkGeneration = 0;
  /** Bumped on workspace reset so in-flight tarball loads don't write into a new plan. */
  private workspaceGeneration = 0;
  /** In-flight package loads so concurrent callers await the same promise. */
  private readonly packageLoadPromises = new Map<string, Promise<void>>();

  constructor() {
    // Supports in-app navigation and direct/external URLs such as:
    // /fhir-registry-importer?package=hl7.fhir.us.core&version=6.1.0
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.applyDeepLinkFromQueryParams(params);
    });
  }

  protected readonly quickFilter = signal<QuickFilter>('all');
  protected readonly includeExamples = signal(false);

  protected readonly importing = signal(false);
  protected readonly importProgress = signal<string | null>(null);
  protected readonly importResultsRows = signal<RegistryImportResultRow[]>([]);
  protected readonly importResultOutcomeFilter = signal<'all' | 'errors' | 'success'>('all');
  protected readonly importResultSearch = signal('');
  protected readonly importResultSortColumn = signal<RegistryImportResultSortColumn>('packageName');
  protected readonly importResultSortAsc = signal(true);

  protected readonly importResultsFilteredSorted = computed(() => {
    let rows = [...this.importResultsRows()];
    const f = this.importResultOutcomeFilter();
    if (f === 'errors') {
      rows = rows.filter((r) => !r.ok);
    } else if (f === 'success') {
      rows = rows.filter((r) => r.ok);
    }
    const q = this.importResultSearch().trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [
          r.packageName,
          r.channel,
          r.resourceType,
          r.resourceId,
          r.filename,
          r.message,
          r.ok ? 'ok' : 'error'
        ].some((s) => s.toLowerCase().includes(q))
      );
    }
    const col = this.importResultSortColumn();
    const asc = this.importResultSortAsc();
    const dir = asc ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      if (col === 'ok') {
        cmp = (a.ok ? 1 : 0) - (b.ok ? 1 : 0);
      } else {
        const sa = this.importResultSortValue(a, col);
        const sb = this.importResultSortValue(b, col);
        cmp = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
      }
      return cmp * dir;
    });
    return rows;
  });

  protected readonly importResultCounts = computed(() => {
    const rows = this.importResultsRows();
    const ok = rows.filter((r) => r.ok).length;
    const bad = rows.length - ok;
    return { total: rows.length, ok, errors: bad };
  });

  protected readonly activePackage = computed(() => {
    const n = this.activePackageName();
    if (!n) {
      return null;
    }
    return this.packagesByName().get(n) ?? null;
  });

  protected readonly activeImplementationGuide = computed((): ImplementationGuide | null => {
    const st = this.activePackage();
    if (!st || st.loadStatus !== 'loaded') {
      return null;
    }
    return parseImplementationGuideFromPackageFiles(st.rows, st.files);
  });

  protected readonly activeIgEntries = computed((): IgResourceEntryVm[] => {
    const ig = this.activeImplementationGuide();
    const st = this.activePackage();
    if (!ig || !st) {
      return [];
    }
    return enrichIgEntriesForArchive(parseImplementationGuideEntries(ig), st.rows);
  });

  protected readonly activeIgRow = computed(() => {
    const st = this.activePackage();
    return st?.rows.find((r) => r.resourceType === 'ImplementationGuide') ?? null;
  });

  protected readonly filteredRows = computed(() => {
    const st = this.activePackage();
    if (!st) {
      return [];
    }
    let rows = st.rows;
    if (!this.includeExamples()) {
      rows = rows.filter((r) => !r.isExample);
    }
    const q = this.quickFilter();
    if (q === 'terminology') {
      rows = rows.filter((r) => r.suggestedTarget === 'terminology');
    } else if (q === 'conformance') {
      rows = rows.filter((r) => r.suggestedTarget === 'data');
    } else if (q === 'examples') {
      rows = rows.filter((r) => r.isExample);
    }
    return rows;
  });

  /** Rows flagged as examples via package.json `directories` (for counts and toolbar). */
  protected readonly activePackageExampleRows = computed(() => {
    const st = this.activePackage();
    if (!st) {
      return [];
    }
    return st.rows.filter((r) => r.isExample);
  });

  protected readonly resourceTypeCounts = computed(() =>
    this.metadataService.countByResourceType(this.filteredRows())
  );

  protected readonly selectionSummary = computed(() => {
    let terminology = 0;
    let data = 0;
    for (const st of this.packagesByName().values()) {
      if (!st.includePackage || st.loadStatus !== 'loaded') {
        continue;
      }
      for (const r of st.rows) {
        if (!r.selected) {
          continue;
        }
        if (r.targetTerminology) {
          terminology++;
        }
        if (r.targetData) {
          data++;
        }
      }
    }
    const tu = this.settingsService.getEffectiveTerminologyEndpointAddress().replace(/\/+$/, '');
    const fu = this.settingsService.getEffectiveDataEndpointAddress().replace(/\/+$/, '');
    const merged = terminology > 0 && data > 0 && tu === fu;
    return { terminology, data, mergedSingleEndpoint: merged };
  });

  protected readonly planList = computed(() => {
    const order = this.importOrderNames();
    const map = this.packagesByName();
    return order.map((name) => map.get(name)).filter((x): x is PackageImportState => !!x);
  });

  protected readonly hasImportWorkspace = computed(
    () => this.manifest() != null || this.localSourceFileName() != null
  );

  protected readonly includedPlanCount = computed(
    () => this.planList().filter((p) => p.includePackage).length
  );

  protected readonly planTotalCount = computed(() => this.planList().length);

  /** True when every package with Import enabled has its tarball loaded (required before Import selected). */
  protected readonly includedPackagesPreloaded = computed(() => {
    for (const p of this.planList()) {
      if (!p.includePackage) {
        continue;
      }
      if (p.loadStatus !== 'loaded') {
        return false;
      }
    }
    return true;
  });

  getEffectiveRegistryBase(): string {
    return this.settingsService.getEffectiveFhirPackageRegistryBaseUrl();
  }

  protected selectedResourceCountForPackage(name: string): number {
    const st = this.packagesByName().get(name);
    if (!st?.includePackage || st.loadStatus !== 'loaded') {
      return 0;
    }
    return st.rows.filter((r) => r.selected).length;
  }

  protected packageLoadStatusLabel(st: PackageImportState): string {
    return LOAD_STATUS_LABEL[st.loadStatus];
  }

  scrollToImportWorkspace(): void {
    this.scrollElementIntoView(DOM_IMPORT_WORKSPACE, { behavior: 'smooth', block: 'start' });
  }

  scrollToPackagePlanRow(name: string): void {
    this.scrollElementIntoView(`fhir-registry-importer-package-plan-${name}`, {
      behavior: 'smooth',
      block: 'nearest'
    });
  }

  async navigateToPackageConfigure(name: string): Promise<void> {
    await this.selectPlanPackage(name);
    afterNextRender(
      () => {
        this.scrollElementIntoView(DOM_PACKAGE_DETAIL, { behavior: 'smooth', block: 'start' });
      },
      { injector: this.injector }
    );
  }

  private scrollElementIntoView(elementId: string, options: ScrollIntoViewOptions): void {
    document.getElementById(elementId)?.scrollIntoView(options);
  }

  setCatalogFhirVersion(value: string | null): void {
    this.catalogFhirVersionFilter.set(value);
  }

  toggleFindPackagesExpanded(): void {
    this.findPackagesExpanded.update((v) => !v);
  }

  async onSearch(): Promise<void> {
    const q = this.searchQuery().trim();
    const fv = this.catalogFhirVersionFilter();
    if (!q && !fv) {
      this.searchError.set(
        'Enter a package name substring and/or choose a FHIR version filter (registry catalog API).'
      );
      return;
    }
    this.searchLoading.set(true);
    this.searchError.set(null);
    this.catalogResults.set([]);
    try {
      const list = await this.registryService.searchCatalog(q, fv);
      this.catalogResults.set(list);
      if (list.length === 0) {
        this.searchError.set(
          'No packages found. Try a shorter substring, another FHIR version, or browse registry.fhir.org.'
        );
      }
    } catch (e) {
      this.searchError.set(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      this.searchLoading.set(false);
    }
  }

  async selectCatalogEntry(entry: FhirPackageCatalogEntry): Promise<void> {
    await this.openPackage(entry.Name);
  }

  /**
   * Deep-link entry point for query params from Examples, Uploader, or external systems.
   * Supports `package` (+ optional `version`) for registry loads, or `source=local` for staged `.tgz`.
   */
  private applyDeepLinkFromQueryParams(params: ParamMap): void {
    const source = params.get(FHIR_REGISTRY_IMPORTER_QUERY_SOURCE)?.trim();
    if (source === FHIR_REGISTRY_IMPORTER_SOURCE_LOCAL) {
      const staged = this.packageStaging.peek();
      const key = staged
        ? `source=local\0${staged.fileName}\0${staged.bytes.byteLength}`
        : 'source=local\0empty';
      if (key === this.lastAppliedDeepLinkKey) {
        return;
      }
      this.lastAppliedDeepLinkKey = key;
      const generation = ++this.deepLinkGeneration;
      void this.consumeStagedLocalPackage().then((ok) => {
        if (generation !== this.deepLinkGeneration) {
          return;
        }
        if (!ok) {
          this.lastAppliedDeepLinkKey = null;
          return;
        }
        this.findPackagesExpanded.set(false);
        afterNextRender(
          () => {
            this.scrollToImportWorkspace();
          },
          { injector: this.injector }
        );
      });
      return;
    }

    const packageId = params.get(FHIR_REGISTRY_IMPORTER_QUERY_PACKAGE)?.trim();
    if (!packageId) {
      return;
    }
    const version = params.get(FHIR_REGISTRY_IMPORTER_QUERY_VERSION)?.trim() || null;
    const key = `${packageId}\0${version ?? ''}`;
    if (key === this.lastAppliedDeepLinkKey) {
      return;
    }
    this.lastAppliedDeepLinkKey = key;
    const generation = ++this.deepLinkGeneration;
    void this.openPackage(packageId, version).then((ok) => {
      if (generation !== this.deepLinkGeneration) {
        return;
      }
      if (!ok) {
        // Allow the same deep-link to be retried after a failed load.
        this.lastAppliedDeepLinkKey = null;
        return;
      }
      this.findPackagesExpanded.set(false);
      afterNextRender(
        () => {
          this.scrollToImportWorkspace();
        },
        { injector: this.injector }
      );
    });
  }

  private async consumeStagedLocalPackage(): Promise<boolean> {
    const staged = this.packageStaging.consume();
    if (!staged) {
      this.localPackageError.set(
        'No local FHIR package was staged. Upload a .tgz from the FHIR Uploader or choose a file below.'
      );
      return false;
    }
    return this.loadLocalPackageBytes(staged.fileName, staged.bytes);
  }

  async onLocalPackageFileSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    input.value = '';
    await this.loadLocalPackageFile(file);
  }

  async loadLocalPackageFile(file: File): Promise<boolean> {
    this.localPackageError.set(null);
    if (!isFhirPackageArchiveName(file.name)) {
      this.localPackageError.set('Please choose a FHIR package archive (.tgz or .tar.gz).');
      return false;
    }
    this.localPackageLoading.set(true);
    try {
      const bytes = await file.arrayBuffer();
      const ok = await this.loadLocalPackageBytes(file.name, bytes);
      if (ok) {
        this.findPackagesExpanded.set(false);
        afterNextRender(
          () => {
            this.scrollToImportWorkspace();
          },
          { injector: this.injector }
        );
      }
      return ok;
    } finally {
      this.localPackageLoading.set(false);
    }
  }

  private async loadLocalPackageBytes(fileName: string, bytes: ArrayBuffer): Promise<boolean> {
    this.localPackageError.set(null);
    this.packageError.set(null);
    this.manifestError.set(null);
    this.manifest.set(null);
    this.selectedPackageId.set(null);
    this.selectedVersion.set(null);
    this.resolvedNodes.set(null);
    this.importOrderNames.set([]);
    this.packagesByName.set(new Map());
    this.rootPackageName.set(null);
    this.activePackageName.set(null);
    this.dependencyWarnings.set([]);
    this.dependencyErrors.set([]);
    this.localSourceFileName.set(null);
    this.igSelectionByPackage.set(new Map());
    this.workspaceGeneration++;
    this.packageLoadPromises.clear();
    this.packageLoading.set(true);
    try {
      const parsed = this.packageLoadService.parseLocalFhirPackageTarball(
        bytes,
        fileName.replace(/\.(tgz|tar\.gz)$/i, '')
      );
      const version = (parsed.pkgJson.version ?? '').trim() || '0.0.0';
      this.selectedPackageId.set(parsed.packageName);
      this.selectedVersion.set(version);
      this.localSourceFileName.set(fileName);
      this.setRootPackageFromParsed(parsed, version);
      this.dependencyWarnings.set([]);
      this.dependencyErrors.set([]);
      this.resolvedNodes.set(
        new Map([
          [
            parsed.packageName,
            {
              name: parsed.packageName,
              version,
              pkgJson: parsed.pkgJson
            } satisfies ResolvedPackageNode
          ]
        ])
      );
      this.importOrderNames.set([parsed.packageName]);
      this.activePackageName.set(parsed.packageName);
      this.initIgSelectionForPackage(parsed.packageName);
      return true;
    } catch (e) {
      this.localPackageError.set(
        e instanceof Error ? e.message : 'Failed to load local FHIR package.'
      );
      this.packageError.set(this.localPackageError());
      return false;
    } finally {
      this.packageLoading.set(false);
    }
  }

  /**
   * Load a package by id (and optional version) into the import workspace.
   * When version is omitted or not present in the manifest, uses dist-tags.latest
   * (or highest semver) — same as catalog selection.
   * @returns true when a package version was selected and load was attempted without manifest failure
   */
  async openPackage(packageId: string, version?: string | null): Promise<boolean> {
    const id = packageId.trim();
    if (!id) {
      return false;
    }
    this.localSourceFileName.set(null);
    this.localPackageError.set(null);
    this.selectedPackageId.set(id);
    this.manifest.set(null);
    this.selectedVersion.set(null);
    this.packageError.set(null);
    this.resolvedNodes.set(null);
    this.importOrderNames.set([]);
    this.packagesByName.set(new Map());
    this.igSelectionByPackage.set(new Map());
    this.workspaceGeneration++;
    this.packageLoadPromises.clear();
    this.rootPackageName.set(null);
    this.activePackageName.set(null);
    this.dependencyWarnings.set([]);
    this.dependencyErrors.set([]);
    this.manifestLoading.set(true);
    this.manifestError.set(null);
    try {
      const m = await this.registryService.getPackageManifest(id);
      this.manifest.set(m);
      const requested = version?.trim() || null;
      const latest = m['dist-tags']?.latest;
      const versions = Object.keys(m.versions ?? {}).sort((a, b) => this.compareSemver(a, b));
      const pick =
        requested && m.versions?.[requested]
          ? requested
          : latest && m.versions?.[latest]
            ? latest
            : (versions[versions.length - 1] ?? null);
      if (!pick) {
        this.manifestError.set('No versions found for this package.');
        return false;
      }
      this.selectedVersion.set(pick);
      await this.loadPackageVersion(pick);
      return this.packageError() == null;
    } catch (e) {
      this.manifestError.set(e instanceof Error ? e.message : 'Failed to load package manifest.');
      return false;
    } finally {
      this.manifestLoading.set(false);
    }
  }

  async onVersionChange(version: string): Promise<void> {
    this.selectedVersion.set(version);
    await this.loadPackageVersion(version);
  }

  private async loadPackageVersion(version: string): Promise<void> {
    const m = this.manifest();
    const pkgId = this.selectedPackageId();
    if (!m?.versions?.[version] || !pkgId) {
      return;
    }
    const tarballUrl = m.versions[version].dist?.tarball;
    if (!tarballUrl) {
      this.packageError.set('No tarball URL in manifest for this version.');
      return;
    }
    this.packageLoading.set(true);
    this.packageError.set(null);
    try {
      const buf = await this.registryService.fetchTarball(tarballUrl);
      const parsed = this.packageLoadService.parseTarballBuffer(buf, pkgId);
      this.setRootPackageFromParsed(parsed, version);
      this.dependencyWarnings.set([]);
      this.dependencyErrors.set([]);
      this.resolvedNodes.set(
        new Map([
          [
            parsed.packageName,
            { name: parsed.packageName, version, pkgJson: parsed.pkgJson } satisfies ResolvedPackageNode
          ]
        ])
      );
      this.importOrderNames.set([parsed.packageName]);
      this.activePackageName.set(parsed.packageName);
      this.initIgSelectionForPackage(parsed.packageName);
    } catch (e) {
      this.packageError.set(e instanceof Error ? e.message : 'Failed to load package.');
    } finally {
      this.packageLoading.set(false);
    }
  }

  private setRootPackageFromParsed(parsed: ParsedFhirPackageTarball, version: string): void {
    const name = parsed.packageName;
    const next = new Map<string, PackageImportState>();
    next.set(name, {
      packageKey: packageInstanceKey(name, version),
      name,
      version,
      includePackage: true,
      loadStatus: 'loaded',
      loadError: null,
      summary: parsed.summary,
      rows: parsed.rows,
      files: parsed.files
    });
    this.packagesByName.set(next);
    this.rootPackageName.set(name);
  }

  private pendingPackageState(
    name: string,
    version: string,
    includePackage: boolean
  ): PackageImportState {
    return {
      packageKey: packageInstanceKey(name, version),
      name,
      version,
      includePackage,
      loadStatus: 'pending',
      loadError: null,
      summary: null,
      rows: [],
      files: new Map()
    };
  }

  private compareSemver(a: string, b: string): number {
    const pa = a.split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
    const pb = b.split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da !== db) {
        return da - db;
      }
    }
    return a.localeCompare(b);
  }

  protected versionKeys(): string[] {
    const m = this.manifest();
    if (!m?.versions) {
      return [];
    }
    return Object.keys(m.versions).sort((a, b) => this.compareSemver(a, b));
  }

  async resolveDependencyChain(): Promise<void> {
    const ver = this.selectedVersion();
    const rootName = this.rootPackageName();
    const rootPkg = rootName ? this.packagesByName().get(rootName) : undefined;
    if (!ver || !rootName || !rootPkg || rootPkg.loadStatus !== 'loaded') {
      this.dependencyErrors.set(['Load the root package tarball first (select a version).']);
      return;
    }
    this.resolveBusy.set(true);
    this.dependencyWarnings.set([]);
    this.dependencyErrors.set([]);
    try {
      const pkgJson = await this.getRootPkgJson(rootPkg);
      const result = await this.dependencyResolver.resolveTree(rootName, ver, pkgJson);
      this.dependencyWarnings.set(result.warnings);
      this.dependencyErrors.set(result.errors);
      this.resolvedNodes.set(result.nodesByName);
      this.importOrderNames.set(result.importOrder);
      this.mergeResolvedPackages(result.nodesByName, rootName, ver);
    } catch (e) {
      this.dependencyErrors.set([e instanceof Error ? e.message : String(e)]);
    } finally {
      this.resolveBusy.set(false);
    }
  }

  private async getRootPkgJson(st: PackageImportState): Promise<FhirPackageJson> {
    return this.packageLoadService.readPackageJsonFromFiles(st.files);
  }

  private mergeResolvedPackages(nodes: Map<string, ResolvedPackageNode>, rootName: string, rootVer: string): void {
    const prev = this.packagesByName();
    const next = new Map<string, PackageImportState>();
    for (const [name, node] of nodes) {
      const existing = prev.get(name);

      if (existing?.loadStatus === 'loaded' && existing.version === node.version) {
        next.set(name, existing);
        continue;
      }

      if (existing?.loadStatus === 'loaded' && existing.version !== node.version) {
        next.set(
          name,
          this.pendingPackageState(name, node.version, existing.includePackage)
        );
        continue;
      }

      const include = existing?.includePackage ?? true;
      if (existing && (existing.loadStatus === 'pending' || existing.loadStatus === 'error')) {
        next.set(name, this.pendingPackageState(name, node.version, include));
        continue;
      }

      next.set(name, this.pendingPackageState(name, node.version, true));
    }
    const rootLoaded = prev.get(rootName);
    if (
      rootLoaded?.loadStatus === 'loaded' &&
      rootLoaded.version === rootVer &&
      next.has(rootName)
    ) {
      next.set(rootName, rootLoaded);
    }
    this.packagesByName.set(next);
    if (!this.activePackageName()) {
      this.activePackageName.set(rootName);
    }
  }

  async selectPlanPackage(name: string): Promise<void> {
    this.activePackageName.set(name);
    await this.ensurePackageLoaded(name);
    this.initIgSelectionForPackage(name);
  }

  private activeIgSelectionKey(): string | null {
    const st = this.activePackage();
    if (!st) {
      return null;
    }
    return st.packageKey || packageInstanceKey(st.name, st.version);
  }

  private igSelectionKeyForPackage(name: string): string | null {
    const st = this.packagesByName().get(name);
    if (!st) {
      return null;
    }
    return st.packageKey || packageInstanceKey(st.name, st.version);
  }

  /** Only seeds defaults the first time a package instance's IG is seen; preserves prior review. */
  private initIgSelectionForPackage(name: string): void {
    const selectionKey = this.igSelectionKeyForPackage(name);
    if (!name || !selectionKey || this.igSelectionByPackage().has(selectionKey)) {
      return;
    }
    const st = this.packagesByName().get(name);
    if (!st || st.loadStatus !== 'loaded') {
      return;
    }
    const ig = parseImplementationGuideFromPackageFiles(st.rows, st.files);
    if (!ig) {
      return;
    }
    const entries = enrichIgEntriesForArchive(parseImplementationGuideEntries(ig), st.rows);
    this.setIgSelectionForKey(selectionKey, {
      entryKeys: defaultSelectedIgEntryKeys(entries),
      globalIndices: new Set((ig.global ?? []).map((_, i) => i))
    });
  }

  private setIgSelectionForKey(
    selectionKey: string,
    selection: { entryKeys: ReadonlySet<string>; globalIndices: ReadonlySet<number> }
  ): void {
    this.igSelectionByPackage.update((m) => {
      const n = new Map(m);
      n.set(selectionKey, selection);
      return n;
    });
  }

  private setIgSelectionForActivePackage(selection: {
    entryKeys: ReadonlySet<string>;
    globalIndices: ReadonlySet<number>;
  }): void {
    const key = this.activeIgSelectionKey();
    if (!key) {
      return;
    }
    this.setIgSelectionForKey(key, selection);
  }

  onIgEntryKeysChange(keys: ReadonlySet<string>): void {
    this.setIgSelectionForActivePackage({
      entryKeys: keys,
      globalIndices: this.igSelectedGlobalIndices()
    });
  }

  onIgGlobalIndicesChange(indices: ReadonlySet<number>): void {
    this.setIgSelectionForActivePackage({
      entryKeys: this.igSelectedEntryKeys(),
      globalIndices: indices
    });
  }

  selectIgReferencedRows(): void {
    const matchedEntries = this.activeIgEntries().filter((e) => e.importable && e.matchedRowKey);
    const matched = new Set(matchedEntries.map((e) => e.matchedRowKey as string));
    const igKey = this.activeIgRow()?.rowKey;
    this.updateActiveRows((rows) =>
      rows.map((r) => ({
        ...r,
        selected: matched.has(r.rowKey) || (!!igKey && r.rowKey === igKey)
      }))
    );
    this.setIgSelectionForActivePackage({
      entryKeys: new Set(matchedEntries.map((e) => e.key)),
      globalIndices: this.igSelectedGlobalIndices()
    });
  }

  selectIgConformanceOnly(): void {
    const igKey = this.activeIgRow()?.rowKey;
    this.updateActiveRows((rows) =>
      rows.map((r) => ({
        ...r,
        selected:
          (!!igKey && r.rowKey === igKey) ||
          (isConformanceResourceType(r.resourceType) &&
            isDefaultIgImportableResourceType(r.resourceType) &&
            !r.isExample)
      }))
    );
    this.setIgSelectionForActivePackage({
      entryKeys: defaultSelectedIgEntryKeys(this.activeIgEntries()),
      globalIndices: this.igSelectedGlobalIndices()
    });
  }

  selectIgMetadataOnly(): void {
    const igKey = this.activeIgRow()?.rowKey;
    this.updateActiveRows((rows) =>
      rows.map((r) => ({
        ...r,
        selected: !!igKey && r.rowKey === igKey
      }))
    );
    this.setIgSelectionForActivePackage({ entryKeys: new Set(), globalIndices: new Set() });
  }

  async loadAllPackagesForImport(): Promise<void> {
    const order = this.importOrderNames();
    for (const name of order) {
      const st = this.packagesByName().get(name);
      if (st?.includePackage && st.loadStatus === 'pending') {
        await this.ensurePackageLoaded(name);
      }
    }
  }

  private async ensurePackageLoaded(name: string): Promise<void> {
    const st = this.packagesByName().get(name);
    if (!st) {
      return;
    }
    if (st.loadStatus === 'loaded') {
      this.initIgSelectionForPackage(name);
      return;
    }
    const inFlight = this.packageLoadPromises.get(name);
    if (inFlight) {
      await inFlight;
      this.initIgSelectionForPackage(name);
      return;
    }
    const promise = this.loadPackageTarball(name, st).finally(() => {
      this.packageLoadPromises.delete(name);
    });
    this.packageLoadPromises.set(name, promise);
    await promise;
    this.initIgSelectionForPackage(name);
  }

  private async loadPackageTarball(
    name: string,
    st: PackageImportState
  ): Promise<void> {
    const gen = this.workspaceGeneration;
    const nodes = this.resolvedNodes();
    const node = nodes?.get(name);
    const version = node?.version ?? st.version;
    this.packagesByName.update((m) => {
      const n = new Map(m);
      const cur = n.get(name);
      if (cur) {
        n.set(name, { ...cur, loadStatus: 'loading', loadError: null });
      }
      return n;
    });
    try {
      const manifest = await this.registryService.getPackageManifest(name);
      const tarballUrl = manifest.versions?.[version]?.dist?.tarball;
      if (!tarballUrl) {
        throw new Error(`No tarball URL for ${name} @ ${version}.`);
      }
      const parsed = await this.packageLoadService.fetchAndParseTarball(tarballUrl, name, name);
      if (gen !== this.workspaceGeneration) {
        return;
      }
      this.packagesByName.update((m) => {
        const n = new Map(m);
        if (!n.has(name)) {
          return n;
        }
        n.set(name, {
          ...st,
          loadStatus: 'loaded',
          loadError: null,
          summary: parsed.summary,
          rows: parsed.rows,
          files: parsed.files,
          version,
          packageKey: packageInstanceKey(name, version)
        });
        return n;
      });
    } catch (e) {
      if (gen !== this.workspaceGeneration) {
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.packagesByName.update((m) => {
        const n = new Map(m);
        const cur = n.get(name);
        if (cur) {
          n.set(name, { ...cur, loadStatus: 'error', loadError: msg });
        }
        return n;
      });
    }
  }

  setIncludePackage(name: string, include: boolean): void {
    this.packagesByName.update((m) => {
      const n = new Map(m);
      const cur = n.get(name);
      if (cur) {
        n.set(name, { ...cur, includePackage: include });
      }
      return n;
    });
  }

  setIncludeAllPackagesForImport(include: boolean): void {
    const names = this.planList().map((p) => p.name);
    if (names.length === 0) {
      return;
    }
    this.packagesByName.update((m) => {
      const n = new Map(m);
      for (const name of names) {
        const cur = n.get(name);
        if (cur) {
          n.set(name, { ...cur, includePackage: include });
        }
      }
      return n;
    });
  }

  toggleRow(row: IndexedResourceRowVm): void {
    const name = this.activePackageName();
    if (!name) {
      return;
    }
    this.updateActiveRows((rows) =>
      rows.map((r) => (r.rowKey === row.rowKey ? { ...r, selected: !r.selected } : r))
    );
  }

  toggleRowTarget(row: IndexedResourceRowVm, target: 'terminology' | 'data', checked: boolean): void {
    this.updateActiveRows((rows) =>
      rows.map((r) => {
        if (r.rowKey !== row.rowKey) {
          return r;
        }
        return target === 'terminology' ? { ...r, targetTerminology: checked } : { ...r, targetData: checked };
      })
    );
  }

  private updateActiveRows(updater: (rows: IndexedResourceRowVm[]) => IndexedResourceRowVm[]): void {
    const name = this.activePackageName();
    if (!name) {
      return;
    }
    this.packagesByName.update((m) => {
      const n = new Map(m);
      const cur = n.get(name);
      if (!cur) {
        return n;
      }
      n.set(name, { ...cur, rows: updater(cur.rows) });
      return n;
    });
  }

  selectAllVisible(selected: boolean): void {
    const keys = new Set(this.filteredRows().map((r) => r.rowKey));
    this.updateActiveRows((rows) => rows.map((r) => (keys.has(r.rowKey) ? { ...r, selected } : r)));
  }

  setVisibleTargets(target: 'terminology' | 'data', checked: boolean): void {
    const keys = new Set(this.filteredRows().map((r) => r.rowKey));
    this.updateActiveRows((rows) =>
      rows.map((r) => {
        if (!keys.has(r.rowKey)) {
          return r;
        }
        return target === 'terminology' ? { ...r, targetTerminology: checked } : { ...r, targetData: checked };
      })
    );
  }

  setQuickFilter(f: QuickFilter): void {
    if (f === 'examples') {
      this.includeExamples.set(true);
    }
    this.quickFilter.set(f);
  }

  toggleIncludeExamples(on: boolean): void {
    this.includeExamples.set(on);
    if (!on && this.quickFilter() === 'examples') {
      this.quickFilter.set('all');
    }
  }

  protected setImportResultOutcomeFilter(value: 'all' | 'errors' | 'success'): void {
    this.importResultOutcomeFilter.set(value);
  }

  protected toggleImportResultSort(column: RegistryImportResultSortColumn): void {
    if (this.importResultSortColumn() === column) {
      this.importResultSortAsc.update((v) => !v);
    } else {
      this.importResultSortColumn.set(column);
      this.importResultSortAsc.set(true);
    }
  }

  protected importResultSortChevron(column: RegistryImportResultSortColumn): string {
    if (this.importResultSortColumn() !== column) {
      return '';
    }
    return this.importResultSortAsc() ? ' ▲' : ' ▼';
  }

  protected clearImportResults(): void {
    this.importResultsRows.set([]);
    this.importProgress.set(null);
    this.importResultSearch.set('');
    this.importResultOutcomeFilter.set('all');
  }

  protected trackImportResultRow(_index: number, row: RegistryImportResultRow): string {
    return `${row.packageName}\u0000${row.channel}\u0000${row.resourceType}\u0000${row.resourceId}\u0000${row.filename}\u0000${row.ok}\u0000${row.message}`;
  }

  private importResultSortValue(row: RegistryImportResultRow, col: Exclude<RegistryImportResultSortColumn, 'ok'>): string {
    switch (col) {
      case 'packageName':
        return row.packageName;
      case 'channel':
        return row.channel;
      case 'resourceType':
        return row.resourceType;
      case 'resourceId':
        return row.resourceId;
      case 'filename':
        return row.filename;
      case 'message':
        return row.message;
      default:
        return '';
    }
  }

  private importResultRowValidation(message: string): RegistryImportResultRow {
    return {
      packageName: '—',
      channel: '—',
      resourceType: '—',
      resourceId: '—',
      filename: '—',
      ok: false,
      message
    };
  }

  private buildIgSanitizeOptions(
    packageName: string,
    rows: IndexedResourceRowVm[],
    files: Map<string, Uint8Array>,
    selectedRows: IndexedResourceRowVm[]
  ): IgImportSanitizeOptions | undefined {
    if (!this.igSanitizeBeforeImport()) {
      return undefined;
    }
    const igRow = selectedRows.find((r) => r.resourceType === 'ImplementationGuide');
    if (!igRow) {
      return undefined;
    }
    const ig = parseImplementationGuideFromPackageFiles(rows, files, igRow.filename);
    if (!ig) {
      return undefined;
    }
    const entries = enrichIgEntriesForArchive(parseImplementationGuideEntries(ig), rows);
    const selectionKey =
      this.igSelectionKeyForPackage(packageName) ??
      packageInstanceKey(packageName, this.packagesByName().get(packageName)?.version ?? '');
    let stored = this.igSelectionByPackage().get(selectionKey);
    if (!stored) {
      stored = {
        entryKeys: defaultSelectedIgEntryKeys(entries),
        globalIndices: new Set((ig.global ?? []).map((_, i) => i))
      };
      this.setIgSelectionForKey(selectionKey, stored);
    }
    return {
      igFilename: igRow.filename,
      includedEntryKeys: stored.entryKeys,
      includedGlobalIndices: stored.globalIndices
    };
  }

  private appendPrepareFailures(
    accumulated: RegistryImportResultRow[],
    packageName: string,
    errors: string[]
  ): void {
    for (const e of errors) {
      const missing = /^Missing file in archive:\s*(.+)$/.exec(e);
      const notFhir = /^Not a FHIR resource:\s*(.+)$/.exec(e);
      const filename = missing?.[1]?.trim() ?? notFhir?.[1]?.trim() ?? '—';
      accumulated.push({
        packageName,
        channel: 'Prepare',
        resourceType: '—',
        resourceId: '—',
        filename,
        ok: false,
        message: e
      });
    }
  }

  /**
   * Imports every package in `importOrderNames()` (dependency-first topological order from
   * {@link FhirPackageDependencyResolverService.resolveTree}) for which Import is on, the tarball is
   * loaded, and at least one row is selected. Each package uses only its own `rows` / `files` and
   * per-row terminology vs FHIR data targets; packages are processed sequentially (`await` in order).
   */
  async importSelected(): Promise<void> {
    const order = this.importOrderNames();
    if (order.length === 0) {
      this.importResultsRows.set([this.importResultRowValidation('Nothing to import.')]);
      return;
    }

    let totalSelected = 0;
    for (const name of order) {
      const st = this.packagesByName().get(name);
      if (!st?.includePackage || st.loadStatus !== 'loaded') {
        continue;
      }
      totalSelected += st.rows.filter((r) => r.selected).length;
    }
    if (totalSelected === 0) {
      this.importResultsRows.set([
        this.importResultRowValidation('Select at least one resource to import.')
      ]);
      return;
    }

    this.importing.set(true);
    this.importResultsRows.set([]);
    this.importProgress.set(null);

    const accumulated: RegistryImportResultRow[] = [];
    const pkgsWithSelection = order.filter((n) => {
      const st = this.packagesByName().get(n);
      return (
        !!st?.includePackage &&
        st.loadStatus === 'loaded' &&
        st.rows.some((r) => r.selected)
      );
    }).length;
    let pkgIndex = 0;

    try {
      for (const name of order) {
        const st = this.packagesByName().get(name);
        if (!st?.includePackage || st.loadStatus !== 'loaded') {
          continue;
        }
        const selectedRows = st.rows.filter((r) => r.selected);
        if (selectedRows.length === 0) {
          continue;
        }
        pkgIndex++;
        const igSanitize = this.buildIgSanitizeOptions(name, st.rows, st.files, selectedRows);
        const { resources, errors: loadErrors } = this.packageImportService.collectResourcesFromFiles(
          selectedRows,
          st.files,
          igSanitize
        );
        if (loadErrors.length > 0) {
          this.appendPrepareFailures(accumulated, name, loadErrors);
          this.importResultsRows.set([...accumulated]);
          continue;
        }
        const selectedByPath = new Map<string, IndexedResourceRowVm>();
        for (const row of selectedRows) {
          selectedByPath.set(row.filename, row);
        }
        const { termRes, dataRes } = this.packageImportService.partitionByTargets(resources, selectedByPath);
        if (termRes.length === 0 && dataRes.length === 0) {
          accumulated.push({
            packageName: name,
            channel: '—',
            resourceType: '—',
            resourceId: '—',
            filename: '—',
            ok: false,
            message:
              'Nothing to import for the current per-row targets (enable terminology and/or FHIR data).'
          });
          this.importResultsRows.set([...accumulated]);
          continue;
        }
        const outcomes = await this.packageImportService.importTerminologyAndData(
          termRes,
          dataRes,
          (msg) => {
            this.importProgress.set(`Package ${pkgIndex}/${pkgsWithSelection}: ${name} — ${msg}`);
          }
        );
        for (const o of outcomes) {
          accumulated.push({ ...o, packageName: name });
        }
        this.importResultsRows.set([...accumulated]);
      }

      const errCount = accumulated.filter((r) => !r.ok).length;
      this.importProgress.set(
        errCount > 0
          ? `Finished with ${errCount} error(s) of ${accumulated.length} row(s).`
          : `Import completed (${accumulated.length} row(s)).`
      );
    } catch (e) {
      accumulated.push({
        packageName: '—',
        channel: '—',
        resourceType: '—',
        resourceId: '—',
        filename: '—',
        ok: false,
        message: e instanceof Error ? e.message : String(e)
      });
      this.importResultsRows.set([...accumulated]);
      this.importProgress.set('Import failed.');
    } finally {
      this.importing.set(false);
    }
  }
}
