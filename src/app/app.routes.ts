// Author: Preston Lee

import { Routes } from '@angular/router';
import { CqlIdeComponent } from './components/cql-ide/cql-ide.component';
import { OpenComponent } from './components/open/open.component';
import { ResultsViewerComponent } from './components/results-viewer/results-viewer.component';
import { ResultsDocumentationComponent } from './components/results-documentation/results-documentation.component';
import { RunnerDocumentationComponent } from './components/runner-documentation/runner-documentation.component';
import { SettingsComponent } from './components/settings/settings.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { RunnerComponent } from './components/runner/runner.component';

export const routes: Routes = [
  // Normal app routes
  { path: '', component: OpenComponent },
  { path: 'results', component: ResultsViewerComponent },
  { path: 'documentation', redirectTo: '/documentation/results', pathMatch: 'full' },
  { path: 'documentation/results', component: ResultsDocumentationComponent },
  { path: 'documentation/runner', component: RunnerDocumentationComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'runner', component: RunnerComponent },
  { path: 'cql-with-fhir', component: CqlIdeComponent },
  
  // IDE routes
  { path: 'ide', component: CqlIdeComponent },
  { path: 'ide/results', component: CqlIdeComponent },
  { path: 'ide/documentation', component: CqlIdeComponent },
  { path: 'ide/documentation/results', component: CqlIdeComponent },
  { path: 'ide/documentation/runner', component: CqlIdeComponent },
  { path: 'ide/settings', component: CqlIdeComponent },
  { path: 'ide/dashboard', component: CqlIdeComponent },
  { path: 'ide/runner', component: CqlIdeComponent },
  { path: 'ide/cql-with-fhir', component: CqlIdeComponent },
  
  { path: '**', redirectTo: '' }
];
