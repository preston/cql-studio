// Author: Preston Lee

import { Component, input } from '@angular/core';
import { SyntaxHighlighterComponent } from '../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-sql-pipeline-cql-step',
  imports: [SyntaxHighlighterComponent],
  templateUrl: './sql-pipeline-cql-step.component.html',
  styleUrl: './sql-pipeline-cql-step.component.scss'
})
export class SqlPipelineCqlStepComponent {
  readonly cqlPreview = input('');
}
