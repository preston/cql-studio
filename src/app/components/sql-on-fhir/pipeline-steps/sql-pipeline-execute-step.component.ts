// Author: Preston Lee

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-sql-pipeline-execute-step',
  standalone: true,
  templateUrl: './sql-pipeline-execute-step.component.html',
  styleUrl: './sql-pipeline-execute-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SqlPipelineExecuteStepComponent {
  readonly sqlText = input('');
  readonly sqlResultsRaw = input('');
  readonly measureReportJson = input('');
  readonly pipelineStatus = input<string | null>(null);
  readonly hasMeasureReport = input(false);

  readonly executeSql = output<void>();
  readonly generateMeasureReport = output<void>();
  readonly saveMeasureReport = output<void>();
}
