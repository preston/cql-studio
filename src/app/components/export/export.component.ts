// Author: Preston Lee

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Bundle, Library, Resource } from 'fhir/r4';
import { LibraryService } from '../../services/library.service';
import { ToastService } from '../../services/toast.service';
import {
  ExportDependencyGraph,
  ExportDependencyGraphService,
  ExportDependencyNode,
  ExportNodeKind,
  exportGraphOptionsKey
} from '../../services/export-dependency-graph.service';
import { FhirPackageArchiveService } from '../../services/fhir-package-archive.service';
import {
  DEFAULT_FHIR_CORE_PACKAGE,
  DEFAULT_FHIR_CORE_VERSION,
  FhirPackageManifestInput,
  buildFhirPackageJson,
  validateFhirPackageManifestInput
} from '../../services/fhir-package-manifest.lib';
import { CrmiArtifactPackageService } from '../../services/crmi-artifact-package.service';
import { ExportPublishService } from '../../services/export-publish.service';
import { downloadBytes, downloadJson } from '../../services/download-blob.lib';
import { buildPutTransactionBundle } from '../../services/fhir-bundle-transaction.lib';
import { resourceTypeOf } from '../../services/fhir-resource-type.lib';

export type ExportDestination = 'raw-cql' | 'fhir-package' | 'fhir-server' | 'crmi';
export type ExportWizardStep = 'destination' | 'libraries' | 'dependencies' | 'confirm';
export type ExportDepSortColumn = 'include' | 'kind' | 'name' | 'status' | 'detail';

interface ExportWizardStepMeta {
  id: ExportWizardStep;
  label: string;
}

interface ExportDestinationMeta {
  id: ExportDestination;
  label: string;
  icon: string;
  help: string;
}

const EXPORT_WIZARD_STEPS: readonly ExportWizardStepMeta[] = [
  { id: 'destination', label: 'Destination' },
  { id: 'libraries', label: 'Libraries' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'confirm', label: 'Confirm' }
];

const EXPORT_DESTINATIONS: readonly ExportDestinationMeta[] = [
  {
    id: 'raw-cql',
    label: 'Raw CQL + dependencies (.zip)',
    icon: 'bi-file-earmark-code',
    help: 'Download .cql sources and any selected terminology JSON files.'
  },
  {
    id: 'fhir-package',
    label: 'FHIR NPM package (.tgz)',
    icon: 'bi-box-seam',
    help: 'Download a FHIR Packages–conformant Conformance .tgz with package.json and .index.json.'
  },
  {
    id: 'fhir-server',
    label: 'Publish to FHIR server',
    icon: 'bi-cloud-upload',
    help: 'POST selected Libraries and terminology to your configured FHIR endpoints.'
  },
  {
    id: 'crmi',
    label: 'CRMI artifact package',
    icon: 'bi-diagram-3',
    help: 'Build a CRMI artifact Bundle for download or publish. Local packaging only.'
  }
];

@Component({
  selector: 'app-export',
  imports: [FormsModule],
  templateUrl: './export.component.html'
})
export class ExportComponent implements OnInit {
  private readonly libraryService = inject(LibraryService);
  private readonly toastService = inject(ToastService);
  private readonly dependencyGraphService = inject(ExportDependencyGraphService);
  private readonly archiveService = inject(FhirPackageArchiveService);
  private readonly crmiPackageService = inject(CrmiArtifactPackageService);
  private readonly publishService = inject(ExportPublishService);

  readonly steps = EXPORT_WIZARD_STEPS;
  readonly destinations = EXPORT_DESTINATIONS;
  readonly activeStep = signal<ExportWizardStep>('destination');
  readonly destination = signal<ExportDestination | null>(null);

  readonly librarySearch = signal('');
  readonly libraryLoading = signal(false);
  readonly libraryError = signal<string | null>(null);
  readonly libraryResults = signal<Library[]>([]);
  readonly selectedLibraries = signal<Library[]>([]);

