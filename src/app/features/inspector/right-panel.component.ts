import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeployConfig, DeployTarget, ProseIssue } from '../../core/bridge/models';
import { computeWordDiff, WordDiffToken } from '../../core/services/diff.util';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { LightDismissDialogDirective } from '../../shared/directives/light-dismiss-dialog.directive';
import { OgLucideIconsModule } from '../../shared/icons/lucide-icons.module';
import { MermaidPreviewComponent } from './mermaid-preview.component';

@Component({
  selector: 'og-right-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OgLucideIconsModule,
    LightDismissDialogDirective,
    MermaidPreviewComponent
  ],
  template: `
    <aside class="w-full h-full bg-og-surface border-l border-og-border flex flex-col shrink-0 select-none">
      <!-- Inspector Mode Tabs: Prose | Local AI | Mermaid | Git | Deploy -->
      <div class="grid grid-cols-5 bg-og-bg border-b border-og-border p-1 gap-0.5 text-[11px] shrink-0">
        <button
          type="button"
          (click)="store.activeRightTab.set('prose')"
          class="py-1.5 rounded flex flex-col items-center gap-0.5 transition"
          [class.bg-og-panel]="store.activeRightTab() === 'prose'"
          [class.text-og-citrus]="store.activeRightTab() === 'prose'"
          [class.text-og-muted]="store.activeRightTab() !== 'prose'"
        >
          <lucide-icon name="spell-check" class="w-3.5 h-3.5"></lucide-icon>
          <span>Prose ({{ store.proseIssues().length }})</span>
        </button>

        <button
          type="button"
          (click)="store.activeRightTab.set('ai')"
          class="py-1.5 rounded flex flex-col items-center gap-0.5 transition"
          [class.bg-og-panel]="store.activeRightTab() === 'ai'"
          [class.text-og-citrus]="store.activeRightTab() === 'ai'"
          [class.text-og-muted]="store.activeRightTab() !== 'ai'"
        >
          <lucide-icon name="wand-sparkles" class="w-3.5 h-3.5"></lucide-icon>
          <span>Local AI</span>
        </button>

        <button
          type="button"
          (click)="store.activeRightTab.set('mermaid')"
          class="py-1.5 rounded flex flex-col items-center gap-0.5 transition"
          [class.bg-og-panel]="store.activeRightTab() === 'mermaid'"
          [class.text-og-citrus]="store.activeRightTab() === 'mermaid'"
          [class.text-og-muted]="store.activeRightTab() !== 'mermaid'"
        >
          <lucide-icon name="network" class="w-3.5 h-3.5"></lucide-icon>
          <span>Mermaid</span>
        </button>

        <button
          type="button"
          (click)="openGitTab()"
          class="py-1.5 rounded flex flex-col items-center gap-0.5 transition"
          [class.bg-og-panel]="store.activeRightTab() === 'git'"
          [class.text-og-citrus]="store.activeRightTab() === 'git'"
          [class.text-og-muted]="store.activeRightTab() !== 'git'"
        >
          <lucide-icon name="git-branch" class="w-3.5 h-3.5"></lucide-icon>
          <span>Git</span>
        </button>

        <button
          type="button"
          (click)="store.activeRightTab.set('deploy')"
          class="py-1.5 rounded flex flex-col items-center gap-0.5 transition"
          [class.bg-og-panel]="store.activeRightTab() === 'deploy'"
          [class.text-og-citrus]="store.activeRightTab() === 'deploy'"
          [class.text-og-muted]="store.activeRightTab() !== 'deploy'"
        >
          <lucide-icon name="rocket" class="w-3.5 h-3.5"></lucide-icon>
          <span>Deploy</span>
        </button>
      </div>

      <!-- WebKit Flex Safe Scrollable Inspector Body -->
      <div class="relative flex-1 min-h-0">
        <div class="absolute inset-0 overflow-y-auto p-3 space-y-3">
          <!-- TAB 1: PROSE & SPELLCHECK -->
          @if (store.activeRightTab() === 'prose') {
            <div class="flex items-center justify-between text-xs">
              <span class="font-semibold text-og-citrus">Mask-then-Scan Prose Engine</span>
              <span class="text-[11px] text-og-muted">.orangegel/dictionary.txt</span>
            </div>

            @if (store.proseIssues().length === 0) {
              <div class="p-4 rounded-lg bg-og-bg border border-og-border text-xs text-emerald-400 flex items-center gap-2">
                <lucide-icon name="check-circle-2" class="w-4 h-4 shrink-0"></lucide-icon>
                <span>Zero prose or spelling issues found in active document.</span>
              </div>
            }

            <div class="space-y-2">
              @for (issue of store.proseIssues(); track issue.id) {
                <div class="p-2.5 rounded-lg bg-og-bg border border-og-border space-y-1.5 text-xs">
                  <div class="flex items-center justify-between">
                    <span
                      class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase"
                      [ngClass]="
                        issue.kind === 'spelling'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-sky-500/20 text-sky-300'
                      "
                    >
                      {{ issue.kind }}
                    </span>
                    <button
                      type="button"
                      (click)="jumpToIssue(issue)"
                      class="text-[11px] font-mono text-og-citrus hover:underline"
                    >
                      offset {{ issue.offset }}
                    </button>
                  </div>

                  <p class="text-og-text">{{ issue.message }}</p>

                  <div class="flex flex-wrap items-center gap-1.5 pt-1">
                    @for (sug of issue.suggestions; track sug) {
                      <button
                        type="button"
                        (click)="store.applyProseSuggestion(issue, sug)"
                        class="px-2 py-0.5 rounded bg-og-panel hover:bg-og-amber hover:text-og-bg text-[11px] text-og-citrus border border-og-border transition"
                      >
                        → {{ sug }}
                      </button>
                    }
                    @if (issue.kind === 'spelling') {
                      <button
                        type="button"
                        (click)="store.addWordToDictionary(issue.word)"
                        class="px-2 py-0.5 rounded bg-og-surface hover:bg-og-border text-[11px] text-og-muted"
                      >
                        + Dictionary
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }

          <!-- TAB 2: LOCAL AI PROOFREADER -->
          @if (store.activeRightTab() === 'ai') {
            <div class="space-y-3 text-xs">
              <div class="p-2.5 rounded-lg bg-og-bg border border-og-border space-y-1">
                <div class="font-semibold text-og-citrus flex items-center gap-1.5">
                  <lucide-icon name="wand-sparkles" class="w-3.5 h-3.5 text-og-amber"></lucide-icon>
                  Local AI Proofreader (temp: 0.0)
                </div>
                <p class="text-[11px] text-og-muted">
                  Caps at 12,000 chars on paragraph boundary, strips &lt;think&gt; tags, and never silently overwrites your buffer.
                </p>
              </div>

              <div class="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  [disabled]="store.aiBusy()"
                  (click)="store.requestAiRevision('proofread')"
                  class="py-1.5 px-2 rounded bg-og-amber text-og-bg font-semibold hover:bg-og-citrus transition disabled:opacity-50"
                >
                  Proofread
                </button>
                <button
                  type="button"
                  [disabled]="store.aiBusy()"
                  (click)="store.requestAiRevision('tighten')"
                  class="py-1.5 px-2 rounded bg-og-panel border border-og-border text-og-citrus hover:border-og-amber transition disabled:opacity-50"
                >
                  Tighten
                </button>
                <button
                  type="button"
                  [disabled]="store.aiBusy()"
                  (click)="store.requestAiRevision('clarity')"
                  class="py-1.5 px-2 rounded bg-og-panel border border-og-border text-og-citrus hover:border-og-amber transition disabled:opacity-50"
                >
                  Clarity
                </button>
              </div>

              @if (aiStaleError()) {
                <div class="p-2.5 rounded bg-red-500/15 border border-red-500/40 text-red-300 text-[11px]">
                  {{ aiStaleError() }}
                </div>
              }

              @if (store.aiSuggestion(); as sug) {
                <div class="rounded-lg bg-og-bg border border-og-border p-3 space-y-2.5">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-semibold text-og-citrus uppercase">{{ sug.result.mode }} Diff</span>
                    <span class="font-mono text-og-muted truncate max-w-[160px]">{{ sug.result.model }}</span>
                  </div>

                  <!-- Word-Level Diff View -->
                  <div class="p-2.5 rounded bg-og-surface border border-og-border font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto select-text">
                    @for (tok of aiDiffTokens(); track $index) {
                      @if (tok.type === 'delete') {
                        <span class="bg-red-500/25 text-red-300 line-through">{{ tok.text }}</span>
                      } @else if (tok.type === 'insert') {
                        <span class="bg-emerald-500/25 text-emerald-300 font-semibold">{{ tok.text }}</span>
                      } @else {
                        <span>{{ tok.text }}</span>
                      }
                    }
                  </div>

                  <div class="flex justify-end gap-2">
                    <button
                      type="button"
                      (click)="store.aiSuggestion.set(null)"
                      class="px-2.5 py-1 rounded bg-og-panel text-og-muted hover:text-og-text"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      (click)="onApplyAi()"
                      class="px-3 py-1 rounded bg-og-amber text-og-bg font-semibold hover:bg-og-citrus flex items-center gap-1"
                    >
                      <lucide-icon name="check" class="w-3.5 h-3.5"></lucide-icon>
                      Apply to Buffer
                    </button>
                  </div>
                </div>
              }
            </div>
          }

          <!-- TAB 3: LIVE MERMAID DIAGRAMS -->
          @if (store.activeRightTab() === 'mermaid') {
            <div class="space-y-2">
              <div class="text-xs font-semibold text-og-citrus">
                Live Document Mermaid Inspector
              </div>
              <og-mermaid-preview></og-mermaid-preview>
            </div>
          }

          <!-- TAB 4: GIT STATUS, DIFF, COMMIT & PUSH -->
          @if (store.activeRightTab() === 'git') {
            @if (store.gitStatus(); as git) {
              <div class="space-y-3 text-xs">
                <div class="p-2.5 rounded-lg bg-og-bg border border-og-border space-y-1">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-og-citrus flex items-center gap-1">
                      <lucide-icon name="git-branch" class="w-3.5 h-3.5 text-og-amber"></lucide-icon>
                      {{ git.branch }}
                    </span>
                    <span class="font-mono text-[11px] text-og-muted">
                      ↑{{ git.ahead }} ↓{{ git.behind }}
                    </span>
                  </div>
                  <div class="text-[11px] font-mono text-og-muted truncate" [title]="git.remoteUrl">
                    {{ git.remoteName }} → {{ git.remoteUrl }}
                  </div>
                </div>

                <!-- Working Tree Files -->
                <div class="space-y-1">
                  @for (f of git.files; track f.path) {
                    <div class="flex items-center justify-between px-2 py-1 rounded bg-og-bg border border-og-border font-mono text-[11px]">
                      <span class="truncate">{{ f.path }}</span>
                      <span class="text-og-amber font-semibold ml-2">{{ f.status }}</span>
                    </div>
                  }
                </div>

                <!-- Diff Preview -->
                @if (store.gitDiffText()) {
                  <pre class="p-2 rounded bg-og-bg border border-og-border font-mono text-[10px] text-og-muted overflow-x-auto max-h-40">{{ store.gitDiffText() }}</pre>
                }

                <!-- Commit Box -->
                <div class="space-y-2 pt-1">
                  <input
                    type="text"
                    [(ngModel)]="commitMessage"
                    placeholder="Commit message..."
                    class="w-full bg-og-bg border border-og-border rounded px-2.5 py-1.5 text-xs text-og-text focus:outline-none focus:border-og-amber"
                  />
                  <div class="flex gap-2">
                    <button
                      type="button"
                      (click)="onCommit()"
                      class="flex-1 py-1.5 rounded bg-og-panel border border-og-border hover:border-og-amber text-og-citrus font-semibold flex items-center justify-center gap-1"
                    >
                      <lucide-icon name="git-commit-horizontal" class="w-3.5 h-3.5"></lucide-icon>
                      Commit
                    </button>
                    <button
                      type="button"
                      (click)="store.pushChanges()"
                      class="flex-1 py-1.5 rounded bg-og-amber text-og-bg font-semibold hover:bg-og-citrus flex items-center justify-center gap-1"
                    >
                      <lucide-icon name="upload-cloud" class="w-3.5 h-3.5"></lucide-icon>
                      Push
                    </button>
                  </div>
                </div>
              </div>
            }
          }

          <!-- TAB 5: MULTI-PROVIDER STATIC SITE DEPLOY ENGINE -->
          @if (store.activeRightTab() === 'deploy') {
            <div class="space-y-3 text-xs">
              <div class="p-2.5 rounded-lg bg-og-bg border border-og-border space-y-2">
                <div class="font-semibold text-og-citrus flex items-center justify-between">
                  <span>Multi-Provider Edge Deploy</span>
                  <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-og-amber/20 text-og-amber">
                    Edge Last Invariant
                  </span>
                </div>

                <!-- Deploy Target Provider Selector -->
                <div class="space-y-1">
                  <label class="block text-[10px] uppercase tracking-wider text-og-muted font-semibold">
                    Deploy Target Provider
                  </label>
                  <select
                    [ngModel]="activeProvider()"
                    (ngModelChange)="onProviderChange($event)"
                    aria-label="Deploy Target Provider"
                    class="w-full bg-og-surface border border-og-border rounded px-2 py-1.5 text-xs text-og-text focus:outline-none focus:border-og-amber"
                  >
                    @for (p of deployProviders; track p.id) {
                      <option [value]="p.id">{{ p.label }}</option>
                    }
                  </select>
                </div>

                <!-- Provider-Specific Configuration Inputs -->
                @if (activeProvider() === 'firebase') {
                  <div class="grid grid-cols-2 gap-1.5 pt-1">
                    <div>
                      <label class="block text-[10px] text-og-muted">GCP Project</label>
                      <input
                        type="text"
                        [ngModel]="store.deployConfig()?.gcpProject ?? 'jasonsmithio'"
                        (ngModelChange)="updateDeployField({ gcpProject: $event })"
                        class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                      />
                    </div>
                    <div>
                      <label class="block text-[10px] text-og-muted">Firebase Site</label>
                      <input
                        type="text"
                        [ngModel]="store.deployConfig()?.firebaseSite ?? 'orangegel-docs'"
                        (ngModelChange)="updateDeployField({ firebaseSite: $event })"
                        class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                      />
                    </div>
                  </div>
                }

                @if (activeProvider() === 'githubpages') {
                  <div class="space-y-1.5 pt-1">
                    <div class="grid grid-cols-2 gap-1.5">
                      <div>
                        <label class="block text-[10px] text-og-muted">GitHub Repo</label>
                        <input
                          type="text"
                          [ngModel]="store.deployConfig()?.githubRepo ?? 'orangegel/site'"
                          (ngModelChange)="updateDeployField({ githubRepo: $event })"
                          placeholder="orangegel/site"
                          class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                        />
                      </div>
                      <div>
                        <label class="block text-[10px] text-og-muted">Pages Branch</label>
                        <input
                          type="text"
                          [ngModel]="store.deployConfig()?.githubBranch ?? 'gh-pages'"
                          (ngModelChange)="updateDeployField({ githubBranch: $event })"
                          placeholder="gh-pages"
                          class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                        />
                      </div>
                    </div>
                    <label class="flex items-center gap-1.5 text-[11px] text-og-muted cursor-pointer">
                      <input
                        type="checkbox"
                        [ngModel]="store.deployConfig()?.useBlacksmithCi ?? true"
                        (ngModelChange)="updateDeployField({ useBlacksmithCi: $event })"
                        class="rounded border-og-border bg-og-surface text-og-amber"
                      />
                      <span>Generate Blacksmith CI workflow (<code class="text-og-citrus">blacksmith-4vcpu-ubuntu-2204</code>)</span>
                    </label>
                  </div>
                }

                @if (activeProvider() === 'gitlabpages') {
                  <div class="grid grid-cols-2 gap-1.5 pt-1">
                    <div>
                      <label class="block text-[10px] text-og-muted">GitLab Project</label>
                      <input
                        type="text"
                        [ngModel]="store.deployConfig()?.gitlabProject ?? 'jasonsmithio/orangegel-site'"
                        (ngModelChange)="updateDeployField({ gitlabProject: $event })"
                        class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                      />
                    </div>
                    <div>
                      <label class="block text-[10px] text-og-muted">Branch</label>
                      <input
                        type="text"
                        [ngModel]="store.deployConfig()?.gitlabBranch ?? 'main'"
                        (ngModelChange)="updateDeployField({ gitlabBranch: $event })"
                        class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                      />
                    </div>
                  </div>
                }

                @if (activeProvider() === 'cloudflare') {
                  <div class="grid grid-cols-2 gap-1.5 pt-1">
                    <div>
                      <label class="block text-[10px] text-og-muted">Cloudflare Project</label>
                      <input
                        type="text"
                        [ngModel]="store.deployConfig()?.cloudflareProject ?? 'orangegel-site'"
                        (ngModelChange)="updateDeployField({ cloudflareProject: $event })"
                        class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                      />
                    </div>
                    <div>
                      <label class="block text-[10px] text-og-muted">Branch</label>
                      <input
                        type="text"
                        [ngModel]="store.deployConfig()?.cloudflareBranch ?? 'main'"
                        (ngModelChange)="updateDeployField({ cloudflareBranch: $event })"
                        class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                      />
                    </div>
                  </div>
                }

                @if (activeProvider() === 'netlify') {
                  <div class="pt-1">
                    <label class="block text-[10px] text-og-muted">Netlify Site ID / Name</label>
                    <input
                      type="text"
                      [ngModel]="store.deployConfig()?.netlifySiteId ?? 'orangegel-site'"
                      (ngModelChange)="updateDeployField({ netlifySiteId: $event })"
                      class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                    />
                  </div>
                }

                @if (activeProvider() === 'vercel') {
                  <div class="pt-1">
                    <label class="block text-[10px] text-og-muted">Vercel Project Name</label>
                    <input
                      type="text"
                      [ngModel]="store.deployConfig()?.vercelProject ?? 'orangegel-site'"
                      (ngModelChange)="updateDeployField({ vercelProject: $event })"
                      class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                    />
                  </div>
                }

                @if (activeProvider() === 's3cloudfront') {
                  <div class="grid grid-cols-2 gap-1.5 pt-1">
                    <div>
                      <label class="block text-[10px] text-og-muted">S3 Bucket</label>
                      <input
                        type="text"
                        [ngModel]="store.deployConfig()?.s3Bucket ?? 'orangegel-static-site'"
                        (ngModelChange)="updateDeployField({ s3Bucket: $event })"
                        class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                      />
                    </div>
                    <div>
                      <label class="block text-[10px] text-og-muted">CloudFront Dist ID</label>
                      <input
                        type="text"
                        [ngModel]="store.deployConfig()?.cloudfrontDistributionId ?? 'E1ORANGEGELDIST'"
                        (ngModelChange)="updateDeployField({ cloudfrontDistributionId: $event })"
                        class="w-full bg-og-surface border border-og-border rounded px-2 py-1 text-[11px] font-mono text-og-text"
                      />
                    </div>
                  </div>
                }
              </div>

              <!-- Live Dynamic Deploy Pipeline Mermaid Graph -->
              <og-mermaid-preview [customDiagramCode]="dynamicDeployMermaid()"></og-mermaid-preview>

              <!-- Dynamic Plan Cards -->
              <div class="space-y-1.5">
                @for (step of store.deployPlan()?.steps ?? []; track step.id) {
                  <div class="p-2 rounded bg-og-bg border border-og-border space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="font-semibold text-og-text">
                        {{ step.step || step.index }}. {{ step.title }}
                      </span>
                      @if (stepStatus(step.id); as st) {
                        <span class="text-[10px] font-mono uppercase text-emerald-400">{{ st.status }}</span>
                      }
                    </div>
                    <div class="text-[10px] font-mono text-og-muted truncate" [title]="step.commandPreview">
                      $ {{ step.commandPreview }}
                    </div>
                    @if (stepStatus(step.id); as st) {
                      <div class="text-[11px] text-og-citrus">{{ st.message }}</div>
                    }
                  </div>
                }
              </div>

              <button
                type="button"
                (click)="openDeployConfirmModal()"
                [disabled]="store.deployRunning()"
                class="w-full py-2 rounded-md bg-og-amber text-og-bg font-semibold hover:bg-og-citrus transition flex items-center justify-center gap-1.5 shadow"
              >
                <lucide-icon name="rocket" class="w-4 h-4"></lucide-icon>
                Review & Run Production Deploy
              </button>
            </div>
          }
        </div>
      </div>

      <!-- Native Light-Dismiss Dialog: Deploy Confirmation Preview -->
      <dialog
        #deployConfirmDialog
        closedby="any"
        ogLightDismiss
        aria-labelledby="deployConfirmDialogTitle"
        class="bg-og-panel text-og-text border border-og-border rounded-xl p-5 w-[32rem] shadow-2xl"
      >
        <div class="flex items-center justify-between pb-3 border-b border-og-border">
          <h2 id="deployConfirmDialogTitle" class="text-sm font-semibold flex items-center gap-2">
            <lucide-icon name="rocket" class="w-4 h-4 text-og-amber"></lucide-icon>
            Confirm Production Deploy Pipeline ({{ activeProviderLabel() }})
          </h2>
          <button
            type="button"
            (click)="deployConfirmDialog.close()"
            class="text-og-muted hover:text-og-text"
            aria-label="Close dialog"
          >
            <lucide-icon name="x" class="w-4 h-4"></lucide-icon>
          </button>
        </div>

        <div class="mt-4 space-y-2.5 text-xs">
          <div class="p-3 rounded-lg bg-og-bg border border-og-border space-y-1 font-mono text-[11px]">
            <div><span class="text-og-muted">Provider:</span> <span class="text-og-amber font-semibold">{{ activeProviderLabel() }}</span></div>
            <div><span class="text-og-muted">SSG Build:</span> <span class="text-og-citrus">{{ store.activeSsgDescriptor().buildCommandPreview }}</span></div>
            @for (step of store.deployPlan()?.steps ?? []; track step.id) {
              <div class="truncate" [title]="step.commandPreview">
                <span class="text-og-muted">Step {{ step.step || step.index }}:</span> {{ step.commandPreview }}
              </div>
            }
          </div>

          <div class="flex justify-end gap-2 pt-3">
            <button
              type="button"
              (click)="deployConfirmDialog.close()"
              class="px-3 py-1.5 rounded bg-og-surface hover:bg-og-border text-og-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              (click)="confirmAndExecuteDeploy()"
              class="px-3.5 py-1.5 rounded bg-og-amber text-og-bg font-semibold hover:bg-og-citrus flex items-center gap-1.5"
            >
              <lucide-icon name="rocket" class="w-3.5 h-3.5"></lucide-icon>
              Execute Deploy Pipeline
            </button>
          </div>
        </div>
      </dialog>
    </aside>
  `
})
export class RightPanelComponent {
  readonly store = inject(WorkspaceStore);

