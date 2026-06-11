// Author: Preston Lee

import { Component } from '@angular/core';

@Component({
  selector: 'app-runner-documentation',
  imports: [],
  templateUrl: './runner-documentation.component.html',

  styleUrl: './runner-documentation.component.scss'
})
export class RunnerDocumentationComponent {
  activeTab: string = 'overview';

  setActiveTab(tab: string): void {
    this.activeTab = tab;
  }
}
