// Author: Preston Lee

import { Component } from '@angular/core';

@Component({
  selector: 'app-results-documentation',
  imports: [],
  templateUrl: './results-documentation.component.html',

  styleUrl: './results-documentation.component.scss'
})
export class ResultsDocumentationComponent {
  activeTab: string = 'query-parameters';

  setActiveTab(tab: string): void {
    this.activeTab = tab;
  }
}
