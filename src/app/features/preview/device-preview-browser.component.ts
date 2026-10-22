import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ViewportMode, ViewportZoom } from '../../core/bridge/models';
import { MotionService } from '../../core/services/motion.service';
import { VIEWPORT_PRESETS, WorkspaceStore } from '../../core/state/workspace.store';
import { OgLucideIconsModule } from '../../shared/icons/lucide-icons.module';
import { SiteGraph3DComponent } from '../spatial/site-graph-3d.component';

@Component({
  selector: 'og-device-preview-browser',
  standalone: true,
  imports: [CommonModule, FormsModule, OgLucideIconsModule, SiteGraph3DComponent],
  template: `
    <div class="flex flex-col flex-1 min-h-0 bg-og-bg">
      <!-- Top Viewport Mode & Preset Switcher Toolbar -->
      <div class="bg-og-surface border-b border-og-border px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <!-- Segmented Mode Switcher: Desktop | Tablet | Mobile | Compare | 3D Site Graph -->
        <div class="flex items-center bg-og-bg p-0.5 rounded-lg border border-og-border">
          <button
            type="button"
            (click)="setMode('desktop')"
            class="px-2 py-1 rounded-md text-xs flex items-center gap-1 transition"
            [class.bg-og-amber]="store.previewState().mode === 'desktop'"
            [class.text-og-bg]="store.previewState().mode === 'desktop'"
            [class.font-semibold]="store.previewState().mode === 'desktop'"
            [class.text-og-muted]="store.previewState().mode !== 'desktop'"
          >
            <lucide-icon name="monitor" class="w-3.5 h-3.5"></lucide-icon>
            Desktop
          </button>
          <button
            type="button"
            (click)="setMode('tablet')"
            class="px-2 py-1 rounded-md text-xs flex items-center gap-1 transition"
            [class.bg-og-amber]="store.previewState().mode === 'tablet'"
            [class.text-og-bg]="store.previewState().mode === 'tablet'"
            [class.font-semibold]="store.previewState().mode === 'tablet'"
            [class.text-og-muted]="store.previewState().mode !== 'tablet'"
          >
            <lucide-icon name="tablet" class="w-3.5 h-3.5"></lucide-icon>
            Tablet
          </button>
          <button
            type="button"
            (click)="setMode('mobile')"
            class="px-2 py-1 rounded-md text-xs flex items-center gap-1 transition"
            [class.bg-og-amber]="store.previewState().mode === 'mobile'"
            [class.text-og-bg]="store.previewState().mode === 'mobile'"
            [class.font-semibold]="store.previewState().mode === 'mobile'"
            [class.text-og-muted]="store.previewState().mode !== 'mobile'"
          >
            <lucide-icon name="smartphone" class="w-3.5 h-3.5"></lucide-icon>
            Mobile
          </button>
          <button
            type="button"
            (click)="setMode('compare')"
            class="px-2 py-1 rounded-md text-xs flex items-center gap-1 transition"
            [class.bg-og-amber]="store.previewState().mode === 'compare'"
            [class.text-og-bg]="store.previewState().mode === 'compare'"
            [class.font-semibold]="store.previewState().mode === 'compare'"
            [class.text-og-muted]="store.previewState().mode !== 'compare'"
            title="Side-by-Side Synchronized Desktop + Mobile Comparison"
          >
            <lucide-icon name="columns-2" class="w-3.5 h-3.5"></lucide-icon>
            Compare
          </button>
          <button
            type="button"
            (click)="setMode('graph3d')"
            class="px-2 py-1 rounded-md text-xs flex items-center gap-1 transition"
            [class.bg-og-amber]="store.previewState().mode === 'graph3d'"
            [class.text-og-bg]="store.previewState().mode === 'graph3d'"
            [class.font-semibold]="store.previewState().mode === 'graph3d'"
            [class.text-og-muted]="store.previewState().mode !== 'graph3d'"
            title="Three.js 3D Site Topology Constellation"
          >
            <lucide-icon name="orbit" class="w-3.5 h-3.5"></lucide-icon>
            3D Graph
          </button>
        </div>

        <!-- Preset Selector, Custom WxH, Rotate & Zoom Controls -->
        @if (store.previewState().mode !== 'graph3d') {
          <div class="flex items-center gap-1.5 text-xs">
            <select
              [ngModel]="store.previewState().presetId"
              (ngModelChange)="store.selectViewportPreset($event)"
              aria-label="Device Preset"
              class="bg-og-bg border border-og-border rounded px-2 py-1 text-xs text-og-text focus:outline-none focus:border-og-amber"
            >
              @for (preset of presets; track preset.id) {
                <option [value]="preset.id">{{ preset.name }}</option>
              }
            </select>

            @if (!isFluidDesktop()) {
              <div class="flex items-center gap-1 font-mono text-[11px] bg-og-bg border border-og-border rounded px-1.5 py-0.5">
                <input
                  type="number"
                  [ngModel]="deviceWidth()"
                  (ngModelChange)="onWidthInput($event)"
                  aria-label="Viewport Width"
                  class="w-12 bg-transparent text-center text-og-citrus focus:outline-none"
                />
                <span class="text-og-muted">×</span>
                <input
                  type="number"
                  [ngModel]="deviceHeight()"
                  (ngModelChange)="onHeightInput($event)"
                  aria-label="Viewport Height"
                  class="w-12 bg-transparent text-center text-og-citrus focus:outline-none"
                />
              </div>

              <button
                type="button"
                (click)="store.toggleOrientation()"
                class="p-1.5 rounded bg-og-bg border border-og-border text-og-muted hover:text-og-citrus transition"
                title="Rotate Portrait ⇄ Landscape (Anime.js Spring Physics)"
              >
                <lucide-icon name="rotate-cw" class="w-3.5 h-3.5"></lucide-icon>
              </button>
            }

            <select
              [ngModel]="store.previewState().zoom"
              (ngModelChange)="onZoomChange($event)"
              aria-label="Viewport Zoom"
              class="bg-og-bg border border-og-border rounded px-2 py-1 text-xs text-og-text focus:outline-none focus:border-og-amber"
            >
              <option value="autofit">Auto-Fit ({{ Math.round(scale() * 100) }}%)</option>
              <option [ngValue]="0.5">50%</option>
              <option [ngValue]="0.75">75%</option>
              <option [ngValue]="1">100%</option>
            </select>
          </div>
        }
      </div>

      <!-- Browser Chrome Address Bar -->
      <div class="bg-og-panel/70 border-b border-og-border px-3 py-1.5 flex items-center gap-2 shrink-0">
        <button
          type="button"
          (click)="store.reloadPreview()"
          class="p-1 rounded hover:bg-og-border text-og-muted hover:text-og-text transition"
          title="Reload Preview Iframe"
        >
          <lucide-icon name="refresh-cw" class="w-3.5 h-3.5"></lucide-icon>
        </button>

        <div class="flex-1 flex items-center bg-og-bg border border-og-border rounded-md px-2.5 py-1 text-xs font-mono">
          <span class="text-og-muted select-all">{{ baseServerUrl() }}</span>
          <input
            type="text"
            [ngModel]="store.previewState().route"
            (ngModelChange)="store.setPreviewRoute($event)"
            aria-label="Preview Route Path"
            class="flex-1 bg-transparent text-og-citrus focus:outline-none ml-0.5"
            placeholder="/posts/my-post/"
          />
        </div>

        <button
          type="button"
          (click)="store.toggleFollowEditor()"
          class="px-2 py-1 rounded text-[11px] flex items-center gap-1 border transition"
          [ngClass]="
            store.previewState().followEditor
              ? 'bg-og-amber/15 border-og-amber/40 text-og-citrus'
              : 'bg-og-bg border-og-border text-og-muted'
          "
          title="Follow active editor document route"
        >
          <lucide-icon name="compass" class="w-3.5 h-3.5"></lucide-icon>
          Follow Editor
        </button>

        <button
          type="button"
          (click)="store.openExternalPreview()"
          class="p-1.5 rounded bg-og-bg border border-og-border text-og-muted hover:text-og-text transition"
          title="Open in System Browser"
        >
          <lucide-icon name="external-link" class="w-3.5 h-3.5"></lucide-icon>
        </button>
      </div>

      <!-- WebKit Flex Layout Rule: relative flex-1 min-h-0 wrapper + absolute inset-0 inner stage -->
      <div class="relative flex-1 min-h-0">
        @if (store.previewState().mode === 'graph3d') {
          <og-site-graph-3d class="absolute inset-0 block"></og-site-graph-3d>
        } @else {
          <div
            #stageContainer
            class="absolute inset-0 overflow-auto flex items-center justify-center p-4 bg-[radial-gradient(#252F45_1px,transparent_1px)] [background-size:16px_16px]"
          >
            @if (store.previewState().mode === 'compare') {
              <!-- Side-by-Side Synchronized Dual Iframes (Desktop 1280×800 + Mobile 393×852) -->
              <div class="flex items-start gap-6">
                <div class="flex flex-col items-center gap-1.5">
                  <span class="text-[11px] font-mono text-og-muted">Desktop (1280×800)</span>
                  <div
                    class="viewport-sizer relative overflow-hidden rounded-lg border border-og-border shadow-2xl bg-white"
                    [style.width.px]="1280 * compareScale()"
                    [style.height.px]="800 * compareScale()"
                  >
                    @if (store.serverStatus().state === 'running') {
                      <iframe
                        [src]="safeIframeUrl()"
                        title="Desktop Compare Preview"
                        [style.width.px]="1280"
                        [style.height.px]="800"
                        [style.transform]="'scale(' + compareScale() + ')'"
                        style="transform-origin: 0 0; border: 0;"
                      ></iframe>
                    } @else {
                      <ng-container *ngTemplateOutlet="liveMockPreviewTpl; context: { deviceLabel: 'Desktop 1280×800' }"></ng-container>
                    }
                  </div>
                </div>

                <div class="flex flex-col items-center gap-1.5">
                  <span class="text-[11px] font-mono text-og-citrus">iPhone 16 Pro (393×852)</span>
                  <div
                    class="viewport-sizer relative overflow-hidden rounded-[28px] border-4 border-og-border shadow-2xl bg-white"
                    [style.width.px]="393 * compareScale()"
                    [style.height.px]="852 * compareScale()"
                  >
                    @if (store.serverStatus().state === 'running') {
                      <iframe
                        [src]="safeIframeUrl()"
                        title="Mobile Compare Preview"
                        [style.width.px]="393"
                        [style.height.px]="852"
                        [style.transform]="'scale(' + compareScale() + ')'"
                        style="transform-origin: 0 0; border: 0;"
                      ></iframe>
                    } @else {
                      <ng-container *ngTemplateOutlet="liveMockPreviewTpl; context: { deviceLabel: 'iPhone 16 Pro 393×852' }"></ng-container>
                    }
                  </div>
                </div>
              </div>
            } @else if (isFluidDesktop()) {
              <!-- Responsive 100% Fluid Desktop Stage -->
              <div class="w-full h-full rounded-lg overflow-hidden border border-og-border shadow-2xl bg-white">
                @if (store.serverStatus().state === 'running') {
                  <iframe
                    [src]="safeIframeUrl()"
                    title="Fluid Desktop Preview"
                    class="w-full h-full border-0"
                  ></iframe>
                } @else {
                  <ng-container *ngTemplateOutlet="liveMockPreviewTpl; context: { deviceLabel: 'Fluid Desktop' }"></ng-container>
                }
              </div>
            } @else {
              <!-- Mandatory WebKit CSS Transform Sizer Wrapper Rule (DESIGN.md §6) -->
              <div
                #viewportSizer
                class="viewport-sizer relative overflow-hidden border border-og-border shadow-2xl bg-white transition-shadow"
                [class.rounded-3xl]="store.previewState().mode === 'mobile' || store.previewState().mode === 'tablet'"
                [class.border-4]="store.previewState().mode === 'mobile' || store.previewState().mode === 'tablet'"
                [class.rounded-lg]="store.previewState().mode === 'desktop'"
                [style.width.px]="deviceWidth() * scale()"
                [style.height.px]="deviceHeight() * scale()"
              >
                @if (store.serverStatus().state === 'running') {
                  <iframe
                    [src]="safeIframeUrl()"
                    title="Responsive Device Preview"
                    [style.width.px]="deviceWidth()"
                    [style.height.px]="deviceHeight()"
                    [style.transform]="'scale(' + scale() + ')'"
                    style="transform-origin: 0 0; border: 0;"
                  ></iframe>
                } @else {
                  <div
                    [style.width.px]="deviceWidth()"
                    [style.height.px]="deviceHeight()"
                    [style.transform]="'scale(' + scale() + ')'"
                    style="transform-origin: 0 0;"
                  >
                    <ng-container
                      *ngTemplateOutlet="liveMockPreviewTpl; context: { deviceLabel: deviceWidth() + ' × ' + deviceHeight() }"
                    ></ng-container>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <!-- Instant Built-in Preview Renderer when Dev Server is Stopped or in Browser Demo Mode -->
      <ng-template #liveMockPreviewTpl let-deviceLabel="deviceLabel">
        <div class="w-full h-full bg-slate-950 text-slate-100 p-8 overflow-y-auto font-sans">
          <div class="max-w-2xl mx-auto space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {{ store.activeSsgDescriptor().displayName }}
                </span>
                <span class="text-xs font-mono text-slate-400">{{ store.previewState().route }}</span>
              </div>
              <span class="text-xs font-mono text-slate-400">{{ deviceLabel }}</span>
            </div>

            <h1 class="text-2xl font-bold text-amber-400">
              {{ store.activeTab()?.fields?.['title'] || store.project()?.name || 'OrangeGel Live Preview' }}
            </h1>
            <p class="text-xs text-slate-400">
              @if (store.serverStatus().state === 'stopped') {
                Dev server is currently stopped — showing instant buffer preview. Click
                <strong class="text-amber-300">Start Server</strong> in the toolbar to spawn
                <code class="text-amber-300">{{ store.activeSsgDescriptor().devCommandPreview }}</code>.
              }
            </p>
            <article class="prose prose-invert max-w-none text-sm text-slate-200 whitespace-pre-wrap leading-relaxed bg-slate-900/70 p-4 rounded-lg border border-slate-800">
              {{ store.activeTab()?.body }}
            </article>
          </div>
        </div>
      </ng-template>
    </div>
  `
})
export class DevicePreviewBrowserComponent implements AfterViewInit, OnDestroy {
  readonly store = inject(WorkspaceStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly motion = inject(MotionService);

  readonly Math = Math;
  readonly presets = VIEWPORT_PRESETS;

  @ViewChild('stageContainer') stageContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('viewportSizer') viewportSizer?: ElementRef<HTMLDivElement>;

  private resizeObserver: ResizeObserver | null = null;
  private readonly stageAvailWidth = signal(900);
  private readonly stageAvailHeight = signal(640);

  readonly isFluidDesktop = computed(
    () =>
      this.store.previewState().mode === 'desktop' &&
      this.store.previewState().width === 0
  );

  readonly deviceWidth = computed(() => this.store.previewState().width || 1280);
  readonly deviceHeight = computed(() => this.store.previewState().height || 800);

  readonly scale = computed<number>(() => {
    const zoom = this.store.previewState().zoom;
    if (zoom !== 'autofit') {
      return zoom;
    }
    const w = this.deviceWidth();
    const h = this.deviceHeight();
    const availW = Math.max(200, this.stageAvailWidth() - 40);
    const availH = Math.max(200, this.stageAvailHeight() - 40);
    return Math.min(1, availW / w, availH / h);
  });

  readonly compareScale = computed<number>(() => {
    const availW = Math.max(320, this.stageAvailWidth() - 64);
    const availH = Math.max(240, this.stageAvailHeight() - 64);
    return Math.min(0.75, availW / (1280 + 393 + 32), availH / 852);
  });

  readonly baseServerUrl = computed(
    () => this.store.serverStatus().url || 'http://127.0.0.1:1313'
  );

  readonly safeIframeUrl = computed<SafeResourceUrl>(() => {
    const base = this.baseServerUrl().replace(/\/$/, '');
    const route = this.store.previewState().route;
    const token = this.store.previewState().reloadToken;
    const sep = route.includes('?') ? '&' : '?';
    return this.sanitizer.bypassSecurityTrustResourceUrl(`${base}${route}${sep}_og_r=${token}`);
  });

  constructor() {
    // Trigger Anime.js spring-physics transition on viewport mode, preset, or orientation change
    effect(() => {
      const mode = this.store.previewState().mode;
      const w = this.deviceWidth() * this.scale();
      const h = this.deviceHeight() * this.scale();
      const radius = mode === 'mobile' || mode === 'tablet' ? 24 : 8;
      if (this.viewportSizer?.nativeElement && !this.isFluidDesktop()) {
        this.motion.animateViewportTransition(this.viewportSizer.nativeElement, w, h, radius);
      }
    });
  }

  ngAfterViewInit(): void {
    if (typeof ResizeObserver !== 'undefined' && this.stageContainer?.nativeElement) {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          this.stageAvailWidth.set(entry.contentRect.width);
          this.stageAvailHeight.set(entry.contentRect.height);
        }
      });
      this.resizeObserver.observe(this.stageContainer.nativeElement);
    }
  }

  setMode(mode: ViewportMode): void {
    this.store.setViewportMode(mode);
  }

  onWidthInput(width: number): void {
    this.store.setCustomDimensions(Number(width) || 375, this.deviceHeight());
  }

  onHeightInput(height: number): void {
    this.store.setCustomDimensions(this.deviceWidth(), Number(height) || 667);
  }

  onZoomChange(zoom: ViewportZoom): void {
    this.store.setZoom(zoom);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }
}
