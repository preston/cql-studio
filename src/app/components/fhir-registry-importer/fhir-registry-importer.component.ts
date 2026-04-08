// Author: Preston Lee

import { afterNextRender, Component, computed, inject, Injector, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

type QuickFilter = 'all' | 'terminology' | 'conformance';

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
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  private readonly injector = inject(Injector);

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
    }
    return rows;
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
    const tu = this.settingsService.getEffectiveTerminologyBaseUrl().replace(/\/+$/, '');
    const fu = this.settingsService.getEffectiveFhirBaseUrl().replace(/\/+$/, '');
    const merged = terminology > 0 && data > 0 && tu === fu;
    return { terminology, data, mergedSingleEndpoint: merged };
  });

  protected readonly planList = computed(() => {
    const order = this.importOrderNames();
    const map = this.packagesByName();
    return order.map((name) => map.get(name)).filter((x): x is PackageImportState => !!x);
  });

  protected readonly includedPlanCount = computed(
    () => this.planList().filter((p) => p.includePackage).length
  );

  protected readonly planTotalCount = computed(() => this.planList().length);

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
    const id = entry.Name;
    this.selectedPackageId.set(id);
    this.manifest.set(null);
    this.selectedVersion.set(null);
    this.packageError.set(null);
    this.resolvedNodes.set(null);
    this.importOrderNames.set([]);
    this.packagesByName.set(new Map());
    this.rootPackageName.set(null);
    this.activePackageName.set(null);
    this.dependencyWarnings.set([]);
    this.dependencyErrors.set([]);
    this.manifestLoading.set(true);
    this.manifestError.set(null);
    try {
      const m = await this.registryService.getPackageManifest(id);
      this.manifest.set(m);
      const latest = m['dist-tags']?.latest;
      const versions = Object.keys(m.versions ?? {}).sort((a, b) => this.compareSemver(a, b));
      const pick = latest && m.versions?.[latest] ? latest : versions[versions.length - 1] ?? null;
      if (pick) {
        this.selectedVersion.set(pick);
        await this.loadPackageVersion(pick);
      }
    } catch (e) {
      this.manifestError.set(e instanceof Error ? e.message : 'Failed to load package manifest.');
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
    if (!st || st.loadStatus === 'loaded' || st.loadStatus === 'loading') {
      return;
    }
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
      this.packagesByName.update((m) => {
        const n = new Map(m);
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
    this.quickFilter.set(f);
  }

  toggleIncludeExamples(on: boolean): void {
    this.includeExamples.set(on);
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
        const { resources, errors: loadErrors } = this.packageImportService.collectResourcesFromFiles(
          selectedRows,
          st.files
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
