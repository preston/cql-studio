// Author: Preston Lee

import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

export type TerminologyOpenResourceType = 'ValueSet' | 'CodeSystem';

export interface TerminologyOpenRequest {
  resourceType: TerminologyOpenResourceType;
  id: string;
  url?: string;
}

@Injectable({
  providedIn: 'root',
})
export class TerminologyResourceOpenerService {
  private readonly router = inject(Router);

  private readonly _pending = signal<TerminologyOpenRequest | null>(null);

  readonly pending = this._pending.asReadonly();

  async requestOpen(request: TerminologyOpenRequest): Promise<boolean> {
    const id = request.id.trim();
    if (!id) {
      return false;
    }
    this._pending.set({
      resourceType: request.resourceType,
      id,
      url: request.url?.trim() || undefined,
    });
    const path =
      request.resourceType === 'ValueSet'
        ? '/terminology/valuesets'
        : '/terminology/codesystems';
    const navigated = await this.router.navigateByUrl(path);
    if (!navigated) {
      this._pending.set(null);
    }
    return navigated;
  }

  consumePending(expectedType: TerminologyOpenResourceType): TerminologyOpenRequest | null {
    const current = this._pending();
    if (!current || current.resourceType !== expectedType) {
      return null;
    }
    this._pending.set(null);
    return current;
  }
}
