import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProseIssue } from '../../core/bridge/models';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { OgLucideIconsModule } from '../../shared/icons/lucide-icons.module';
import { FrontMatterFormComponent } from './front-matter-form.component';
import { registerOrangeGelMonacoExtensions } from './monaco.config';

@Component({
  selector: 'og-monaco-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, OgLucideIconsModule, FrontMatterFormComponent],
  template: `
    <div class="flex flex-col flex-1 min-h-0 bg-og-bg border-r border-og-border">
      <!-- Editor Tab Bar -->
      <div class="h-9 bg-og-surface border-b border-og-border flex items-center justify-between px-2 shrink-0">
        <div class="flex items-center gap-1 overflow-x-auto no-scrollbar">
          @for (tab of store.tabs(); track tab.path) {
            <div
              (click)="store.openDocument(tab.path)"
              class="group flex items-center gap-1.5 px-2.5 py-1 rounded-t text-xs cursor-pointer border-t-2 transition"
              [class.bg-og-bg]="store.activeTabPath() === tab.path"
              [class.border-og-amber]="store.activeTabPath() === tab.path"
              [class.text-og-citrus]="store.activeTabPath() === tab.path"
              [class.border-transparent]="store.activeTabPath() !== tab.path"
              [class.text-og-muted]="store.activeTabPath() !== tab.path"
            >
              <lucide-icon
                [name]="tab.isDoc ? 'file-text' : 'file-code'"
                class="w-3.5 h-3.5 shrink-0"
              ></lucide-icon>
              <span class="truncate max-w-[140px]">{{ tab.name }}</span>
              @if (store.isTabDirty(tab)) {
                <span class="w-2 h-2 rounded-full bg-og-amber" title="Unsaved changes"></span>
              }
              <button
                type="button"
                (click)="onCloseTab($event, tab.path)"
                class="opacity-60 hover:opacity-100 hover:text-red-400 ml-1"
                aria-label="Close tab"
              >
                <lucide-icon name="x" class="w-3 h-3"></lucide-icon>
              </button>
            </div>
          }
        </div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            (click)="toggleWordWrap()"
            class="px-2 py-1 rounded text-xs font-medium flex items-center gap-1 border transition"
            [ngClass]="
              wordWrapEnabled()
                ? 'bg-og-amber/15 border-og-amber/40 text-og-citrus'
                : 'bg-og-panel border-og-border text-og-muted'
            "
            title="Toggle Editor Word Wrap (Alt+Z)"
          >
            <lucide-icon name="file-text" class="w-3 h-3"></lucide-icon>
            Wrap {{ wordWrapEnabled() ? 'On' : 'Off' }}
          </button>

          @if (store.activeTab(); as active) {
            <button
              type="button"
              (click)="store.saveActiveTab()"
              class="px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition"
              [class.bg-og-amber]="store.isTabDirty(active)"
              [class.text-og-bg]="store.isTabDirty(active)"
              [class.bg-og-panel]="!store.isTabDirty(active)"
              [class.text-og-muted]="!store.isTabDirty(active)"
              title="Save Document (⌘S)"
            >
              <lucide-icon name="save" class="w-3.5 h-3.5"></lucide-icon>
              Save
            </button>
          }
        </div>
      </div>

      <!-- Structured Front Matter Form Inspector -->
      <og-front-matter-form></og-front-matter-form>

      <!-- WebKit Layout Invariant: relative flex-1 min-h-0 wrapper + absolute inset-0 inner stage -->
      <div class="relative flex-1 min-h-0">
        @if (!fallbackMode()) {
          <div #editorContainer class="absolute inset-0"></div>
        } @else {
          <!-- Graceful Degradation Textarea Fallback (never blank!) -->
          <div class="absolute inset-0 flex flex-col bg-og-bg">
            <div class="px-3 py-1 bg-og-panel border-b border-og-border text-[11px] text-og-citrus flex items-center justify-between">
              <span>Standard Editor Buffer Mode (synchronized with WorkspaceStore Signals)</span>
              <span class="font-mono text-og-muted">{{ store.activeTab()?.lang || 'markdown' }}</span>
            </div>
            <textarea
              [ngModel]="store.activeTab()?.body ?? ''"
              (ngModelChange)="store.updateActiveBody($event)"
              spellcheck="false"
              [attr.wrap]="wordWrapEnabled() ? 'soft' : 'off'"
              class="w-full flex-1 bg-og-bg text-og-text font-mono text-xs p-4 focus:outline-none resize-none leading-relaxed whitespace-pre-wrap break-words overflow-x-hidden"
              placeholder="Write your static site Markdown, Hugo shortcodes, or Mermaid diagrams..."
            ></textarea>
          </div>
        }
      </div>
    </div>
  `
})
export class MonacoEditorComponent implements AfterViewInit, OnDestroy {
  readonly store = inject(WorkspaceStore);

  @ViewChild('editorContainer') editorContainer?: ElementRef<HTMLDivElement>;

  readonly fallbackMode = signal(false);
  readonly wordWrapEnabled = signal(true);

