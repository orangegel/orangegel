import { CommonModule } from '@angular/common';
import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { OgLucideIconsModule } from '../../shared/icons/lucide-icons.module';

export interface ExtractedDiagram {
  index: number;
  sourceType: 'fence' | 'hugo-shortcode' | 'pipeline';
  code: string;
}

/**
 * Extracts all ```mermaid fences and {{< mermaid >}}...{{< /mermaid >}} shortcodes
 * from a Markdown/Hugo document.
 */
export function extractMermaidDiagrams(markdown: string): ExtractedDiagram[] {
  const results: ExtractedDiagram[] = [];
  let idx = 1;

  const fenceRegex = /```mermaid\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(markdown)) !== null) {
    results.push({
      index: idx++,
      sourceType: 'fence',
      code: match[1].trim()
    });
  }

  const hugoRegex = /\{\{[<%]\s*mermaid\s*[>%]\}\}\s*\n?([\s\S]*?)\{\{[<%]\s*\/mermaid\s*[>%]\}\}/gi;
  while ((match = hugoRegex.exec(markdown)) !== null) {
    results.push({
      index: idx++,
      sourceType: 'hugo-shortcode',
      code: match[1].trim()
    });
  }

  return results;
}

@Component({
  selector: 'og-mermaid-preview',
  standalone: true,
  imports: [CommonModule, OgLucideIconsModule],
  template: `
    <div class="space-y-3">
      @if (diagrams().length === 0) {
        <div class="p-4 rounded-lg bg-og-bg border border-og-border text-xs text-og-muted text-center">
          No <code class="text-og-citrus">\`\`\`mermaid</code> fences or
          <code class="text-og-citrus">{{ '{{< mermaid >}}' }}</code> shortcodes in the active document.
        </div>
      }

      @for (item of renderedSvgs(); track item.index) {
        <div class="rounded-lg bg-og-bg border border-og-border overflow-hidden">
          <div class="px-3 py-1.5 bg-og-surface border-b border-og-border flex items-center justify-between text-[11px]">
            <span class="font-semibold text-og-citrus flex items-center gap-1.5">
              <lucide-icon name="network" class="w-3.5 h-3.5 text-og-amber"></lucide-icon>
              Diagram #{{ item.index }} ({{ item.sourceType }})
            </span>
            <div class="flex items-center gap-1">
              <button
                type="button"
                (click)="zoom.set(zoom() === 1 ? 1.25 : 1)"
                class="px-1.5 py-0.5 rounded bg-og-panel hover:bg-og-border text-og-muted hover:text-og-text"
                title="Toggle Zoom"
              >
                {{ zoom() * 100 }}%
              </button>
              <button
                type="button"
                (click)="copySvg(item.rawSvg)"
                class="px-1.5 py-0.5 rounded bg-og-panel hover:bg-og-border text-og-citrus"
              >
                Copy SVG
              </button>
            </div>
          </div>

          <div class="p-3 overflow-auto flex justify-center">
            <div
              [style.transform]="'scale(' + zoom() + ')'"
              style="transform-origin: center top;"
              [innerHTML]="item.safeSvg"
            ></div>
          </div>
        </div>
      }
    </div>
  `
})
export class MermaidPreviewComponent {
  readonly store = inject(WorkspaceStore);
  private readonly sanitizer = inject(DomSanitizer);

  @Input() customDiagramCode: string | null = null;

  readonly zoom = signal<number>(1);
  readonly renderedSvgs = signal<
    Array<{ index: number; sourceType: string; rawSvg: string; safeSvg: SafeHtml }>
  >([]);

  readonly diagrams = computed<ExtractedDiagram[]>(() => {
    if (this.customDiagramCode) {
      return [{ index: 1, sourceType: 'pipeline', code: this.customDiagramCode }];
    }
    const body = this.store.activeTab()?.body ?? '';
    return extractMermaidDiagrams(body);
  });

  constructor() {
    effect(() => {
      const list = this.diagrams();
      void this.renderAll(list);
    });
  }

  private async renderAll(list: ExtractedDiagram[]): Promise<void> {
    if (list.length === 0) {
      this.renderedSvgs.set([]);
      return;
    }

    try {
      const mermaidMod = await import('mermaid');
      const mermaid = mermaidMod.default || mermaidMod;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict'
      });

      const out: Array<{ index: number; sourceType: string; rawSvg: string; safeSvg: SafeHtml }> = [];
      for (const d of list) {
        try {
          const id = `og-mermaid-${d.index}-${Math.random().toString(36).slice(2, 7)}`;
          const { svg } = await mermaid.render(id, d.code);
          out.push({
            index: d.index,
            sourceType: d.sourceType,
            rawSvg: svg,
            safeSvg: this.sanitizer.bypassSecurityTrustHtml(svg)
          });
        } catch {
          const fallbackSvg = this.buildFallbackDiagramSvg(d.code);
          out.push({
            index: d.index,
            sourceType: d.sourceType,
            rawSvg: fallbackSvg,
            safeSvg: this.sanitizer.bypassSecurityTrustHtml(fallbackSvg)
          });
        }
      }
      this.renderedSvgs.set(out);
    } catch {
      const out = list.map((d) => {
        const fallbackSvg = this.buildFallbackDiagramSvg(d.code);
        return {
          index: d.index,
          sourceType: d.sourceType,
          rawSvg: fallbackSvg,
          safeSvg: this.sanitizer.bypassSecurityTrustHtml(fallbackSvg)
        };
      });
      this.renderedSvgs.set(out);
    }
  }

  private buildFallbackDiagramSvg(code: string): string {
    const firstLine = code.split('\n')[0] || 'flowchart LR';
    return `<svg width="280" height="72" viewBox="0 0 280 72" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="276" height="68" rx="8" fill="#111621" stroke="#FF7A18" stroke-width="1.5"/>
      <text x="16" y="28" fill="#FFB347" font-family="monospace" font-size="11">Mermaid: ${firstLine.replace(/[<>&"]/g, '')}</text>
      <text x="16" y="48" fill="#94A3B8" font-family="monospace" font-size="10">${code.split('\n').length} lines synchronized</text>
    </svg>`;
  }

  copySvg(rawSvg: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(rawSvg);
    }
  }
}
