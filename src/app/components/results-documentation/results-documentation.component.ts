// Author: Preston Lee

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-results-documentation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results-documentation.component.html',
  styleUrl: './results-documentation.component.scss'
})
export class ResultsDocumentationComponent {
  activeTab: string = 'query-parameters';

  setActiveTab(tab: string): void {
    this.activeTab = tab;
  }
}
