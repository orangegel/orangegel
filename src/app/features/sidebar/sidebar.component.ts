import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FileTreeNode, SsgId } from '../../core/bridge/models';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { LightDismissDialogDirective } from '../../shared/directives/light-dismiss-dialog.directive';
import { OgLucideIconsModule } from '../../shared/icons/lucide-icons.module';

@Component({
  selector: 'og-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, OgLucideIconsModule, LightDismissDialogDirective],
  template: `
    <aside class="w-full h-full bg-og-surface border-r border-og-border flex flex-col select-none shrink-0">
      <!-- Project Header -->
      <div class="p-3 border-b border-og-border flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <lucide-icon name="folder-open" class="w-4 h-4 text-og-amber shrink-0"></lucide-icon>
            <span class="font-semibold text-xs truncate text-og-text" [title]="store.project()?.rootPath">
              {{ store.project()?.name || 'No Project' }}
            </span>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              (click)="store.chooseAndOpenProject()"
              class="px-2 py-1 text-[11px] rounded bg-og-panel hover:bg-og-border text-og-muted hover:text-og-text transition"
              title="Open existing site folder"
            >
              Open
            </button>
            <button
              type="button"
              (click)="openNewSiteWizard()"
              class="px-2 py-1 text-[11px] rounded bg-og-amber/15 text-og-citrus hover:bg-og-amber/25 border border-og-amber/30 transition flex items-center gap-1"
              title="New Static Site Wizard (Hugo Preferred)"
            >
              <lucide-icon name="plus" class="w-3 h-3"></lucide-icon>
              Site
            </button>
          </div>
        </div>

        <!-- Active SSG Selector Badge (Top 20 Jamstack Generators, Hugo Preferred First) -->
        <div class="flex flex-col gap-1 bg-og-panel/90 p-2 rounded-md border border-og-border">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-og-muted flex items-center gap-1">
              <lucide-icon name="flame" class="w-3.5 h-3.5 text-og-amber"></lucide-icon>
              Generator
            </span>
            @if (store.activeSsg() === 'hugo') {
              <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-og-amber/20 text-og-citrus border border-og-amber/40">
                Preferred Flagship
              </span>
            } @else {
              <span class="px-1.5 py-0.5 rounded text-[10px] bg-og-border text-og-muted">
                {{ store.activeSsgDescriptor().ecosystem }}
              </span>
            }
          </div>
          <select
            [ngModel]="store.activeSsg()"
            (ngModelChange)="onSwitchSsg($event)"
            aria-label="Active Static Site Generator"
            class="w-full mt-0.5 bg-og-bg text-og-text text-xs rounded px-2 py-1 border border-og-border focus:outline-none focus:border-og-amber"
          >
            @for (ssg of store.availableSsgs(); track ssg.id) {
              <option [value]="ssg.id">
                {{ ssg.displayName }}{{ ssg.isPreferred ? ' ★ (Preferred)' : '' }} — {{ ssg.ecosystem }}
              </option>
            }
          </select>
        </div>

        <!-- Quick New Content Button -->
        <button
          type="button"
          (click)="openNewContentModal()"
          class="w-full py-1.5 px-2.5 rounded-md bg-og-amber text-og-bg font-semibold text-xs hover:bg-og-citrus transition flex items-center justify-center gap-1.5 shadow-sm"
        >
          <lucide-icon name="plus" class="w-3.5 h-3.5"></lucide-icon>
          New {{ store.activeSsgDescriptor().displayName }} Content
        </button>
      </div>

      <!-- Collapsible File Trees (WebKit Flex Safe: relative flex-1 min-h-0 + absolute inset-0) -->
      <div class="relative flex-1 min-h-0">
        <div class="absolute inset-0 overflow-y-auto p-2 space-y-3">
          <!-- Content Section -->
          <div>
            <button
              type="button"
              (click)="contentExpanded.set(!contentExpanded())"
              class="w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-og-muted hover:text-og-text"
            >
              <span class="flex items-center gap-1">
                <lucide-icon [name]="contentExpanded() ? 'chevron-down' : 'chevron-right'" class="w-3.5 h-3.5"></lucide-icon>
                Content ({{ store.activeSsgDescriptor().contentDirs[0] || 'content/' }})
              </span>
            </button>

            @if (contentExpanded()) {
              <div class="mt-1 space-y-0.5 pl-1">
                @for (node of store.project()?.contentTree ?? []; track node.relPath) {
                  <ng-container
                    *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node, depth: 0 }"
                  ></ng-container>
                }
              </div>
            }
          </div>

          <!-- Code & Templates Section -->
          <div>
            <button
              type="button"
              (click)="codeExpanded.set(!codeExpanded())"
              class="w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-og-muted hover:text-og-text"
            >
              <span class="flex items-center gap-1">
                <lucide-icon [name]="codeExpanded() ? 'chevron-down' : 'chevron-right'" class="w-3.5 h-3.5"></lucide-icon>
                Templates & Config
              </span>
            </button>

            @if (codeExpanded()) {
              <div class="mt-1 space-y-0.5 pl-1">
                @for (node of store.project()?.codeTree ?? []; track node.relPath) {
                  <ng-container
                    *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node, depth: 0 }"
                  ></ng-container>
                }
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Recursive Tree Node Template -->
      <ng-template #treeNodeTpl let-node let-depth="depth">
        <div>
          <button
            type="button"
            (click)="onNodeClick(node)"
            [style.paddingLeft.px]="depth * 12 + 8"
            class="w-full flex items-center gap-1.5 py-1 pr-2 rounded text-xs transition text-left"
            [ngClass]="
              store.activeTabPath() === node.relPath
                ? 'bg-og-amber/20 text-og-citrus'
                : 'text-og-text hover:bg-og-panel'
            "
          >
            @if (node.isDir) {
              <lucide-icon
                [name]="isDirOpen(node.relPath) ? 'folder-open' : 'folder'"
                class="w-3.5 h-3.5 text-og-amber shrink-0"
              ></lucide-icon>
            } @else if (node.isContent) {
              <lucide-icon name="file-text" class="w-3.5 h-3.5 text-og-citrus shrink-0"></lucide-icon>
            } @else {
              <lucide-icon name="file-code" class="w-3.5 h-3.5 text-og-muted shrink-0"></lucide-icon>
            }
            <span class="truncate">{{ node.name }}</span>
          </button>

          @if (node.isDir && isDirOpen(node.relPath) && node.children?.length) {
            <div class="space-y-0.5">
              @for (child of node.children; track child.relPath) {
                <ng-container
                  *ngTemplateOutlet="treeNodeTpl; context: { $implicit: child, depth: depth + 1 }"
                ></ng-container>
              }
            </div>
          }
        </div>
      </ng-template>

      <!-- Native Light-Dismiss Dialog: New Content Modal -->
      <dialog
        #newContentDialog
        closedby="any"
        ogLightDismiss
        aria-labelledby="newContentDialogTitle"
        class="bg-og-panel text-og-text border border-og-border rounded-xl p-5 w-96 shadow-2xl"
      >
        <div class="flex items-center justify-between pb-3 border-b border-og-border">
          <h2 id="newContentDialogTitle" class="text-sm font-semibold flex items-center gap-2">
            <lucide-icon name="file-text" class="w-4 h-4 text-og-amber"></lucide-icon>
            New {{ store.activeSsgDescriptor().displayName }} Content
          </h2>
          <button
            type="button"
            (click)="newContentDialog.close()"
            class="text-og-muted hover:text-og-text"
            aria-label="Close dialog"
          >
            <lucide-icon name="x" class="w-4 h-4"></lucide-icon>
          </button>
        </div>

        <form (ngSubmit)="submitNewContent()" class="mt-4 space-y-3">
          <div>
            <label class="block text-xs text-og-muted mb-1">Relative Content Path</label>
            <input
              type="text"
              name="newContentPath"
              [(ngModel)]="newContentPath"
              placeholder="content/posts/my-new-post.md"
              class="w-full bg-og-bg border border-og-border rounded px-2.5 py-1.5 text-xs text-og-text focus:outline-none focus:border-og-amber font-mono"
              required
            />
            <p class="mt-1 text-[11px] text-og-muted">
              @if (store.activeSsg() === 'hugo') {
                Runs <code class="text-og-citrus">hugo new content {{ newContentPath }}</code>
              } @else {
                Scaffolds front matter for {{ store.activeSsgDescriptor().displayName }}
              }
            </p>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              (click)="newContentDialog.close()"
              class="px-3 py-1.5 rounded text-xs bg-og-surface hover:bg-og-border text-og-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-3 py-1.5 rounded text-xs bg-og-amber text-og-bg font-semibold hover:bg-og-citrus"
            >
              Create Content
            </button>
          </div>
        </form>
      </dialog>

      <!-- Native Light-Dismiss Dialog: New Site Wizard (Defaulting to Hugo) -->
      <dialog
        #newSiteDialog
        closedby="any"
        ogLightDismiss
        aria-labelledby="newSiteDialogTitle"
        class="bg-og-panel text-og-text border border-og-border rounded-xl p-5 w-[28rem] shadow-2xl"
      >
        <div class="flex items-center justify-between pb-3 border-b border-og-border">
          <h2 id="newSiteDialogTitle" class="text-sm font-semibold flex items-center gap-2">
            <lucide-icon name="sparkles" class="w-4 h-4 text-og-amber"></lucide-icon>
            Create New Static Site
          </h2>
          <button
            type="button"
            (click)="newSiteDialog.close()"
            class="text-og-muted hover:text-og-text"
            aria-label="Close dialog"
          >
            <lucide-icon name="x" class="w-4 h-4"></lucide-icon>
          </button>
        </div>

        <form (ngSubmit)="submitNewSite()" class="mt-4 space-y-3">
          <div>
            <label class="block text-xs text-og-muted mb-1">Generator (Top 20 Jamstack SSGs — Hugo Preferred)</label>
            <select
              name="wizardSsg"
              [(ngModel)]="wizardSsg"
              class="w-full bg-og-bg border border-og-border rounded px-2.5 py-1.5 text-xs text-og-text focus:outline-none focus:border-og-amber"
            >
              @for (ssg of store.availableSsgs(); track ssg.id) {
                <option [value]="ssg.id">
                  {{ ssg.displayName }}{{ ssg.isPreferred ? ' ★ (Preferred Default)' : '' }} — {{ ssg.ecosystem }}
                </option>
              }
            </select>
          </div>
          <div>
            <label class="block text-xs text-og-muted mb-1">Site Name</label>
            <input
              type="text"
              name="wizardSiteName"
              [(ngModel)]="wizardSiteName"
              class="w-full bg-og-bg border border-og-border rounded px-2.5 py-1.5 text-xs text-og-text font-mono"
              required
            />
          </div>
          <div>
            <label class="block text-xs text-og-muted mb-1">Parent Directory</label>
            <input
              type="text"
              name="wizardParentPath"
              [(ngModel)]="wizardParentPath"
              class="w-full bg-og-bg border border-og-border rounded px-2.5 py-1.5 text-xs text-og-text font-mono"
              required
            />
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              (click)="newSiteDialog.close()"
              class="px-3 py-1.5 rounded text-xs bg-og-surface hover:bg-og-border text-og-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-3 py-1.5 rounded text-xs bg-og-amber text-og-bg font-semibold hover:bg-og-citrus"
            >
              Scaffold Site
            </button>
          </div>
        </form>
      </dialog>
    </aside>
  `
})
export class SidebarComponent {
  readonly store = inject(WorkspaceStore);