  @ViewChild('deployConfirmDialog') deployConfirmDialog!: ElementRef<HTMLDialogElement>;

  commitMessage = 'docs: update architecture overview in OrangeGel';
  readonly aiStaleError = signal<string | null>(null);

  readonly deployProviders: { id: DeployTarget; label: string }[] = [
    { id: 'firebase', label: 'Firebase Hosting (+ Cloud Run)' },
    { id: 'githubpages', label: 'GitHub Pages (Blacksmith / gh-pages)' },
    { id: 'gitlabpages', label: 'GitLab Pages (.gitlab-ci.yml)' },
    { id: 'cloudflare', label: 'Cloudflare Pages (Wrangler)' },
    { id: 'netlify', label: 'Netlify Edge (netlify deploy --prod)' },
    { id: 'vercel', label: 'Vercel Edge (vercel --prod)' },
    { id: 's3cloudfront', label: 'AWS S3 + CloudFront Invalidation' }
  ];

  readonly activeProvider = computed<DeployTarget>(
    () => this.store.deployConfig()?.provider ?? 'firebase'
  );

  readonly activeProviderLabel = computed<string>(() => {
    const id = this.activeProvider();
    return this.deployProviders.find((p) => p.id === id)?.label ?? 'Firebase Hosting (+ Cloud Run)';
  });

