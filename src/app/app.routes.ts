// Author: Preston Lee

import { Routes } from '@angular/router';
import { CqlIdeComponent } from './components/cql-ide/cql-ide.component';
import { IdeLayoutComponent } from './components/ide-layout/ide-layout.component';
import { OpenComponent } from './components/open/open.component';
import { ResultsViewerComponent } from './components/results-viewer/results-viewer.component';
import { ResultsDocumentationComponent } from './components/results-documentation/results-documentation.component';
import { RunnerDocumentationComponent } from './components/runner-documentation/runner-documentation.component';
import { SettingsComponent } from './components/settings/settings.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { RunnerComponent } from './components/runner/runner.component';
import { FhirUploaderComponent } from './components/fhir-uploader/fhir-uploader.component';
import { TerminologyLayoutComponent } from './components/terminology/terminology-layout.component';
import { ValueSetsTabComponent } from './components/terminology/valuesets-tab/valuesets-tab.component';
import { ConceptMapsTabComponent } from './components/terminology/conceptmaps-tab/conceptmaps-tab.component';
import { CodeSystemsTabComponent } from './components/terminology/codesystems-tab/codesystems-tab.component';
import { ValidationTabComponent } from './components/terminology/validation-tab/validation-tab.component';
import { CodeSearchTabComponent } from './components/terminology/code-search-tab/code-search-tab.component';
import { AboutComponent } from './components/about/about.component';
import { LandingComponent } from './components/landing/landing.component';
import { GuidelinesComponent } from './components/guidelines/guidelines.component';
import { MeasureEditorComponent } from './components/measure-editor/measure-editor.component';
import { MeasureLibraryComponent } from './components/measure-editor/measure-library/measure-library.component';
import { MeasureWorkspaceComponent } from './components/measure-editor/measure-workspace/measure-workspace.component';
import { MeasureReportsListComponent } from './components/measure-editor/measure-reports-list/measure-reports-list.component';
import { MeasureReportViewerComponent } from './components/measure-editor/measure-report-viewer/measure-report-viewer.component';
import { ClipboardManagerComponent } from './components/clipboard-manager/clipboard-manager.component';
import { VsacBrowserComponent } from './components/vsac-browser/vsac-browser.component';
import { FhirRegistryImporterComponent } from './components/fhir-registry-importer/fhir-registry-importer.component';
import { ExportComponent } from './components/export/export.component';
import { SqlOnFhirComponent } from './components/sql-on-fhir/sql-on-fhir.component';
import { sqlOnFhirGuard } from './components/sql-on-fhir/sql-on-fhir.guard';
import { ExamplesComponent } from './components/examples/examples.component';
import { LipidManagementExampleComponent } from './components/examples/lipid-management-example/lipid-management-example.component';
import { HospitalAtHomeExampleComponent } from './components/examples/hospital-at-home-example/hospital-at-home-example.component';
import { TeamDashboardComponent } from './components/team/team-dashboard/team-dashboard.component';
import { TeamWorkspacesComponent } from './components/team/team-workspaces/team-workspaces.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  // Normal app routes
  { path: '', component: LandingComponent, pathMatch: 'full' },
  { path: 'results/open', component: OpenComponent },
  { path: 'results', component: ResultsViewerComponent },
  { path: 'documentation', redirectTo: '/documentation/results', pathMatch: 'full' },
  { path: 'documentation/results', component: ResultsDocumentationComponent },
  { path: 'documentation/runner', component: RunnerDocumentationComponent },
  { path: 'settings', component: SettingsComponent },
  {
    path: 'examples',
    component: ExamplesComponent,
    children: [
      { path: '', redirectTo: 'lipid-management', pathMatch: 'full' },
      { path: 'lipid-management', component: LipidManagementExampleComponent },
      { path: 'hospital-at-home', component: HospitalAtHomeExampleComponent }
    ]
  },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'team/dashboard', component: TeamDashboardComponent, canActivate: [authGuard] },
  { path: 'team/workspaces', component: TeamWorkspacesComponent, canActivate: [authGuard] },
  { path: 'team/workspaces/:workspaceId', component: TeamWorkspacesComponent, canActivate: [authGuard] },
  { path: 'runner', component: RunnerComponent },
  { path: 'uploader', component: FhirUploaderComponent },
  { 
    path: 'terminology', 
    component: TerminologyLayoutComponent,
    children: [
      { path: '', redirectTo: 'valuesets', pathMatch: 'full' },
      { path: 'valuesets', component: ValueSetsTabComponent },
      { path: 'conceptmaps', component: ConceptMapsTabComponent },
      { path: 'codesystems', component: CodeSystemsTabComponent },
      { path: 'validation', component: ValidationTabComponent },
      { path: 'search', component: CodeSearchTabComponent }
    ]
  },
  { path: 'measure-reports', component: MeasureReportsListComponent },
  { path: 'measure-reports/:reportId', component: MeasureReportViewerComponent },
  { path: 'measures/reports/:reportId', redirectTo: 'measure-reports/:reportId' },
  { path: 'measures/reports', redirectTo: 'measure-reports', pathMatch: 'full' },
  {
    path: 'measures',
    component: MeasureEditorComponent,
    children: [
      { path: '', component: MeasureLibraryComponent },
      { path: 'new', component: MeasureWorkspaceComponent },
      { path: ':id', component: MeasureWorkspaceComponent }
    ]
  },
  { path: 'vsac', component: VsacBrowserComponent },
  // Short alias; Angular preserves ?package=&version= on redirect for external deep links.
  { path: 'fhir-registry', redirectTo: 'fhir-registry-importer', pathMatch: 'full' },
  { path: 'fhir-registry-importer', component: FhirRegistryImporterComponent },
  { path: 'export', component: ExportComponent },
  { path: 'guidelines', component: GuidelinesComponent },
  { path: 'guidelines/:id/testing', component: GuidelinesComponent },
  { path: 'guidelines/:id', component: GuidelinesComponent },
  { path: 'sql', component: SqlOnFhirComponent, canActivate: [sqlOnFhirGuard] },
  { path: 'about', component: AboutComponent },
  { path: 'clipboard', component: ClipboardManagerComponent },

  // IDE routes with separate layout
  { 
    path: 'ide', 
    component: IdeLayoutComponent,
    children: [
      { path: '', component: CqlIdeComponent },
      { path: 'results', component: CqlIdeComponent },
      { path: 'documentation', component: CqlIdeComponent },
      { path: 'documentation/results', component: CqlIdeComponent },
      { path: 'documentation/runner', component: CqlIdeComponent },
      { path: 'settings', component: CqlIdeComponent },
      { path: 'dashboard', component: CqlIdeComponent },
      { path: 'runner', component: CqlIdeComponent }
    ]
  },
  
  { path: '**', redirectTo: '' }
];
