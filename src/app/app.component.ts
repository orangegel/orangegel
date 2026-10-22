import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkspaceStore } from './core/state/workspace.store';
import { MonacoEditorComponent } from './features/editor/monaco-editor.component';
import { BottomPanelComponent } from './features/inspector/bottom-panel.component';
import { RightPanelComponent } from './features/inspector/right-panel.component';
import { DevicePreviewBrowserComponent } from './features/preview/device-preview-browser.component';
import { SidebarComponent } from './features/sidebar/sidebar.component';
import { OrangeGelOrbComponent } from './features/spatial/orange-gel-orb.component';
import { LightDismissDialogDirective } from './shared/directives/light-dismiss-dialog.directive';
import { OgLucideIconsModule } from './shared/icons/lucide-icons.module';

type ResizeTarget = 'sidebar' | 'center' | 'right' | 'bottom';

interface PersistedLayoutV1 {
  sidebarWidth: number;
  editorSplitPercent: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
}

const LAYOUT_STORAGE_KEY = 'orangegel.layout.v1';

@Component({
  selector: 'og-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OgLucideIconsModule,
    LightDismissDialogDirective,
    SidebarComponent,
    MonacoEditorComponent,
    DevicePreviewBrowserComponent,
    RightPanelComponent,
    BottomPanelComponent,
    OrangeGelOrbComponent
  ],
  styles: [
    `
      .og-splitter {
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
      }
    `
  ],
  template: `
    <div class="w-screen h-screen flex flex-col bg-og-bg text-og-text overflow-hidden">
      <!-- Full-screen transparent drag shield prevents WebKit <iframe> from swallowing pointer events during resize -->
      @if (isResizing()) {
        <div
          class="fixed inset-0 z-50 select-none"
          [style.cursor]="activeResizeCursor()"
        ></div>
      }

      <!-- Top Citrus-Gel Glassmorphism Studio Header (pl-20 clears macOS Overlay traffic lights) -->
      <header
        data-tauri-drag-region
        class="h-11 bg-og-surface/90 backdrop-blur-md border-b border-og-border pl-20 pr-3 flex items-center justify-between shrink-0 select-none"
      >
        <!-- Brand + Reactive Three.js Orange Gel Shader Orb -->
        <div data-tauri-drag-region class="flex items-center gap-2.5">
          <og-orange-gel-orb class="no-drag" [size]="26"></og-orange-gel-orb>
          <span
            data-tauri-drag-region
            class="font-bold text-sm tracking-tight bg-gradient-to-r from-og-amber to-og-citrus bg-clip-text text-transparent"
          >
            OrangeGel
          </span>
        </div>

        <!-- Center Workspace Layout Switcher: Code | Split Studio | Full Preview Browser -->
        <div class="no-drag flex items-center bg-og-bg p-0.5 rounded-lg border border-og-border text-xs">
          <button
            type="button"
            (click)="store.workspaceLayout.set('code')"
            class="px-2.5 py-1 rounded-md flex items-center gap-1 transition"
            [class.bg-og-panel]="store.workspaceLayout() === 'code'"
            [class.text-og-citrus]="store.workspaceLayout() === 'code'"
            [class.text-og-muted]="store.workspaceLayout() !== 'code'"
          >
            <lucide-icon name="code-2" class="w-3.5 h-3.5"></lucide-icon>
            Editor
          </button>
          <button
            type="button"
            (click)="store.workspaceLayout.set('split')"
            class="px-2.5 py-1 rounded-md flex items-center gap-1 transition"
            [class.bg-og-panel]="store.workspaceLayout() === 'split'"
            [class.text-og-citrus]="store.workspaceLayout() === 'split'"
            [class.text-og-muted]="store.workspaceLayout() !== 'split'"
          >
            <lucide-icon name="split-square-vertical" class="w-3.5 h-3.5"></lucide-icon>
            Split Studio
          </button>
          <button
            type="button"
            (click)="store.workspaceLayout.set('preview')"
            class="px-2.5 py-1 rounded-md flex items-center gap-1 transition"
            [class.bg-og-panel]="store.workspaceLayout() === 'preview'"
            [class.text-og-citrus]="store.workspaceLayout() === 'preview'"
            [class.text-og-muted]="store.workspaceLayout() !== 'preview'"
          >
            <lucide-icon name="eye" class="w-3.5 h-3.5"></lucide-icon>
            Device Preview
          </button>
        </div>

        <!-- Right Quick Actions & Settings Dialog Trigger -->
        <div class="flex items-center gap-2 text-xs">
          <button
            type="button"
            (click)="store.showBottomPanel.set(!store.showBottomPanel())"
            class="px-2 py-1 rounded bg-og-panel border border-og-border text-og-muted hover:text-og-text flex items-center gap-1"
            title="Toggle Process Supervisor Logs"
          >
            <lucide-icon name="terminal" class="w-3.5 h-3.5"></lucide-icon>
            Logs
          </button>

          <button
            type="button"
            (click)="store.showRightPanel.set(!store.showRightPanel())"
            class="px-2 py-1 rounded bg-og-panel border border-og-border text-og-muted hover:text-og-text flex items-center gap-1"
            title="Toggle Prose / AI / Mermaid / Deploy Inspector"
          >
            <lucide-icon name="sparkles" class="w-3.5 h-3.5 text-og-amber"></lucide-icon>
            Inspector
          </button>

          <button
            type="button"
            (click)="openSettingsModal()"
            class="p-1.5 rounded bg-og-panel border border-og-border text-og-muted hover:text-og-citrus transition"
            title="OrangeGel Studio Settings"
          >
            <lucide-icon name="settings" class="w-4 h-4"></lucide-icon>
          </button>
        </div>
      </header>

      <!-- Main Studio Multi-Pane Body (WebKit Flex Safe: relative flex-1 min-h-0) -->
      <div
        #workspaceRow
        class="relative flex-1 min-h-0 flex overflow-hidden"
        [class.pointer-events-none]="isResizing()"
        [class.select-none]="isResizing()"
      >
        <!-- Left Project & Top 20 SSG Sidebar -->
        <og-sidebar
          class="h-full shrink-0 flex"
          [style.width.px]="sidebarWidth()"
        ></og-sidebar>

        <!-- Vertical Splitter: Left Sidebar ↔ Center Stage -->
        <div
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-label="Resize left sidebar (use Left/Right arrow keys or drag)"
          (pointerdown)="startResize($event, 'sidebar')"
          (dblclick)="resetSidebarWidth()"
          (keydown)="onSplitterKeydown($event, 'sidebar')"
          title="Drag to resize sidebar (double-click to reset)"
          class="og-splitter group w-1.5 h-full shrink-0 cursor-col-resize bg-transparent hover:bg-og-amber/50 active:bg-og-amber transition-colors flex items-center justify-center z-20"
        >
          <span class="w-0.5 h-8 rounded-full bg-og-border group-hover:bg-og-citrus transition-colors"></span>
        </div>

        <!-- Center Editor + Responsive Multi-Device Preview Stage -->
        <main
          #centerMain
          class="relative flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden"
        >
          <div
            #centerSplitContainer
            class="relative flex-1 min-h-0 flex overflow-hidden"
          >
            @if (store.workspaceLayout() === 'code') {
              <og-monaco-editor class="relative flex-1 min-h-0 min-w-0 flex flex-col"></og-monaco-editor>
            } @else if (store.workspaceLayout() === 'preview') {
              <og-device-preview-browser class="relative flex-1 min-h-0 min-w-0 flex flex-col"></og-device-preview-browser>
            } @else {
              <!-- Split Studio Mode: Resizable Editor Pane + Splitter + Device Preview Browser -->
              <og-monaco-editor
                class="relative min-h-0 min-w-0 shrink-0 flex flex-col"
                [style.width.%]="editorSplitPercent()"
              ></og-monaco-editor>

              <div
                role="separator"
                tabindex="0"
                aria-orientation="vertical"
                aria-label="Resize editor and device preview split (use Left/Right arrow keys or drag)"
                (pointerdown)="startResize($event, 'center')"
                (dblclick)="resetCenterSplit()"
                (keydown)="onSplitterKeydown($event, 'center')"
                title="Drag to resize editor / preview split (double-click to reset to 50%)"
                class="og-splitter group w-1.5 h-full shrink-0 cursor-col-resize bg-transparent hover:bg-og-amber/50 active:bg-og-amber transition-colors flex items-center justify-center z-20"
              >
                <span class="w-0.5 h-10 rounded-full bg-og-border group-hover:bg-og-citrus transition-colors"></span>
              </div>

              <og-device-preview-browser
                class="relative flex-1 min-h-0 min-w-0 flex flex-col"
              ></og-device-preview-browser>
            }
          </div>

          @if (store.showBottomPanel()) {
            <!-- Horizontal Splitter: Center Stage ↔ Bottom Server Logs Panel -->
            <div
              role="separator"
              tabindex="0"
              aria-orientation="horizontal"
              aria-label="Resize bottom server logs panel (use Up/Down arrow keys or drag)"
              (pointerdown)="startResize($event, 'bottom')"
              (dblclick)="resetBottomHeight()"
              (keydown)="onSplitterKeydown($event, 'bottom')"
              title="Drag to resize server logs panel (double-click to reset)"
              class="og-splitter group h-1.5 w-full shrink-0 cursor-row-resize bg-transparent hover:bg-og-amber/50 active:bg-og-amber transition-colors flex items-center justify-center z-20"
            >
              <span class="h-0.5 w-10 rounded-full bg-og-border group-hover:bg-og-citrus transition-colors"></span>
            </div>

            <og-bottom-panel
              class="w-full shrink-0 flex"
              [style.height.px]="bottomPanelHeight()"
            ></og-bottom-panel>
          }
        </main>

        <!-- Right Prose / Local AI / Mermaid / Git / Deploy Inspector -->
        @if (store.showRightPanel()) {
          <!-- Vertical Splitter: Center Stage ↔ Right Inspector Panel -->
          <div
            role="separator"
            tabindex="0"
            aria-orientation="vertical"
            aria-label="Resize right inspector panel (use Left/Right arrow keys or drag)"
            (pointerdown)="startResize($event, 'right')"
            (dblclick)="resetRightWidth()"
            (keydown)="onSplitterKeydown($event, 'right')"
            title="Drag to resize inspector panel (double-click to reset)"
            class="og-splitter group w-1.5 h-full shrink-0 cursor-col-resize bg-transparent hover:bg-og-amber/50 active:bg-og-amber transition-colors flex items-center justify-center z-20"
          >
            <span class="w-0.5 h-8 rounded-full bg-og-border group-hover:bg-og-citrus transition-colors"></span>
          </div>

          <og-right-panel
            class="h-full shrink-0 flex"
            [style.width.px]="rightPanelWidth()"
          ></og-right-panel>
        }
      </div>

      <!-- Native Light-Dismiss Dialog: Studio Settings Modal -->
      <dialog
        #settingsDialog
        closedby="any"
        ogLightDismiss
        aria-labelledby="settingsDialogTitle"
        class="bg-og-panel text-og-text border border-og-border rounded-xl p-5 w-[32rem] shadow-2xl"
      >
        <div class="flex items-center justify-between pb-3 border-b border-og-border">
          <h2 id="settingsDialogTitle" class="text-sm font-semibold flex items-center gap-2">
            <lucide-icon name="settings-2" class="w-4 h-4 text-og-amber"></lucide-icon>
            OrangeGel Studio Settings
          </h2>
          <button
            type="button"
            (click)="settingsDialog.close()"
            class="text-og-muted hover:text-og-text"
            aria-label="Close settings dialog"
          >
            <lucide-icon name="x" class="w-4 h-4"></lucide-icon>
          </button>
        </div>

        <form (ngSubmit)="saveSettings()" class="mt-4 space-y-3 text-xs">
          <div>
            <label class="block text-og-muted mb-1">Default Preferred SSG</label>
            <select
              name="preferredSsg"
              [(ngModel)]="draftSettings.preferredSsg"
              class="w-full bg-og-bg border border-og-border rounded px-2.5 py-1.5 text-og-text"
            >
              @for (ssg of store.availableSsgs(); track ssg.id) {
                <option [value]="ssg.id">
                  {{ ssg.displayName }}{{ ssg.isPreferred ? ' ★ (Preferred)' : '' }}
                </option>
              }
            </select>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-og-muted mb-1">Local LLM Endpoint</label>
              <input
                type="text"
                name="llmEndpoint"
                [(ngModel)]="draftSettings.llmEndpoint"
                class="w-full bg-og-bg border border-og-border rounded px-2.5 py-1.5 font-mono text-og-text"
              />
            </div>
            <div>
              <label class="block text-og-muted mb-1">Local LLM Model</label>
              <input
                type="text"
                name="llmModel"
                [(ngModel)]="draftSettings.llmModel"
                class="w-full bg-og-bg border border-og-border rounded px-2.5 py-1.5 font-mono text-og-text"
              />
            </div>
          </div>

          <div class="flex items-center gap-4 pt-1">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                name="proseSpellcheck"
                [(ngModel)]="draftSettings.proseSpellcheck"
              />
              <span>Hunspell Spellcheck</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                name="proseStyleCheck"
                [(ngModel)]="draftSettings.proseStyleCheck"
              />
              <span>Deterministic Style Rules</span>
            </label>
          </div>

          <!-- Terminal CLI Launcher Section -->
          <div class="p-3 rounded-lg bg-og-bg border border-og-border space-y-2">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-semibold text-og-citrus flex items-center gap-1.5">
                  <lucide-icon name="terminal" class="w-3.5 h-3.5 text-og-amber"></lucide-icon>
                  Terminal CLI (<code class="font-mono text-og-text">orangegel .</code>)
                </div>
                <p class="text-[11px] text-og-muted mt-0.5">
                  Launch OrangeGel directly in any static site folder from your shell.
                </p>
              </div>
              <button
                type="button"
                (click)="installCliCommand()"
                class="px-2.5 py-1.5 rounded bg-og-panel border border-og-amber/40 text-og-citrus hover:bg-og-amber hover:text-og-bg font-medium transition shrink-0"
              >
                Install <code class="font-mono">orangegel</code> CLI Command
              </button>
            </div>
            @if (cliInstallStatus()) {
              <div class="text-[11px] font-mono text-emerald-400">
                {{ cliInstallStatus() }}
              </div>
            }
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-og-border">
            <button
              type="button"
              (click)="settingsDialog.close()"
              class="px-3 py-1.5 rounded bg-og-surface text-og-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-3.5 py-1.5 rounded bg-og-amber text-og-bg font-semibold hover:bg-og-citrus"
            >
              Save Settings
            </button>
          </div>
        </form>
      </dialog>
    </div>
  `
})
export class AppComponent implements OnInit, OnDestroy {
  readonly store = inject(WorkspaceStore);

