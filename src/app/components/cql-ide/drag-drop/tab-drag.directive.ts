// Author: Preston Lee

import { Directive, ElementRef, HostListener, inject, input, output } from '@angular/core';

@Directive({
  selector: '[appTabDrag]'
})
export class TabDragDirective {
  tabData = input<any>();
  dragEnabled = input<boolean>(true);

  dragStart = output<any>();
  dragEnd = output<any>();

  private readonly elementRef = inject(ElementRef);
  private dragImageElement?: HTMLElement;

  @HostListener('dragstart', ['$event'])
  onDragStart(event: DragEvent): void {
    if (!this.dragEnabled()) {
      event.preventDefault();
      return;
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify(this.tabData()));
      
      // Add visual feedback
      this.elementRef.nativeElement.classList.add('dragging');
      
      // Create custom drag image
      const dragImage = this.createDragImage();
      event.dataTransfer.setDragImage(dragImage, 0, 0);
      
      this.dragStart.emit(this.tabData());
    }
  }

  @HostListener('dragend', ['$event'])
  onDragEnd(event: DragEvent): void {
    this.elementRef.nativeElement.classList.remove('dragging');
    this.removeDragImage();
    this.dragEnd.emit(this.tabData());
  }

  private removeDragImage(): void {
    if (this.dragImageElement && document.body.contains(this.dragImageElement)) {
      document.body.removeChild(this.dragImageElement);
    }
    this.dragImageElement = undefined;
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
    dragImage.textContent = this.tabData()?.title || 'Tab';

    document.body.appendChild(dragImage);
    this.dragImageElement = dragImage;

    return dragImage;
  }
}
