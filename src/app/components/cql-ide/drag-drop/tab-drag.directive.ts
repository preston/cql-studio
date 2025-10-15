// Author: Preston Lee

import { Directive, ElementRef, HostListener, Input, Output, EventEmitter } from '@angular/core';

@Directive({
  selector: '[appTabDrag]'
})
export class TabDragDirective {
  @Input() tabData: any;
  @Input() dragEnabled: boolean = true;
  
  @Output() dragStart = new EventEmitter<any>();
  @Output() dragEnd = new EventEmitter<any>();

  constructor(private elementRef: ElementRef) {}

  @HostListener('dragstart', ['$event'])
  onDragStart(event: DragEvent): void {
    if (!this.dragEnabled) {
      event.preventDefault();
      return;
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify(this.tabData));
      
      // Add visual feedback
      this.elementRef.nativeElement.classList.add('dragging');
      
      // Create custom drag image
      const dragImage = this.createDragImage();
      event.dataTransfer.setDragImage(dragImage, 0, 0);
      
      this.dragStart.emit(this.tabData);
    }
  }

  @HostListener('dragend', ['$event'])
  onDragEnd(event: DragEvent): void {
    // Remove visual feedback
    this.elementRef.nativeElement.classList.remove('dragging');
    
    this.dragEnd.emit(this.tabData);
  }

  private createDragImage(): HTMLElement {
    const dragImage = document.createElement('div');
    dragImage.style.cssText = `
      position: absolute;
      top: -1000px;
      left: -1000px;
      background: var(--ide-blue);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      z-index: 1000;
    `;
    dragImage.textContent = this.tabData?.title || 'Tab';
    
    document.body.appendChild(dragImage);
    
    // Clean up after a short delay
    setTimeout(() => {
      if (document.body.contains(dragImage)) {
        document.body.removeChild(dragImage);
      }
    }, 100);
    
    return dragImage;
  }
}