  @ViewChild('newContentDialog') newContentDialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('newSiteDialog') newSiteDialog!: ElementRef<HTMLDialogElement>;

  readonly contentExpanded = signal(true);
  readonly codeExpanded = signal(true);
  private readonly openDirs = signal<Set<string>>(new Set(['content', 'content/posts', 'layouts']));

  newContentPath = 'content/posts/new-citrus-post.md';
  wizardSsg: SsgId = 'hugo';
  wizardSiteName = 'my-hugo-site';
  wizardParentPath = '/Users/demo/Sites';

  isDirOpen(relPath: string): boolean {
    return this.openDirs().has(relPath);
  }

  onNodeClick(node: FileTreeNode): void {
    if (node.isDir) {
      this.openDirs.update((set) => {
        const next = new Set(set);
        if (next.has(node.relPath)) {
          next.delete(node.relPath);
        } else {
          next.add(node.relPath);
        }
        return next;
      });
    } else {
      void this.store.openDocument(node.relPath);
    }
  }

  onSwitchSsg(ssg: SsgId): void {
    void this.store.switchSsg(ssg);
  }

  openNewContentModal(): void {
    const baseDir = this.store.activeSsgDescriptor().contentDirs[0] || 'content/';
    this.newContentPath = `${baseDir.replace(/\/$/, '')}/posts/hello-${this.store.activeSsg()}.md`;
    this.newContentDialog.nativeElement.showModal();
  }

  async submitNewContent(): Promise<void> {
    if (!this.newContentPath.trim()) return;
    await this.store.scaffoldContent(this.newContentPath.trim());
    this.newContentDialog.nativeElement.close();
  }

  openNewSiteWizard(): void {
    this.wizardSsg = 'hugo';
    this.newSiteDialog.nativeElement.showModal();
  }

  async submitNewSite(): Promise<void> {
    if (!this.wizardSiteName.trim()) return;
    await this.store.createNewSite(this.wizardParentPath.trim(), this.wizardSsg, this.wizardSiteName.trim());
    this.newSiteDialog.nativeElement.close();
  }
}