  private monaco: any = null;
  private editorInstance: any = null;
  // Map<string, ITextModel> preserves per-tab undo/redo stack across tab switches
  private readonly modelCache = new Map<string, any>();
  private suppressChange = false;
  private keydownHandler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.store.saveActiveTab();
    } else if (e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.toggleWordWrap();
    }
  };

  constructor() {
    // Sync active tab buffer into Monaco model
    effect(() => {
      const tab = this.store.activeTab();
      const issues = this.store.proseIssues();
      const wrapPref = this.store.settings().editorWordWrap ?? true;
      if (this.wordWrapEnabled() !== wrapPref && !this.editorInstance) {
        this.wordWrapEnabled.set(wrapPref);
      }
      if (tab && this.editorInstance && this.monaco && !this.fallbackMode()) {
        this.syncTabToMonaco(tab.path, tab.body, tab.lang);
        this.applyProseMarkers(issues);
      }
    });
  }

  toggleWordWrap(): void {
    const enabled = !this.wordWrapEnabled();
    this.wordWrapEnabled.set(enabled);
    this.editorInstance?.updateOptions({
      wordWrap: enabled ? 'on' : 'off',
      scrollbar: {
        horizontal: enabled ? 'hidden' : 'auto',
        verticalScrollbarSize: 8
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.keydownHandler);
    }

    this.store.revealInEditor = (offset: number, length: number) => {
      if (this.editorInstance && this.monaco) {
        const model = this.editorInstance.getModel();
        if (!model) return;
        const startPos = model.getPositionAt(offset);
        const endPos = model.getPositionAt(offset + length);
        const selection = new this.monaco.Selection(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column
        );
        this.editorInstance.setSelection(selection);
        this.editorInstance.revealPositionInCenter(startPos);
        this.editorInstance.focus();
      }
    };

    try {
      // Configure Monaco worker paths before dynamic import
      if (typeof window !== 'undefined') {
        (window as any).MonacoEnvironment = {
          getWorkerUrl: () => '/assets/monaco/vs/base/worker/workerMain.js'
        };
      }
      const monacoMod = await import('monaco-editor');
      this.monaco = monacoMod;
      registerOrangeGelMonacoExtensions(this.monaco);

      if (!this.editorContainer?.nativeElement) {
        this.fallbackMode.set(true);
        return;
      }

      const wrapOn = this.wordWrapEnabled();
      this.editorInstance = this.monaco.editor.create(this.editorContainer.nativeElement, {
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: this.store.settings().editorFontSize,
        wordWrap: wrapOn ? 'on' : 'off',
        wrappingIndent: 'same',
        wrappingStrategy: 'advanced',
        scrollBeyondLastColumn: 0,
        scrollBeyondLastLine: false,
        scrollbar: {
          horizontal: wrapOn ? 'hidden' : 'auto',
          verticalScrollbarSize: 8
        },
        minimap: { enabled: false },
        fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
        padding: { top: 12, bottom: 12 }
      });

      this.editorInstance.onDidChangeModelContent(() => {
        if (this.suppressChange) return;
        const model = this.editorInstance.getModel();
        if (model) {
          this.store.updateActiveBody(model.getValue());
        }
      });

      const currentTab = this.store.activeTab();
      if (currentTab) {
        this.syncTabToMonaco(currentTab.path, currentTab.body, currentTab.lang);
        this.applyProseMarkers(this.store.proseIssues());
      }
    } catch {
      // Degrade gracefully to synchronized <textarea> if WebGL/workers fail in headless or restricted environments
      this.fallbackMode.set(true);
    }
  }

  private syncTabToMonaco(path: string, body: string, lang: string): void {
    if (!this.monaco || !this.editorInstance) return;
    let model = this.modelCache.get(path);
    if (!model) {
      const uri = this.monaco.Uri.parse(`inmemory://orangegel/${encodeURIComponent(path)}`);
      model = this.monaco.editor.getModel(uri) || this.monaco.editor.createModel(body, lang, uri);
      this.modelCache.set(path, model);
    }

    if (this.editorInstance.getModel() !== model) {
      this.editorInstance.setModel(model);
    }

    if (model.getValue() !== body) {
      this.suppressChange = true;
      model.setValue(body);
      this.suppressChange = false;
    }
  }

  private applyProseMarkers(issues: ProseIssue[]): void {
    if (!this.monaco || !this.editorInstance) return;
    const model = this.editorInstance.getModel();
    if (!model) return;

    const markers = issues.map((issue) => {
      const start = model.getPositionAt(issue.offset);
      const end = model.getPositionAt(issue.offset + issue.length);
      return {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        message: issue.message,
        severity:
          issue.kind === 'spelling'
            ? this.monaco.MarkerSeverity.Warning
            : this.monaco.MarkerSeverity.Info
      };
    });

    this.monaco.editor.setModelMarkers(model, 'orangegel-prose', markers);
  }

  onCloseTab(event: MouseEvent, path: string): void {
    event.stopPropagation();
    const cached = this.modelCache.get(path);
    if (cached) {
      cached.dispose();
      this.modelCache.delete(path);
    }
    this.store.closeTab(path);
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    this.store.revealInEditor = null;
    this.modelCache.forEach((m) => m.dispose());
    this.modelCache.clear();
    if (this.editorInstance) {
      this.editorInstance.dispose();
    }
  }
}
