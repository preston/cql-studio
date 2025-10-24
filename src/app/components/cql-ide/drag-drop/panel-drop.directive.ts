// Author: Preston Lee

import { Directive, ElementRef, HostListener, Input, Output, EventEmitter } from '@angular/core';

@Directive({
  selector: '[appPanelDrop]'
})
export class PanelDropDirective {
  @Input() panelId: string = '';
  @Input() dropEnabled: boolean = true;
  @Input() acceptedTabTypes: string[] = [];
  
  @Output() tabDrop = new EventEmitter<{ tabData: any; panelId: string }>();
  @Output() dragOver = new EventEmitter<{ panelId: string; event: DragEvent }>();
  @Output() dragLeave = new EventEmitter<{ panelId: string; event: DragEvent }>();

  constructor(private elementRef: ElementRef) {}

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    if (!this.dropEnabled) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    
    // Add visual feedback
    this.elementRef.nativeElement.classList.add('drag-over');
    
    this.dragOver.emit({ panelId: this.panelId, event });
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    if (!this.dropEnabled) return;
    
    // Only remove visual feedback if we're actually leaving the element
    const rect = this.elementRef.nativeElement.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      this.elementRef.nativeElement.classList.remove('drag-over');
      this.dragLeave.emit({ panelId: this.panelId, event });
    }
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    if (!this.dropEnabled) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    // Remove visual feedback
    this.elementRef.nativeElement.classList.remove('drag-over');
    
    try {
      const tabData = JSON.parse(event.dataTransfer?.getData('text/plain') || '{}');
      
      // Validate tab type if restrictions are set
      if (this.acceptedTabTypes.length > 0 && !this.acceptedTabTypes.includes(tabData.type)) {
        console.warn(`Tab type '${tabData.type}' not accepted by panel '${this.panelId}'`);
        return;
      }
      
      this.tabDrop.emit({ tabData, panelId: this.panelId });
    } catch (error) {
      console.error('Error handling tab drop:', error);
    }
  }

  @HostListener('dragenter', ['$event'])
  onDragEnter(event: DragEvent): void {
    if (!this.dropEnabled) return;
    
    event.preventDefault();
    event.stopPropagation();
  }
}
