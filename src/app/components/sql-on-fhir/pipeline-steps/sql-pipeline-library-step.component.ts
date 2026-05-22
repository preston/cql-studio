// Author: Preston Lee

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SyntaxHighlighterComponent } from '../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-sql-pipeline-library-step',
  standalone: true,
  imports: [SyntaxHighlighterComponent],
  templateUrl: './sql-pipeline-library-step.component.html',
  styleUrl: './sql-pipeline-library-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SqlPipelineLibraryStepComponent {
  readonly libraryId = input.required<string>();
  readonly libraryJson = input.required<string>();
}
