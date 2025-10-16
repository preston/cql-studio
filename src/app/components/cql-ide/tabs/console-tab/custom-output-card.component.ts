// Author: Preston Lee

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OutputSection } from '../../shared/ide-types';

@Component({
  selector: 'app-custom-output-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './custom-output-card.component.html',
  styleUrls: ['./custom-output-card.component.scss']
})
export class CustomOutputCardComponent {
  @Input() section!: OutputSection;

  getCardClass(): string {
    return `custom-card-${this.section.type}`;
  }

  getCardIcon(): string {
    switch (this.section.type) {
      case 'cql-execution':
        return 'bi-play-circle-fill';
      case 'cql-translation':
        return 'bi-translate';
      case 'cql-validation':
        return 'bi-check-circle-fill';
      default:
        return 'bi-card-text';
    }
  }

  getStatusBadgeClass(): string {
    switch (this.section.status) {
      case 'success':
        return 'bg-success';
      case 'error':
        return 'bg-danger';
      case 'pending':
        return 'bg-warning';
      default:
        return 'bg-secondary';
    }
  }

  getCardType(): string {
    // Determine card type based on metadata or title patterns
    if (this.section.metadata?.['libraryName'] && this.section.metadata?.['patientName']) {
      return 'cql-execution';
    } else if (this.section.metadata?.['cqlVersion'] && this.section.metadata?.['contentType'] === 'elm') {
      return 'cql-translation';
    } else if (this.section.metadata?.['validationType'] === 'cql') {
      return 'cql-validation';
    }
    return 'default';
  }
}
