// Author: Preston Lee

import { Component } from '@angular/core';
import { ExampleImportCtaComponent } from '../example-import-cta/example-import-cta.component';
import { findExampleById } from '../examples.catalog';

@Component({
  selector: 'app-glp1-prescribing-example',
  imports: [ExampleImportCtaComponent],
  templateUrl: './glp1-prescribing-example.component.html'
})
export class GLP1PrescribingExampleComponent {
  protected readonly example = findExampleById('glp1')!;
}
