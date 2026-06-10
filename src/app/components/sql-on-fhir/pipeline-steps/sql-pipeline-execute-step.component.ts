// Author: Preston Lee

import { Component, input, output } from '@angular/core';
import { SyntaxHighlighterComponent } from '../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-sql-pipeline-execute-step',
  imports: [SyntaxHighlighterComponent],
  templateUrl: './sql-pipeline-execute-step.component.html',
  styleUrl: './sql-pipeline-execute-step.component.scss',

})
export class SqlPipelineExecuteStepComponent {
  readonly sqlText = input('');
  readonly sqlResultsRaw = input('');
  readonly measureReportJson = input('');
  readonly sqlExecutionStatus = input<string | null>(null);
  readonly measureReportStatus = input<string | null>(null);
  readonly hasMeasureReport = input(false);
  readonly isExecutingSql = input(false);
  readonly canSaveMeasureReport = input(false);

  readonly executeSql = output<void>();
  readonly generateMeasureReport = output<void>();
  readonly saveMeasureReport = output<void>();
}