  @ViewChild('settingsDialog') settingsDialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('centerSplitContainer') centerSplitContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('centerMain') centerMain?: ElementRef<HTMLElement>;

  draftSettings = structuredClone(this.store.settings());
  readonly cliInstallStatus = signal<string | null>(null);

  // Draggable Resizable Pane Signals
  readonly sidebarWidth = signal<number>(256);
  readonly editorSplitPercent = signal<number>(48);
  readonly rightPanelWidth = signal<number>(340);
  readonly bottomPanelHeight = signal<number>(156);

  readonly isResizing = signal<boolean>(false);
  readonly activeResizeCursor = signal<'col-resize' | 'row-resize'>('col-resize');

  private activeTarget: ResizeTarget | null = null;
  private startX = 0;
  private startY = 0;
  private startSize = 0;

  private readonly onPointerMoveBound = (e: PointerEvent) => this.onPointerMove(e);
  private readonly onPointerUpBound = () => this.stopResize();

  ngOnInit(): void {
    this.restoreLayoutFromStorage();
    void this.store.initialize();
  }

  ngOnDestroy(): void {
    this.stopResize();
  }

  private clampSidebar(px: number): number {
    return Math.max(180, Math.min(480, Math.round(px)));
  }

  private clampCenterSplit(pct: number): number {
    return Math.max(20, Math.min(80, Math.round(pct * 10) / 10));
  }

