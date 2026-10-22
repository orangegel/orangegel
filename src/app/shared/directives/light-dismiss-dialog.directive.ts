import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * Implements the `light-dismiss-a-dialog` Modern Web Guidance pattern.
 * Ensures `<dialog closedby="any">` works natively in browsers that support `closedBy`,
 * and provides the mandatory bounding-box click fallback for Safari / macOS WKWebView.
 */
@Directive({
  selector: 'dialog[ogLightDismiss], dialog[closedby="any"]',
  standalone: true
})
export class LightDismissDialogDirective implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLDialogElement>>(ElementRef);
  private clickHandler: ((event: MouseEvent) => void) | null = null;

  ngOnInit(): void {
    const dialog = this.el.nativeElement;
    if (!dialog.hasAttribute('closedby')) {
      dialog.setAttribute('closedby', 'any');
    }

    if (typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
      this.clickHandler = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };
      dialog.addEventListener('click', this.clickHandler);
    }
  }

  ngOnDestroy(): void {
    if (this.clickHandler) {
      this.el.nativeElement.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
  }
}
