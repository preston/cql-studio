// Author: Preston Lee

import { Component, input } from '@angular/core';
import { CqlReadonlyPreviewComponent } from '../../shared/cql-readonly-preview/cql-readonly-preview.component';

@Component({
  selector: 'app-sql-pipeline-cql-step',
  imports: [CqlReadonlyPreviewComponent],
  templateUrl: './sql-pipeline-cql-step.component.html',
  styleUrl: './sql-pipeline-cql-step.component.scss'
})
export class SqlPipelineCqlStepComponent {
  readonly cqlPreview = input('');
}
