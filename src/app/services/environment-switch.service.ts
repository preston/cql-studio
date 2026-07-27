// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { EnvironmentService } from './environment.service';
import { SettingsService } from './settings.service';
import { PatientService } from './patient.service';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { FhirCapabilityService } from './fhir-capability.service';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root'
})
export class EnvironmentSwitchService {
  private readonly environmentService = inject(EnvironmentService);
  private readonly settingsService = inject(SettingsService);
  private readonly patientService = inject(PatientService);
  private readonly librarySourceService = inject(CqlLibrarySourceService);
  private readonly fhirCapabilityService = inject(FhirCapabilityService);
  private readonly toastService = inject(ToastService);

  activateEnvironment(id: string, options?: { showToast?: boolean }): boolean {
    const previousId = this.environmentService.getActiveEnvironmentIdSnapshot();
    const env = this.environmentService.setActiveEnvironment(id);
    if (!env) {
      return false;
    }
    this.settingsService.persistEnvironmentToSettings();
    this.settingsService.saveSettings();

    if (previousId !== id) {
      this.patientService.clearSelection();
      this.librarySourceService.invalidate();
      this.fhirCapabilityService.clearCache();
      this.fhirCapabilityService.loadMetadata();
      if (options?.showToast !== false) {
        this.toastService.showInfo(
          'Patient selection and cached libraries were cleared.',
          `Environment: ${env.name}`
        );
      }
    }
    return true;
  }
}
