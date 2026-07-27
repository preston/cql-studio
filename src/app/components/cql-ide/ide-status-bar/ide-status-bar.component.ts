// Author: Preston Lee

import { Component, input } from '@angular/core';
import { IdeContextType } from '../../../models/ide-context.model';

@Component({
  selector: 'app-ide-status-bar',
  imports: [],
  templateUrl: './ide-status-bar.component.html',

  styleUrls: ['./ide-status-bar.component.scss']
})
export class IdeStatusBarComponent {
  editorState = input<any>();
  isExecuting = input<boolean>(false);
  isEvaluating = input<boolean>(false);
  isTranslating = input<boolean>(false);
  executionProgress = input<number>(0);
  executionStatus = input<string>('');
  selectedContextCount = input<number>(0);
  contextType = input<IdeContextType>('Patient');
  isLoadingLibraries = input<boolean>(false);

  get cursorPosition() {
    return this.editorState()?.cursorPosition;
  }

  get wordCount() {
    return this.editorState()?.wordCount;
  }

  get isValidSyntax() {
    return this.editorState()?.isValidSyntax;
  }
}