  readonly graphLoading = signal(false);
  readonly graphError = signal<string | null>(null);
  readonly graph = signal<ExportDependencyGraph | null>(null);
  /** Keys of graph nodes included in the export. */
  readonly selectedExportKeys = signal<ReadonlySet<string>>(new Set());

  /** When destination is raw-cql, include a root complete-bundle.json (transaction + PUT). */
  readonly includeCompleteBundle = signal(true);
  readonly terminologyCapability = signal<'computable' | 'expanded'>('computable');
  readonly conditionalCreate = signal(true);
  readonly crmiBundleType = signal<'transaction' | 'collection'>('transaction');
  readonly crmiAction = signal<'download-bundle' | 'download-tgz' | 'publish'>('download-bundle');

  readonly packageName = signal('org.example.cql-export');
  readonly packageVersion = signal('0.1.0');
  readonly packageAuthor = signal('');
  readonly packageDescription = signal('');
  readonly packageTitle = signal('');

  readonly busy = signal(false);
  readonly progressMessage = signal<string | null>(null);
  readonly lastOutcomes = signal<string[]>([]);

  readonly depSortColumn = signal<ExportDepSortColumn>('kind');
  readonly depSortOrder = signal<'asc' | 'desc'>('asc');

  readonly stepIndex = computed(() => this.steps.findIndex((s) => s.id === this.activeStep()));

  readonly selectedDestinationMeta = computed(() => {
    const id = this.destination();
    return id ? (this.destinations.find((d) => d.id === id) ?? null) : null;
  });

  readonly sortedDependencyNodes = computed(() => {
    const g = this.graph();
    if (!g) {
      return [] as ExportDependencyNode[];
    }
    const nodes = [...g.flat];
    const column = this.depSortColumn();
    const direction = this.depSortOrder() === 'asc' ? 1 : -1;
    const selected = this.selectedExportKeys();

    nodes.sort((a, b) => {
      let cmp = 0;
      switch (column) {
        case 'include':
          cmp = Number(selected.has(a.key)) - Number(selected.has(b.key));
          break;
        case 'kind':
          cmp = a.kind.localeCompare(b.kind);
          break;
        case 'name':
          cmp = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'detail':
          cmp = (a.detail ?? '').localeCompare(b.detail ?? '', undefined, { sensitivity: 'base' });
          break;
      }
      if (cmp === 0 && column !== 'name') {
        cmp = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
      }
      if (cmp === 0) {
        cmp = a.key.localeCompare(b.key);
      }
      return cmp * direction;
    });
    return nodes;
  });

  readonly selectedCounts = computed(() => {
    const g = this.graph();
    const keys = this.selectedExportKeys();
    if (!g) {
      return { library: 0, valueset: 0, codesystem: 0 };
    }
    let library = 0;
    let valueset = 0;
    let codesystem = 0;
    for (const node of g.flat) {
      if (!keys.has(node.key) || node.status !== 'resolved') {
        continue;
      }
      if (node.kind === 'library') {
        library++;
      } else if (node.kind === 'valueset') {
        valueset++;
      } else if (node.kind === 'codesystem') {
        codesystem++;
      }
    }
    return { library, valueset, codesystem };
  });

  readonly packageValidation = computed(() => {
    if (
      this.destination() !== 'fhir-package' &&
      !(this.destination() === 'crmi' && this.crmiAction() === 'download-tgz')
    ) {
      return { valid: true, errors: [] as string[] };
    }
    return validateFhirPackageManifestInput(this.manifestInput());
  });

  readonly canProceed = computed(() => {
    const step = this.activeStep();
    if (step === 'destination') {
      return this.destination() != null;
    }
    if (step === 'libraries') {
      return this.selectedLibraries().length > 0;
    }
    if (step === 'dependencies') {
      return (
        this.graph() != null &&
        !this.graphLoading() &&
        this.selectedCounts().library > 0
      );
    }
    return true;
  });

