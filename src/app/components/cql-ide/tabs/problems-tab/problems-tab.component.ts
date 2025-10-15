// Author: Preston Lee

import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IdeStateService } from '../../../../services/ide-state.service';

@Component({
  selector: 'app-problems-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './problems-tab.component.html',
  styleUrls: ['./problems-tab.component.scss']
})
export class ProblemsTabComponent implements OnInit {
  get syntaxErrors() {
    return this.ideStateService.editorState().syntaxErrors;
  }
  
  get isValidSyntax() {
    return this.ideStateService.editorState().isValidSyntax;
  }

  constructor(public ideStateService: IdeStateService) {}

  ngOnInit(): void {
    // Component initialization
  }
}
