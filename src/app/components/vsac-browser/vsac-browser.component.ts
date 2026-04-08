// Author: Preston Lee

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import {
  VsacService,
  capabilityStatementSupportsValueSetSort,
  valueSetSortFieldChoicesFromCapability
} from '../../services/vsac.service';
import { SettingsService } from '../../services/settings.service';
import { TerminologyService } from '../../services/terminology.service';
import { ToastService } from '../../services/toast.service';
import { ClipboardService } from '../../services/clipboard.service';
import { SyntaxHighlighterComponent } from '../shared/syntax-highlighter/syntax-highlighter.component';
import { Bundle, CapabilityStatement, Coding, Parameters, ValueSet, Resource } from 'fhir/r4';

@Component({
  selector: 'app-vsac-browser',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SyntaxHighlighterComponent],
  templateUrl: './vsac-browser.component.html',
  styleUrl: './vsac-browser.component.scss'
})
export class VsacBrowserComponent {
  private vsac = inject(VsacService);
  protected settingsService = inject(SettingsService);
  private terminology = inject(TerminologyService);
  private toast = inject(ToastService);
  private clipboard = inject(ClipboardService);

  protected readonly activeTab = signal<'status' | 'search' | 'valueset' | 'svs'>('search');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly capability = signal<CapabilityStatement | null>(null);
  protected readonly vspTypes = signal<string[]>([]);

  protected readonly searchTitle = signal('');
  protected readonly searchName = signal('');
  protected readonly searchUrl = signal('');
  protected readonly searchIdentifier = signal('');
  protected readonly searchVersion = signal('');
  protected readonly searchStatus = signal('');
  protected readonly searchPublisher = signal('');
  protected readonly searchDescription = signal('');
  protected readonly searchExpansion = signal('');
  protected readonly searchUsage = signal('');
  protected readonly searchKeyword = signal('');
  protected readonly searchCode = signal('');
  protected readonly searchCodesystem = signal('');
  protected readonly searchMeasure = signal('');
  protected readonly searchLibrary = signal('');
  protected readonly searchDate = signal('');
  protected readonly searchResourceId = signal('');
  protected readonly searchLastUpdated = signal('');
  protected readonly searchCount = signal(50);
  /** When server lists `_sort` for ValueSet: chosen search param, or raw `_sort` if no param list. */
  protected readonly searchSortField = signal('');
  protected readonly searchSortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly searchResults = signal<ValueSet[]>([]);
  /** Last FHIR searchset bundle (for total + pagination links). */
  protected readonly searchBundle = signal<Bundle<ValueSet> | null>(null);

  protected readonly valueSetSearchSupportsSort = computed(() =>
    capabilityStatementSupportsValueSetSort(this.capability())
  );

  protected readonly valueSetSortFieldOptions = computed(() =>
    this.valueSetSearchSupportsSort() ? valueSetSortFieldChoicesFromCapability(this.capability()) : []
  );

  protected readonly searchPagination = computed(() => {
    const links = this.searchBundle()?.link;
    const pick = (...rels: string[]) => {
      for (const r of rels) {
        const u = links?.find((l) => l.relation === r)?.url;
        if (u) return u;
      }
      return undefined;
    };
    const first = pick('first');
    const previous = pick('previous', 'prev');
    const next = pick('next');
    const last = pick('last');
    return {
      first,
      previous,
      next,
      last,
      showNav: !!(first || previous || next || last)
    };
  });

  protected readonly expansionPageInfo = computed(() => {
    const exp = this.expandedValueSet()?.expansion;
    const rows = this.expansionRows().length;
    const offset = this.expandOffset();
    const count = Math.max(1, Number(this.expandCount()) || 100);
    const total = exp?.total;
    const hasTotal = typeof total === 'number';
    let canNext = false;
    if (rows > 0) {
      if (hasTotal) {
        canNext = offset + rows < total;
      } else {
        canNext = rows >= count;
      }
    }
    const summary =
      rows === 0
        ? ''
        : hasTotal
          ? `Codes ${offset + 1}–${offset + rows} of ${total}`
          : `Codes ${offset + 1}–${offset + rows}${rows >= count ? ' (more may exist)' : ''}`;
    return { canPrev: offset > 0, canNext, summary };
  });