  private clampRightPanel(px: number): number {
    return Math.max(240, Math.min(640, Math.round(px)));
  }

  private clampBottomPanel(px: number): number {
    return Math.max(96, Math.min(480, Math.round(px)));
  }

  startResize(event: PointerEvent, target: ResizeTarget): void {
    if (event.button !== 0) return;
    event.preventDefault();

    this.activeTarget = target;
    this.startX = event.clientX;
    this.startY = event.clientY;

    if (target === 'sidebar') {
      this.startSize = this.sidebarWidth();
      this.activeResizeCursor.set('col-resize');
    } else if (target === 'center') {
      this.startSize = this.editorSplitPercent();
      this.activeResizeCursor.set('col-resize');
    } else if (target === 'right') {
      this.startSize = this.rightPanelWidth();
      this.activeResizeCursor.set('col-resize');
    } else if (target === 'bottom') {
      this.startSize = this.bottomPanelHeight();
      this.activeResizeCursor.set('row-resize');
    }

    this.isResizing.set(true);

    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onPointerMoveBound);
      window.addEventListener('pointerup', this.onPointerUpBound);
      window.addEventListener('pointercancel', this.onPointerUpBound);
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.isResizing() || !this.activeTarget) return;

    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;

    switch (this.activeTarget) {
      case 'sidebar': {
        this.sidebarWidth.set(this.clampSidebar(this.startSize + dx));
        break;
      }
      case 'center': {
        const containerWidth =
          this.centerSplitContainer?.nativeElement.getBoundingClientRect().width || 800;
        const deltaPct = (dx / Math.max(1, containerWidth)) * 100;
        this.editorSplitPercent.set(this.clampCenterSplit(this.startSize + deltaPct));
        break;
      }
      case 'right': {
        this.rightPanelWidth.set(this.clampRightPanel(this.startSize - dx));
        break;
      }
      case 'bottom': {
        this.bottomPanelHeight.set(this.clampBottomPanel(this.startSize - dy));
        break;
      }
    }
  }

  private stopResize(): void {
    if (!this.isResizing()) return;
    this.isResizing.set(false);
    this.activeTarget = null;
    this.persistLayoutToStorage();

    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMoveBound);
      window.removeEventListener('pointerup', this.onPointerUpBound);
      window.removeEventListener('pointercancel', this.onPointerUpBound);
    }
  }

  onSplitterKeydown(event: KeyboardEvent, target: ResizeTarget): void {
    const stepPx = 16;
    const stepPct = 2;
    if (target === 'sidebar') {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.sidebarWidth.set(this.clampSidebar(this.sidebarWidth() - stepPx));
        this.persistLayoutToStorage();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.sidebarWidth.set(this.clampSidebar(this.sidebarWidth() + stepPx));
        this.persistLayoutToStorage();
      }
    } else if (target === 'center') {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.editorSplitPercent.set(this.clampCenterSplit(this.editorSplitPercent() - stepPct));
        this.persistLayoutToStorage();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.editorSplitPercent.set(this.clampCenterSplit(this.editorSplitPercent() + stepPct));
        this.persistLayoutToStorage();
      }
    } else if (target === 'right') {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.rightPanelWidth.set(this.clampRightPanel(this.rightPanelWidth() + stepPx));
        this.persistLayoutToStorage();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.rightPanelWidth.set(this.clampRightPanel(this.rightPanelWidth() - stepPx));
        this.persistLayoutToStorage();
      }
    } else if (target === 'bottom') {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.bottomPanelHeight.set(this.clampBottomPanel(this.bottomPanelHeight() + stepPx));
        this.persistLayoutToStorage();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.bottomPanelHeight.set(this.clampBottomPanel(this.bottomPanelHeight() - stepPx));
        this.persistLayoutToStorage();
      }
    }
  }

  resetSidebarWidth(): void {
    this.sidebarWidth.set(256);
    this.persistLayoutToStorage();
  }

  resetCenterSplit(): void {
    this.editorSplitPercent.set(50);
    this.persistLayoutToStorage();
  }

  resetRightWidth(): void {
    this.rightPanelWidth.set(340);
    this.persistLayoutToStorage();
  }

  resetBottomHeight(): void {
    this.bottomPanelHeight.set(156);
    this.persistLayoutToStorage();
  }

  private restoreLayoutFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedLayoutV1>;
      if (typeof parsed.sidebarWidth === 'number') {
        this.sidebarWidth.set(this.clampSidebar(parsed.sidebarWidth));
      }
      if (typeof parsed.editorSplitPercent === 'number') {
        this.editorSplitPercent.set(this.clampCenterSplit(parsed.editorSplitPercent));
      }
      if (typeof parsed.rightPanelWidth === 'number') {
        this.rightPanelWidth.set(this.clampRightPanel(parsed.rightPanelWidth));
      }
      if (typeof parsed.bottomPanelHeight === 'number') {
        this.bottomPanelHeight.set(this.clampBottomPanel(parsed.bottomPanelHeight));
      }
    } catch {
      // Ignore corrupt localStorage layout entry
    }
  }

  private persistLayoutToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const layout: PersistedLayoutV1 = {
        sidebarWidth: this.sidebarWidth(),
        editorSplitPercent: this.editorSplitPercent(),
        rightPanelWidth: this.rightPanelWidth(),
        bottomPanelHeight: this.bottomPanelHeight()
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Ignore storage quota errors
    }
  }

  openSettingsModal(): void {
    this.draftSettings = structuredClone(this.store.settings());
    this.cliInstallStatus.set(null);
    this.settingsDialog.nativeElement.showModal();
  }

  async installCliCommand(): Promise<void> {
    try {
      const msg = await this.store.installCliLauncher();
      this.cliInstallStatus.set(msg);
    } catch (err) {
      this.cliInstallStatus.set(String(err));
    }
  }

  async saveSettings(): Promise<void> {
    await this.store.updateSettings(structuredClone(this.draftSettings));
    this.settingsDialog.nativeElement.close();
  }
}