  readonly canExecute = computed(() => {
    const g = this.graph();
    if (!g || this.busy()) {
      return false;
    }
    if (this.selectedCounts().library === 0) {
      return false;
    }
    const dest = this.destination();
    if (
      (dest === 'fhir-server' || (dest === 'crmi' && this.crmiAction() === 'publish')) &&
      g.hasBlockingMissing
    ) {
      return false;
    }
    if (dest === 'fhir-package' || (dest === 'crmi' && this.crmiAction() === 'download-tgz')) {
      return this.packageValidation().valid;
    }
    return true;
  });

  ngOnInit(): void {
    this.dependencyGraphService.clearSessionCaches();
    void this.loadLibraries();
  }

  selectDestination(dest: ExportDestination): void {
    this.destination.set(dest);
    if (dest === 'crmi') {
      this.conditionalCreate.set(true);
    } else if (dest === 'fhir-server') {
      this.conditionalCreate.set(false);
    }
    this.activeStep.set('libraries');
  }

  isLibrarySelected(lib: Library): boolean {
    return this.selectedLibraries().some((s) => this.sameLibrary(s, lib));
  }

  toggleLibrary(lib: Library): void {
    const current = this.selectedLibraries();
    if (this.isLibrarySelected(lib)) {
      this.selectedLibraries.set(current.filter((s) => !this.sameLibrary(s, lib)));
    } else {
      this.selectedLibraries.set([...current, lib]);
    }
  }

  async loadLibraries(): Promise<void> {
    this.libraryLoading.set(true);
    this.libraryError.set(null);
    try {
      const term = this.librarySearch().trim();
      const bundle: Bundle = term
        ? await firstValueFrom(this.libraryService.searchPaginated(term, 1, 50, 'name', 'asc'))
        : await firstValueFrom(this.libraryService.getAll(1, 50, 'name', 'asc'));
      const libs = (bundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is Library => resourceTypeOf(r) === 'Library')
        .filter((lib) => this.isLogicLibrary(lib));
      this.libraryResults.set(libs);
    } catch (err) {
      this.libraryError.set(err instanceof Error ? err.message : String(err));
      this.libraryResults.set([]);
    } finally {
      this.libraryLoading.set(false);
    }
  }

  async next(): Promise<void> {
    if (!this.canProceed()) {
      return;
    }
    const idx = this.stepIndex();
    const nextStep = this.steps[idx + 1];
    if (!nextStep) {
      return;
    }
    if (nextStep.id === 'dependencies') {
      await this.analyzeDependencies();
    }
    if (this.activeStep() === 'dependencies' && nextStep.id === 'confirm') {
      if (this.isGraphStale()) {
        await this.analyzeDependencies();
        if (!this.graph() || this.selectedCounts().library === 0) {
          return;
        }
      }
      this.prefillPackageFields();
    }
    this.activeStep.set(nextStep.id);
  }

  currentGraphOptionsKey(): string {
    return exportGraphOptionsKey({
      includeCodeSystems: true,
      terminologyCapability: this.terminologyCapability()
    });
  }

  isGraphStale(): boolean {
    const g = this.graph();
    return !g || g.optionsKey !== this.currentGraphOptionsKey();
  }

  async analyzeDependencies(): Promise<void> {
    this.graphLoading.set(true);
    this.graphError.set(null);
    this.progressMessage.set('Analyzing library and terminology dependencies…');
    try {
      const graph = await this.dependencyGraphService.buildGraph(this.selectedLibraries(), {
        includeCodeSystems: true,
        terminologyCapability: this.terminologyCapability()
      });
      this.graph.set(graph);
      this.applyDefaultExportSelection(graph);
      if (graph.missingCount > 0) {
        this.toastService.show({
          type: 'warning',
          message: `${graph.missingCount} unresolved dependenc${graph.missingCount === 1 ? 'y' : 'ies'} found.`
        });
      }
    } catch (err) {
      this.graphError.set(err instanceof Error ? err.message : String(err));
      this.graph.set(null);
      this.selectedExportKeys.set(new Set());
    } finally {
      this.graphLoading.set(false);
      this.progressMessage.set(null);
    }
  }

