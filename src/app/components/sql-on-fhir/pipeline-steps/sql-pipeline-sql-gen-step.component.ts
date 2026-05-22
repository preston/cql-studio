// Author: Preston Lee

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SyntaxHighlighterComponent } from '../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-sql-pipeline-sql-gen-step',
  standalone: true,
  imports: [SyntaxHighlighterComponent],
  templateUrl: './sql-pipeline-sql-gen-step.component.html',
  styleUrl: './sql-pipeline-sql-gen-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SqlPipelineSqlGenStepComponent {
  readonly sqlText = input('');
}
