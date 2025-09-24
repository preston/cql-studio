// Author: Preston Lee

import { Routes } from '@angular/router';
import { OpenComponent } from './components/open/open.component';
import { ResultsViewerComponent } from './components/results-viewer/results-viewer.component';
import { DocumentationComponent } from './components/documentation/documentation.component';
import { SettingsComponent } from './components/settings/settings.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';

export const routes: Routes = [
  { path: '', component: OpenComponent },
  { path: 'results', component: ResultsViewerComponent },
  { path: 'documentation', component: DocumentationComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'dashboard', component: DashboardComponent },
  { path: '**', redirectTo: '' }
];