  protected readonly oidInput = signal('');
  protected readonly loadedValueSet = signal<ValueSet | null>(null);
  protected readonly expandFilter = signal('');
  protected readonly expandCount = signal(100);
  protected readonly expandOffset = signal(0);
  protected readonly expandProfile = signal('');
  protected readonly expandedValueSet = signal<ValueSet | null>(null);

  protected readonly svsProgramsText = signal<string | null>(null);
  protected readonly svsTagNamesText = signal<string | null>(null);
  protected readonly svsOid = signal('');
  protected readonly svsRelease = signal('');
  protected readonly svsProfile = signal('');
  protected readonly svsTagName = signal('');
  protected readonly svsTagValue = signal('');
  protected readonly svsXmlResult = signal<string | null>(null);

  protected readonly terminologyImportWarning = computed(() => {
    const u = this.settingsService.getEffectiveTerminologyBaseUrl().toLowerCase();
    return u.includes('cts.nlm.nih.gov') || u.includes('nlm.nih.gov');
  });

  protected readonly loadedValueSetJson = computed(() => {
    const vs = this.loadedValueSet();
    if (!vs) return '';
    try {
      return JSON.stringify(vs, null, 2);
    } catch {
      return '';
    }
  });

  setTab(tab: 'status' | 'search' | 'valueset' | 'svs'): void {
    this.activeTab.set(tab);
  }

  setSearchSortOrder(value: string): void {
    this.searchSortOrder.set(value === 'desc' ? 'desc' : 'asc');
  }

  formatVsacDate(value: string | undefined): string {
    if (value == null || !String(value).trim()) return '—';
    const t = String(value).trim();
    return t.length >= 10 ? t.slice(0, 10) : t;
  }

  vsacStatusBadgeClass(status: string | undefined): string {
    switch (status) {
      case 'active':
        return 'text-bg-success';
      case 'draft':
        return 'text-bg-secondary';
      case 'retired':
        return 'text-bg-dark';
      default:
        return 'text-bg-warning';
    }
  }

  truncateVsDescription(desc: string | undefined, max = 96): string {
    if (desc == null || !desc.trim()) return '—';
    const s = desc.trim().replace(/\s+/g, ' ');
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  }

  private vsacCredentialsOrWarn(): boolean {
    if (!this.settingsService.vsacHasApiCredentials()) {
      this.toast.showWarning('Configure VSAC credentials in Settings.', 'VSAC');
      return false;
    }
    return true;
  }

  private errMsg(e: unknown): string {
    if (e && typeof e === 'object' && 'error' in e) {
      const er = (e as { error?: unknown }).error;
      if (typeof er === 'string') return er;
      if (er && typeof er === 'object' && 'issue' in er) {
        const issues = (er as { issue?: { diagnostics?: string }[] }).issue;
        if (issues?.length) return issues.map((i) => i.diagnostics || '').filter(Boolean).join('; ') || JSON.stringify(er);
      }
    }
    return e instanceof Error ? e.message : String(e);
  }

