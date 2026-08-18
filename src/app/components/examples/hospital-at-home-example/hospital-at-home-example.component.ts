// Author: Preston Lee

import { Component } from '@angular/core';
import { ExampleImportCtaComponent } from '../example-import-cta/example-import-cta.component';
import { findExampleById } from '../examples.catalog';
import { ExamplePaths } from '../../../constants/example-paths.constants';

@Component({
  selector: 'app-hospital-at-home-example',
  imports: [ExampleImportCtaComponent],
  templateUrl: './hospital-at-home-example.component.html'
})
export class HospitalAtHomeExampleComponent {
  protected readonly example = findExampleById('hospital-at-home')!;
  protected readonly packageName = 'nu-primes.fhir.hah-eligibility-leff';
  protected readonly packageVersion = '1.1.0';
  protected readonly packageUrl = ExamplePaths.HOSPITAL_AT_HOME_PACKAGE;
}
