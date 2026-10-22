import { Injectable } from '@angular/core';
import anime from 'animejs';

@Injectable({ providedIn: 'root' })
export class MotionService {
  prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Spring-physics viewport & orientation morphing for DevicePreviewBrowserComponent.
   * Uses `spring(1, 80, 12, 0)` unless reduced motion is active.
   */
  animateViewportTransition(
    element: HTMLElement | null,
    targetWidth: number,
    targetHeight: number,
    targetBorderRadius: number
  ): void {
    if (!element) return;
    if (this.prefersReducedMotion()) {
      element.style.width = `${targetWidth}px`;
      element.style.height = `${targetHeight}px`;
      element.style.borderRadius = `${targetBorderRadius}px`;
      return;
    }

    anime.remove(element);
    anime({
      targets: element,
      width: `${targetWidth}px`,
      height: `${targetHeight}px`,
      borderRadius: `${targetBorderRadius}px`,
      easing: 'spring(1, 80, 12, 0)'
    });
  }

  /**
   * Choreographs deploy pipeline step transitions via Anime.js timeline.
   */
  animateDeployStep(element: HTMLElement | null): void {
    if (!element || this.prefersReducedMotion()) return;
    anime.remove(element);
    const tl = anime.timeline({
      easing: 'easeOutExpo',
      duration: 420
    });
    tl.add({
      targets: element,
      scale: [0.96, 1],
      opacity: [0.65, 1]
    });
  }

  /**
   * Staggered entrance for log/issue/node cards (`anime.stagger(35)`).
   */
  staggerCards(elements: HTMLElement[] | NodeListOf<Element> | null): void {
    if (!elements || this.prefersReducedMotion()) return;
    const list = Array.from(elements);
    if (list.length === 0) return;
    anime.remove(list);
    anime({
      targets: list,
      translateY: [6, 0],
      opacity: [0, 1],
      delay: anime.stagger(35),
      duration: 260,
      easing: 'easeOutQuad'
    });
  }
}