  readonly dynamicDeployMermaid = computed<string>(() => {
    const fromPlan = this.store.deployPlan()?.mermaidDiagram;
    if (fromPlan) return fromPlan;
    return [
      'flowchart TB',
      '  S1["1. Preflight & Rollback"] --> S2["2. SSG Build"]',
      '  S2 --> S3["3. Cloud Run @sha256"]',
      '  S3 --> S4["4. Firebase Hosting Edge LAST"]',
      '  S4 --> S5["5. SHA-256 Edge Verify"]'
    ].join('\n');
  });

  readonly aiDiffTokens = computed<WordDiffToken[]>(() => {
    const sug = this.store.aiSuggestion();
    if (!sug) return [];
    return computeWordDiff(sug.result.originalText, sug.result.revisedText);
  });

  onProviderChange(provider: DeployTarget): void {
    void this.store.updateDeployConfig({ provider });
  }

  updateDeployField(patch: Partial<DeployConfig>): void {
    void this.store.updateDeployConfig(patch);
  }

  jumpToIssue(issue: ProseIssue): void {
    this.store.revealInEditor?.(issue.offset, issue.length);
  }

  onApplyAi(): void {
    const res = this.store.applyAiSuggestion();
    if (!res.ok) {
      this.aiStaleError.set(res.reason || 'Buffer changed');
    } else {
      this.aiStaleError.set(null);
    }
  }

  openGitTab(): void {
    this.store.activeRightTab.set('git');
    void this.store.refreshGit();
  }

  async onCommit(): Promise<void> {
    if (!this.commitMessage.trim()) return;
    await this.store.commitChanges(this.commitMessage.trim());
    this.commitMessage = '';
  }

  stepStatus(stepId: string) {
    return this.store.deployEvents().find((e) => e.stepId === stepId) ?? null;
  }

  openDeployConfirmModal(): void {
    this.deployConfirmDialog.nativeElement.showModal();
  }

  async confirmAndExecuteDeploy(): Promise<void> {
    this.deployConfirmDialog.nativeElement.close();
    await this.store.executeDeployPipeline();
  }
}
