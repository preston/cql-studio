// Author: Preston Lee

import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IdeStateService } from '../../../../services/ide-state.service';
import { OutputSection } from '../../shared/ide-types';

@Component({
  selector: 'app-output-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './output-tab.component.html',
  styleUrls: ['./output-tab.component.scss']
})
export class OutputTabComponent implements OnInit {
  @Input() preserveLogs: boolean = false;
  @Input() isEvaluating: boolean = false;
  @Input() executionProgress: number = 0;
  @Input() executionStatus: string = '';
  
  @Output() clearOutput = new EventEmitter<void>();
  @Output() copyOutput = new EventEmitter<void>();
  @Output() toggleAllSections = new EventEmitter<void>();
  @Output() preserveLogsChange = new EventEmitter<boolean>();

  get outputSections() {
    return this.ideStateService.outputSections;
  }
  public allSectionsExpanded = false;

  constructor(public ideStateService: IdeStateService) {}

  ngOnInit(): void {
    // Component initialization
  }

  onClearOutput(): void {
    this.clearOutput.emit();
  }

  onCopyOutput(): void {
    this.copyOutput.emit();
  }

  onToggleAllSections(): void {
    this.allSectionsExpanded = !this.allSectionsExpanded;
    this.toggleAllSections.emit();
  }

  onToggleSection(index: number): void {
    if (index >= 0 && index < this.outputSections().length) {
      const sections = [...this.outputSections()];
      sections[index] = { ...sections[index], expanded: !sections[index].expanded };
      this.ideStateService.setOutputSections(sections);
    }
  }

  onPreserveLogsChange(value: boolean): void {
    this.preserveLogsChange.emit(value);
  }
}
