// Author: Preston Lee

import { Component, input } from '@angular/core';

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
  selectedPatientsCount = input<number>(0);
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