  async refreshStatus(): Promise<void> {
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const cap = await firstValueFrom(this.vsac.getMetadata());
      this.capability.set(cap);
      this.vspTypes.set(extractPackageRelatedTypes(cap));
    } catch (e) {
      this.capability.set(null);
      this.vspTypes.set([]);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'VSAC metadata failed');
    } finally {
      this.loading.set(false);
    }
  }

  private buildSearchSortParam(): string | undefined {
    if (!this.valueSetSearchSupportsSort()) return undefined;
    const raw = this.searchSortField().trim();
    if (!raw) return undefined;
    const choices = this.valueSetSortFieldOptions();
    if (choices.length === 0) {
      return raw;
    }
    return this.searchSortOrder() === 'desc' ? `-${raw}` : raw;
  }

  private applySearchBundle(bundle: Bundle<ValueSet>): void {
    const list = bundle.entry?.map((e) => e.resource as ValueSet).filter((r) => r?.resourceType === 'ValueSet') ?? [];
    this.searchResults.set(list);
    this.searchBundle.set(bundle);
  }

  async runSearch(): Promise<void> {
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const bundle = await firstValueFrom(
        this.vsac.searchValueSets({
          titleContains: this.searchTitle().trim() || undefined,
          nameContains: this.searchName().trim() || undefined,
          url: this.searchUrl().trim() || undefined,
          identifier: this.searchIdentifier().trim() || undefined,
          version: this.searchVersion().trim() || undefined,
          status: this.searchStatus().trim() || undefined,
          publisherContains: this.searchPublisher().trim() || undefined,
          descriptionContains: this.searchDescription().trim() || undefined,
          expansion: this.searchExpansion().trim() || undefined,
          usage: this.searchUsage().trim() || undefined,
          keyword: this.searchKeyword().trim() || undefined,
          code: this.searchCode().trim() || undefined,
          codesystem: this.searchCodesystem().trim() || undefined,
          measure: this.searchMeasure().trim() || undefined,
          library: this.searchLibrary().trim() || undefined,
          date: this.searchDate().trim() || undefined,
          _id: this.searchResourceId().trim() || undefined,
          _lastUpdated: this.searchLastUpdated().trim() || undefined,
          _sort: this.buildSearchSortParam(),
          _count: this.searchCount()
        })
      );
      this.applySearchBundle(bundle);
    } catch (e) {
      this.searchBundle.set(null);
      this.searchResults.set([]);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'VSAC search failed');
    } finally {
      this.loading.set(false);
    }
  }

  async goSearchPage(kind: 'first' | 'previous' | 'next' | 'last'): Promise<void> {
    const p = this.searchPagination();
    const url =
      kind === 'first' ? p.first : kind === 'previous' ? p.previous : kind === 'next' ? p.next : p.last;
    if (!url || this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const bundle = await firstValueFrom(this.vsac.getValueSetSearchByBundleLink(url));
      this.applySearchBundle(bundle);
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'VSAC search page failed');
    } finally {
      this.loading.set(false);
    }
  }

  async expandGoPrevPage(): Promise<void> {
    if (this.loading()) return;
    const count = Math.max(1, Number(this.expandCount()) || 100);
    if (this.expandOffset() <= 0) return;
    this.expandOffset.set(Math.max(0, this.expandOffset() - count));
    await this.expandLoaded();
  }

  async expandGoNextPage(): Promise<void> {
    if (this.loading()) return;
    const exp = this.expandedValueSet()?.expansion;
    const rows = this.expansionRows().length;
    const count = Math.max(1, Number(this.expandCount()) || 100);
    const offset = this.expandOffset();
    const total = exp?.total;
    if (typeof total === 'number') {
      if (offset + rows >= total) return;
    } else if (rows < count) {
      return;
    }
    this.expandOffset.set(offset + count);
    await this.expandLoaded();
  }

  async loadValueSetByOid(): Promise<void> {
    const raw = this.oidInput().trim();
    if (!raw) {
      this.toast.showWarning('Enter a value set OID or id.', 'VSAC');
      return;
    }
    if (this.loading()) return;
    const id = raw.replace(/^urn:oid:/i, '');
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    this.expandedValueSet.set(null);
    try {
      const vs = await firstValueFrom(this.vsac.getValueSetById(id));
      this.loadedValueSet.set(vs);
    } catch (e) {
      this.loadedValueSet.set(null);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'Load ValueSet failed');
    } finally {
      this.loading.set(false);
    }
  }

  selectSearchResult(vs: ValueSet): void {
    if (vs.id) {
      this.oidInput.set(vs.id);
    } else if (vs.url) {
      this.oidInput.set(vs.url);
    }
    this.loadedValueSet.set(vs);
    this.expandedValueSet.set(null);
    this.setTab('valueset');
  }

  async expandLoaded(): Promise<void> {
    if (this.loading()) return;
    const vs = this.loadedValueSet();
    if (!vs) {
      this.toast.showWarning('Load a value set first.', 'VSAC');
      return;
    }
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const count = Math.max(1, Number(this.expandCount()) || 100);
      const offset = Math.max(0, Number(this.expandOffset()) || 0);
      if (vs.id) {
        const q: Record<string, string | number | boolean | undefined> = {
          count,
          offset
        };
        const f = this.expandFilter().trim();
        if (f) q['filter'] = f;
        const p = this.expandProfile().trim();
        if (p) q['profile'] = p;
        const exp = await firstValueFrom(this.vsac.expandValueSetGet(vs.id, q));
        this.expandedValueSet.set(exp);
      } else if (vs.url) {
        const params: Parameters = {
          resourceType: 'Parameters',
          parameter: [
            { name: 'url', valueUri: vs.url },
            { name: 'count', valueInteger: count },
            { name: 'offset', valueInteger: offset }
          ]
        };
        const f = this.expandFilter().trim();
        if (f) params.parameter!.push({ name: 'filter', valueString: f });
        const p = this.expandProfile().trim();
        if (p) params.parameter!.push({ name: 'profile', valueString: p });
        const exp = await firstValueFrom(this.vsac.expandValueSetPost(params));
        this.expandedValueSet.set(exp);
      } else {
        throw new Error('ValueSet has no id or canonical url for $expand');
      }
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, '$expand failed');
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchSvsPlainText(
    request: () => Observable<string>,
    onSuccess: (text: string) => void,
    errorContext: string
  ): Promise<void> {
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      onSuccess(await firstValueFrom(request()));
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, errorContext);
    } finally {
      this.loading.set(false);
    }
  }

  async fetchPrograms(): Promise<void> {
    await this.fetchSvsPlainText(() => this.vsac.listPrograms(), (t) => this.svsProgramsText.set(t), 'SVS programs failed');
  }

  async fetchTagNames(): Promise<void> {
    await this.fetchSvsPlainText(() => this.vsac.listTagNames(), (t) => this.svsTagNamesText.set(t), 'SVS tagNames failed');
  }

  async retrieveSvs(): Promise<void> {
    const oid = this.svsOid().trim();
    const tagName = this.svsTagName().trim();
    const tagValue = this.svsTagValue().trim();
    if (!oid && (!tagName || !tagValue)) {
      this.toast.showWarning('Enter OID or both tag name and tag value.', 'SVS');
      return;
    }
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const q: Record<string, string> = {};
      if (oid) q['id'] = oid;
      if (tagName) q['tagName'] = tagName;
      if (tagValue) q['tagValue'] = tagValue;
      const rel = this.svsRelease().trim();
      if (rel) q['release'] = rel;
      const prof = this.svsProfile().trim();
      if (prof) q['profile'] = prof;
      const xml = await firstValueFrom(this.vsac.retrieveMultipleValueSets(q));
      this.svsXmlResult.set(xml);
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'RetrieveMultipleValueSets failed');
    } finally {
      this.loading.set(false);
    }
  }

  async copyVsacOid(): Promise<void> {
    const vs = this.loadedValueSet();
    const id = vs?.id || this.oidInput().trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      this.toast.showSuccess('Copied OID.', 'Clipboard');
    } catch {
      this.toast.showError('Clipboard not available.', 'Clipboard');
    }
  }

  async copyCanonicalUrl(): Promise<void> {
    const u = this.loadedValueSet()?.url;
    if (!u) return;
    try {
      await navigator.clipboard.writeText(u);
      this.toast.showSuccess('Copied URL.', 'Clipboard');
    } catch {
      this.toast.showError('Clipboard not available.', 'Clipboard');
    }
  }

  async copyCqlSnippet(): Promise<void> {
    const vs = this.loadedValueSet();
    if (!vs?.url) return;
    const name = (vs.title || vs.name || 'VS').replace(/"/g, '\\"');
    const snippet = `valueset "${name}": '${vs.url}'`;
    try {
      await navigator.clipboard.writeText(snippet);
      this.toast.showSuccess('Copied CQL snippet.', 'Clipboard');
    } catch {
      this.toast.showError('Clipboard not available.', 'Clipboard');
    }
  }

  private async copyPlainText(text: string, successMessage: string): Promise<void> {
    if (!text?.trim()) {
      this.toast.showWarning('Nothing to copy.', 'Clipboard');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.toast.showSuccess(successMessage, 'Clipboard');
    } catch {
      this.toast.showError('Clipboard not available.', 'Clipboard');
    }
  }

  async copyLoadedValueSetJson(): Promise<void> {
    await this.copyPlainText(this.loadedValueSetJson(), 'ValueSet JSON copied.');
  }

  async copyProgramsResponse(): Promise<void> {
    await this.copyPlainText(this.svsProgramsText() ?? '', 'Programs response copied.');
  }

  async copyTagNamesResponse(): Promise<void> {
    await this.copyPlainText(this.svsTagNamesText() ?? '', 'tagNames response copied.');
  }

  async copySvsXmlResponse(): Promise<void> {
    await this.copyPlainText(this.svsXmlResult() ?? '', 'SVS XML copied.');
  }

  addLoadedValueSetToAppClipboard(): void {
    const vs = this.loadedValueSet();
    if (!vs) return;
    try {
      this.clipboard.addResource(vs as Resource);
      this.toast.showSuccess('ValueSet added to clipboard.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to add ValueSet to clipboard.', 'Clipboard');
    }
  }

  addSearchValueSetToAppClipboard(vs: ValueSet): void {
    try {
      this.clipboard.addResource(vs as Resource);
      this.toast.showSuccess('ValueSet added to clipboard.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to add ValueSet to clipboard.', 'Clipboard');
    }
  }

  addExpansionCodingToAppClipboard(row: { system?: string; code?: string; display?: string }): void {
    const system = row.system?.trim();
    const code = row.code?.trim();
    if (!system || !code) {
      this.toast.showWarning('Code is missing system or code.', 'Clipboard');
      return;
    }
    const coding: Coding = {
      system,
      code,
      display: row.display
    };
    try {
      this.clipboard.addCoding(coding);
      this.toast.showSuccess('Coding added to clipboard.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to add coding to clipboard.', 'Clipboard');
    }
  }

  async importLoadedValueSetToTerminology(): Promise<void> {
    if (this.loading()) return;
    if (this.terminologyImportWarning()) {
      this.toast.showWarning('Point Terminology Services at a writable server, not VSAC.', 'Import');
      return;
    }
    const vs = this.loadedValueSet();
    if (!vs) {
      this.toast.showWarning('Load a value set first.', 'Import');
      return;
    }
    const exp = this.expandedValueSet();
    const toSend = exp && exp.expansion ? exp : vs;
    await this.postValueSetToTerminologyServer(toSend as ValueSet);
  }

  async importSearchValueSetToTerminology(vs: ValueSet): Promise<void> {
    if (this.loading()) return;
    if (this.terminologyImportWarning()) {
      this.toast.showWarning('Point Terminology Services at a writable server, not VSAC.', 'Import');
      return;
    }
    await this.postValueSetToTerminologyServer(vs);
  }

  private async postValueSetToTerminologyServer(toSend: ValueSet): Promise<void> {
    const collection: Bundle<Resource> = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: toSend as Resource }]
    };
    this.loading.set(true);
    try {
      await firstValueFrom(this.terminology.postBundle(collection));
      this.toast.showSuccess('ValueSet posted to terminology server.', 'Import');
    } catch (e) {
      this.toast.showError(this.errMsg(e), 'Import failed');
    } finally {
      this.loading.set(false);
    }
  }

  expansionRows(): { code?: string; display?: string; system?: string }[] {
    return this.expandedValueSet()?.expansion?.contains ?? [];
  }
}

function extractPackageRelatedTypes(cap: CapabilityStatement | null): string[] {
  if (!cap?.rest?.length) return [];
  const types = new Set<string>();
  const keywords = ['package', 'Package', 'valuesetpackage', 'ValueSetPackage'];
  for (const rest of cap.rest) {
    for (const r of rest.resource ?? []) {
      const t = r.type;
      if (!t) continue;
      if (keywords.some((k) => t.includes(k))) types.add(t);
    }
  }
  return [...types].sort();
}
