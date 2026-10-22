import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { OgLucideIconsModule } from '../../shared/icons/lucide-icons.module';

@Component({
  selector: 'og-bottom-panel',
  standalone: true,
  imports: [CommonModule, OgLucideIconsModule],
  template: `
    <footer class="w-full h-full bg-og-surface border-t border-og-border flex flex-col shrink-0 select-none">
      <!-- Supervisor Controls & Log Filter Header -->
      <div class="px-3 py-1.5 border-b border-og-border flex items-center justify-between text-xs shrink-0">
        <div class="flex items-center gap-3">
          <span class="font-semibold text-og-citrus flex items-center gap-1.5">
            <lucide-icon name="terminal" class="w-3.5 h-3.5 text-og-amber"></lucide-icon>
            Process Supervisor ({{ store.activeSsgDescriptor().displayName }})
          </span>

          <span
            class="px-2 py-0.5 rounded text-[10px] font-mono uppercase border"
            [ngClass]="{
              'bg-emerald-500/15 border-emerald-500/40 text-emerald-300': store.serverStatus().state === 'running',
              'bg-amber-500/15 border-amber-500/40 text-amber-300': store.serverStatus().state === 'starting',
              'bg-og-bg border-og-border text-og-muted': store.serverStatus().state === 'stopped'
            }"
          >
            {{ store.serverStatus().state }}
            @if (store.serverStatus().port) {
              · :{{ store.serverStatus().port }}
            }
          </span>
        </div>

        <div class="flex items-center gap-2">
          <!-- Filter Buttons -->
          <div class="flex items-center bg-og-bg rounded p-0.5 border border-og-border text-[11px]">
            <button
              type="button"
              (click)="onlyErrors.set(false)"
              class="px-2 py-0.5 rounded"
              [class.bg-og-panel]="!onlyErrors()"
              [class.text-og-citrus]="!onlyErrors()"
              [class.text-og-muted]="onlyErrors()"
            >
              All ({{ store.serverLogs().length }})
            </button>
            <button
              type="button"
              (click)="onlyErrors.set(true)"
              class="px-2 py-0.5 rounded"
              [class.bg-og-panel]="onlyErrors()"
              [class.text-red-400]="onlyErrors()"
              [class.text-og-muted]="!onlyErrors()"
            >
              Errors
            </button>
          </div>

          @if (store.serverStatus().state === 'running') {
            <button
              type="button"
              (click)="store.stopServer()"
              class="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 flex items-center gap-1"
            >
              <lucide-icon name="square" class="w-3 h-3"></lucide-icon>
              Stop Server
            </button>
          } @else {
            <button
              type="button"
              (click)="store.startServer()"
              class="px-2.5 py-1 rounded bg-og-amber text-og-bg font-semibold hover:bg-og-citrus flex items-center gap-1"
            >
              <lucide-icon name="play" class="w-3 h-3"></lucide-icon>
              Start Server
            </button>
          }

          <button
            type="button"
            [disabled]="store.buildInProgress()"
            (click)="store.triggerProductionBuild()"
            class="px-2.5 py-1 rounded bg-og-panel hover:bg-og-border text-og-text border border-og-border flex items-center gap-1"
          >
            <lucide-icon name="hammer" class="w-3 h-3 text-og-amber"></lucide-icon>
            Build ({{ store.activeSsgDescriptor().defaultOutputDir }})
          </button>
        </div>
      </div>

      <!-- WebKit Flex Safe 500-Line Ring Buffer Log Stream -->
      <div class="relative flex-1 min-h-0">
        <div class="absolute inset-0 overflow-y-auto p-2.5 font-mono text-[11px] space-y-1 bg-og-bg select-text">
          @for (line of filteredLogs(); track $index) {
            <div class="flex items-start gap-2 leading-relaxed">
              <span class="text-og-muted shrink-0">[{{ line.timestamp }}]</span>
              <span
                class="uppercase text-[10px] px-1 rounded shrink-0"
                [class.text-red-400]="line.level === 'error'"
                [class.text-amber-300]="line.level === 'warn'"
                [class.text-sky-300]="line.level === 'info'"
              >
                {{ line.stream }}
              </span>
              <span class="text-og-text break-all">{{ line.text }}</span>
            </div>
          }
        </div>
      </div>
    </footer>
  `
})
export class BottomPanelComponent {
  readonly store = inject(WorkspaceStore);
  readonly onlyErrors = signal(false);

  readonly filteredLogs = computed(() => {
    const all = this.store.serverLogs();
    if (!this.onlyErrors()) return all;
    return all.filter((l) => l.level === 'error');
  });
}