  async reanalyze(): Promise<void> {
    await this.analyzeDependencies();
  }

  isExportNodeSelected(key: string): boolean {
    return this.selectedExportKeys().has(key);
  }

  canToggleExportNode(node: ExportDependencyNode): boolean {
    return node.status === 'resolved' && !!node.resource;
  }

  toggleExportNode(node: ExportDependencyNode): void {
    if (!this.canToggleExportNode(node)) {
      return;
    }
    const next = new Set(this.selectedExportKeys());
    if (next.has(node.key)) {
      next.delete(node.key);
    } else {
      next.add(node.key);
    }
    this.selectedExportKeys.set(next);
  }

  selectAllOfKind(kind: ExportNodeKind): void {
    const g = this.graph();
    if (!g) {
      return;
    }
    const next = new Set(this.selectedExportKeys());
    for (const node of g.flat) {
      if (node.kind === kind && this.canToggleExportNode(node)) {
        next.add(node.key);
      }
    }
    this.selectedExportKeys.set(next);
  }

  deselectAllOfKind(kind: ExportNodeKind): void {
    const g = this.graph();
    if (!g) {
      return;
    }
    const next = new Set(this.selectedExportKeys());
    for (const node of g.flat) {
      if (node.kind === kind) {
        next.delete(node.key);
      }
    }
    this.selectedExportKeys.set(next);
  }

