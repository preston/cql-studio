// Author: Preston Lee

import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-ide-status-bar',
  standalone: true,
  imports: [],
  templateUrl: './ide-status-bar.component.html',
  styleUrls: ['./ide-status-bar.component.scss']
})
export class IdeStatusBarComponent {
  @Input() editorState: any;
  @Input() isExecuting: boolean = false;
  @Input() isEvaluating: boolean = false;
  @Input() isTranslating: boolean = false;
  @Input() executionProgress: number = 0;
  @Input() executionStatus: string = '';
  @Input() cqlVersion: string = '1.5.3';
  @Input() selectedPatientsCount: number = 0;
  @Input() isLoadingLibraries: boolean = false;

  get cursorPosition() {
    return this.editorState?.cursorPosition;
  }

  get wordCount() {
    return this.editorState?.wordCount;
  }

  get isValidSyntax() {
    return this.editorState?.isValidSyntax;
  }
}
