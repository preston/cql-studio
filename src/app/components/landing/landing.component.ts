// Author: Preston Lee

import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  templateUrl: './landing.component.html',

  styleUrl: './landing.component.scss'
})
export class LandingComponent {
  private readonly settingsService = inject(SettingsService);

  readonly fhirBaseUrl = computed(() => this.settingsService.getEffectiveFhirBaseUrl());
  readonly terminologyBaseUrl = computed(() => this.settingsService.getEffectiveTerminologyBaseUrl());
}
