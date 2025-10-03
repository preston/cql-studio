// Author: Preston Lee

import { Routes } from '@angular/router';
import { OpenComponent } from './components/open/open.component';
import { ResultsViewerComponent } from './components/results-viewer/results-viewer.component';
import { ResultsDocumentationComponent } from './components/results-documentation/results-documentation.component';
import { RunnerDocumentationComponent } from './components/runner-documentation/runner-documentation.component';
import { SettingsComponent } from './components/settings/settings.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { RunnerComponent } from './components/runner/runner.component';
import { FhirExplorerComponent } from './components/fhir-explorer/fhir-explorer.component';

export const routes: Routes = [
  { path: '', component: OpenComponent },
  { path: 'results', component: ResultsViewerComponent },
  { path: 'documentation', redirectTo: '/documentation/results', pathMatch: 'full' },
  { path: 'documentation/results', component: ResultsDocumentationComponent },
  { path: 'documentation/runner', component: RunnerDocumentationComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'runner', component: RunnerComponent },
  { path: 'fhir-explorer', component: FhirExplorerComponent },
  { path: '**', redirectTo: '' }
];
