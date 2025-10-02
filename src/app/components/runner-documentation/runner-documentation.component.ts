// Author: Preston Lee

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-runner-documentation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './runner-documentation.component.html',
  styleUrl: './runner-documentation.component.scss'
})
export class RunnerDocumentationComponent {
  activeTab: string = 'overview';

  setActiveTab(tab: string): void {
    this.activeTab = tab;
  }
}
