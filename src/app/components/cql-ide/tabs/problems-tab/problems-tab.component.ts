// Author: Preston Lee

import { Component, inject } from '@angular/core';
import { IdeStateService } from '../../../../services/ide-state.service';

@Component({
  selector: 'app-problems-tab',
  imports: [],
  templateUrl: './problems-tab.component.html',

  styleUrls: ['./problems-tab.component.scss']
})
export class ProblemsTabComponent {
  protected readonly ideStateService = inject(IdeStateService);

  get syntaxErrors() {
    return this.ideStateService.editorState().syntaxErrors;
  }
  
  get isValidSyntax() {
    return this.ideStateService.editorState().isValidSyntax;
  }

  getErrorMessage(error: string): string {
    return error.replace(/\s*\(line\s+\d+(?:,\s*column\s+\d+)?\)\s*$/i, '').trim();
  }

  getErrorLine(error: string): number | null {
    const match = error.match(/\(line\s+(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    return null;
  }
}