  setDepSort(column: ExportDepSortColumn): void {
    if (this.depSortColumn() === column) {
      this.depSortOrder.set(this.depSortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.depSortColumn.set(column);
      this.depSortOrder.set(column === 'include' ? 'desc' : 'asc');
    }
  }

  async execute(): Promise<void> {
    if (!this.canExecute()) {
      return;
    }
    const dest = this.destination();
    const graph = this.graph();
    if (!dest || !graph) {
      return;
    }

    this.busy.set(true);
    this.lastOutcomes.set([]);
    try {
      switch (dest) {
        case 'raw-cql':
          await this.executeRawCql(graph);
          break;
        case 'fhir-package':
          this.executeFhirPackage(graph);
          break;
        case 'fhir-server':
          await this.executeFhirServer(graph);
          break;
        case 'crmi':
          await this.executeCrmi(graph);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.toastService.show({ type: 'error', message });
      this.lastOutcomes.set([message]);
    } finally {
      this.busy.set(false);
      this.progressMessage.set(null);
    }
  }

  statusBadgeClass(status: ExportDependencyNode['status']): string {
    switch (status) {
      case 'resolved':
        return 'text-bg-success';
      case 'missing':
        return 'text-bg-danger';
      case 'external':
        return 'text-bg-secondary';
      case 'cycle':
        return 'text-bg-warning';
      default:
        return 'text-bg-light';
    }
  }

  private applyDefaultExportSelection(graph: ExportDependencyGraph): void {
    const keys = new Set<string>();
    for (const node of graph.flat) {
      if (node.status !== 'resolved' || !node.resource) {
        continue;
      }
      // Libraries and ValueSets on by default; CodeSystems off by default.
      if (node.kind === 'library' || node.kind === 'valueset') {
        keys.add(node.key);
      }
    }
    this.selectedExportKeys.set(keys);
  }

  private selectedResources(graph: ExportDependencyGraph): Resource[] {
    const keys = this.selectedExportKeys();
    const resources: Resource[] = [];
    for (const node of graph.flat) {
      if (keys.has(node.key) && node.status === 'resolved' && node.resource) {
        resources.push(node.resource);
      }
    }
    return resources;
  }

  private selectedLibraryNodes(graph: ExportDependencyGraph): ExportDependencyNode[] {
    const keys = this.selectedExportKeys();
    return graph.flat.filter(
      (n) =>
        n.kind === 'library' &&
        n.status === 'resolved' &&
        keys.has(n.key) &&
        !!n.resource
    );
  }

  private async executeRawCql(graph: ExportDependencyGraph): Promise<void> {
    this.progressMessage.set('Building CQL zip…');
    const files: Record<string, string> = {};
    const usedNames = new Set<string>();
    const keys = this.selectedExportKeys();

    for (const node of graph.flat) {
      if (
        node.kind !== 'library' ||
        node.status !== 'resolved' ||
        !keys.has(node.key) ||
        !node.cqlContent?.trim()
      ) {
        continue;
      }
      const lib = node.resource as Library;
      let base = `${lib.name || lib.id || 'library'}${lib.version ? `-${lib.version}` : ''}`;
      if (usedNames.has(base) && lib.id) {
        base = `${base}-${lib.id}`;
      }
      usedNames.add(base);
      files[`cql/${base}.cql`] = node.cqlContent;
    }

    let vsIndex = 0;
    let csIndex = 0;
    for (const node of graph.flat) {
      if (!keys.has(node.key) || node.status !== 'resolved' || !node.resource) {
        continue;
      }
      if (node.kind === 'valueset') {
        const vs = node.resource as { name?: string; id?: string };
        const name = `${vs.name || vs.id || `ValueSet-${vsIndex}`}.json`;
        files[`terminology/${name}`] = JSON.stringify(node.resource, null, 2);
        vsIndex++;
      } else if (node.kind === 'codesystem') {
        const cs = node.resource as { name?: string; id?: string };
        const name = `${cs.name || cs.id || `CodeSystem-${csIndex}`}.json`;
        files[`terminology/${name}`] = JSON.stringify(node.resource, null, 2);
        csIndex++;
      }
    }

    if (this.includeCompleteBundle()) {
      const resources = this.selectedResources(graph);
      if (resources.length > 0) {
        const completeBundle = buildPutTransactionBundle(resources);
        files['complete-bundle.json'] = JSON.stringify(completeBundle, null, 2);
      }
    }

    if (Object.keys(files).length === 0) {
      throw new Error('No selected content available to export.');
    }
    const zip = this.archiveService.createZip(files);
    downloadBytes(zip, 'cql-export.zip', 'application/zip');
    this.toastService.show({ type: 'success', message: 'Downloaded CQL dependency zip.' });
    const outcomes = [`Downloaded ${Object.keys(files).length} files.`];
    if (files['complete-bundle.json']) {
      outcomes.push('Included complete-bundle.json (transaction Bundle with PUT).');
    }
    this.lastOutcomes.set(outcomes);
  }

  private executeFhirPackage(graph: ExportDependencyGraph): void {
    this.progressMessage.set('Building FHIR NPM package…');
    const pkg = buildFhirPackageJson(this.manifestInput());
    const resources = this.selectedResources(graph);
    const { tgz } = this.archiveService.createFhirPackageTgz(pkg, resources);
    downloadBytes(tgz, `${pkg.name}-${pkg.version}.tgz`, 'application/gzip');
    this.toastService.show({ type: 'success', message: 'Downloaded FHIR NPM package.' });
    this.lastOutcomes.set([`Downloaded ${pkg.name}@${pkg.version} (${resources.length} resources).`]);
  }

  private async executeFhirServer(graph: ExportDependencyGraph): Promise<void> {
    this.progressMessage.set('Publishing to FHIR server…');
    const resources = this.selectedResources(graph);
    const primaryLibs = this.selectedLibraryNodes(graph)
      .map((n) => n.resource as Library)
      .filter((lib) => this.isSelectedPrimary(lib));
    const roots = primaryLibs.length > 0 ? primaryLibs : this.selectedLibraries();

    let outcomes;
    if (this.conditionalCreate()) {
      const rootKeys = new Set(roots.map((l) => this.libraryIdentityKey(l)));
      const deps = resources.filter((r) => {
        if (resourceTypeOf(r) !== 'Library') {
          return true;
        }
        return !rootKeys.has(this.libraryIdentityKey(r as Library));
      });
      const bundle = this.crmiPackageService.buildArtifactBundle(roots, deps, {
        bundleType: 'transaction',
        conditionalCreate: true,
        packageName: this.packageName(),
        packageVersion: this.packageVersion()
      });
      outcomes = await this.publishService.publishBundle(bundle, (m) => this.progressMessage.set(m));
    } else {
      outcomes = await this.publishService.publishResources(resources, false, (m) =>
        this.progressMessage.set(m)
      );
    }
    this.lastOutcomes.set(outcomes.map((o) => o.message));
    const ok = outcomes.every((o) => o.success);
    this.toastService.show({
      type: ok ? 'success' : 'error',
      message: ok ? 'Publish completed.' : 'Publish completed with errors.'
    });
  }

  private async executeCrmi(graph: ExportDependencyGraph): Promise<void> {
    const resources = this.selectedResources(graph);
    const primaryLibs = this.selectedLibraryNodes(graph)
      .map((n) => n.resource as Library)
      .filter((lib) => this.isSelectedPrimary(lib));
    const roots = primaryLibs.length > 0 ? primaryLibs : this.selectedLibraries();
    const rootKeys = new Set(roots.map((l) => this.libraryIdentityKey(l)));
    const deps = resources.filter((r) => {
      if (resourceTypeOf(r) !== 'Library') {
        return true;
      }
      return !rootKeys.has(this.libraryIdentityKey(r as Library));
    });

    const action = this.crmiAction();
    const bundleType = action === 'publish' ? 'transaction' : this.crmiBundleType();
    const conditionalCreate = action === 'download-bundle' ? false : this.conditionalCreate();

    const bundle = this.crmiPackageService.buildArtifactBundle(roots, deps, {
      bundleType,
      conditionalCreate,
      packageName: this.packageName(),
      packageVersion: this.packageVersion()
    });

    if (action === 'download-bundle') {
      downloadJson(bundle, 'crmi-artifact-bundle.json');
      this.toastService.show({ type: 'success', message: 'Downloaded CRMI artifact Bundle.' });
      this.lastOutcomes.set([`Bundle type ${bundle.type} with ${bundle.entry?.length ?? 0} entries.`]);
      return;
    }
    if (action === 'download-tgz') {
      this.executeFhirPackage(graph);
      return;
    }

    this.progressMessage.set('Publishing CRMI package…');
    const outcomes = await this.publishService.publishBundle(bundle, (m) => this.progressMessage.set(m));
    this.lastOutcomes.set(outcomes.map((o) => o.message));
    const ok = outcomes.every((o) => o.success);
    this.toastService.show({
      type: ok ? 'success' : 'error',
      message: ok ? 'CRMI publish completed.' : 'CRMI publish completed with errors.'
    });
  }

  private manifestInput(): FhirPackageManifestInput {
    return {
      name: this.packageName(),
      version: this.packageVersion(),
      author: this.packageAuthor(),
      description: this.packageDescription(),
      title: this.packageTitle() || undefined,
      type: 'Conformance',
      dependencies: {
        [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION
      }
    };
  }

  private prefillPackageFields(): void {
    const primary = this.selectedLibraries()[0];
    if (primary && !this.packageDescription().trim()) {
      this.packageDescription.set(
        primary.description || primary.title || primary.name || 'CQL Studio library export'
      );
    }
    if (primary && !this.packageTitle().trim()) {
      this.packageTitle.set(primary.title || primary.name || '');
    }
  }

  private isLogicLibrary(lib: Library): boolean {
    const codings = lib.type?.coding ?? [];
    if (codings.length === 0) {
      return true;
    }
    return codings.some((c) => c.code === 'logic-library' || c.code === 'asset-collection');
  }

  private sameLibrary(a: Library, b: Library): boolean {
    if (a.id && b.id && a.id === b.id) {
      return true;
    }
    return a.name === b.name && a.version === b.version && a.url === b.url;
  }

  private isSelectedPrimary(lib: Library): boolean {
    return this.selectedLibraries().some((s) => this.sameLibrary(s, lib));
  }

  private libraryIdentityKey(lib: Library): string {
    return `${lib.id ?? ''}|${lib.name ?? ''}|${lib.version ?? ''}|${lib.url ?? ''}`;
  }
}
