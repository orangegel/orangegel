import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { OgLucideIconsModule } from '../../shared/icons/lucide-icons.module';

@Component({
  selector: 'og-front-matter-form',
  standalone: true,
  imports: [CommonModule, FormsModule, OgLucideIconsModule],
  template: `
    @if (store.activeTab(); as tab) {
      @if (tab.isDoc) {
        <section class="bg-og-surface/90 border-b border-og-border px-3 py-2 text-xs">
          <div class="flex items-center justify-between">
            <button
              type="button"
              (click)="expanded.set(!expanded())"
              class="flex items-center gap-1.5 font-semibold text-og-citrus hover:text-og-amber transition"
            >
              <lucide-icon [name]="expanded() ? 'chevron-down' : 'chevron-right'" class="w-3.5 h-3.5"></lucide-icon>
              <span>Front Matter ({{ tab.format.toUpperCase() }})</span>
              <span class="text-[11px] font-normal text-og-muted ml-2">
                {{ titleValue() }}
              </span>
            </button>

            <div class="flex items-center gap-2">
              <label class="flex items-center gap-1.5 cursor-pointer text-[11px] text-og-muted">
                <input
                  type="checkbox"
                  [ngModel]="draftValue()"
                  (ngModelChange)="store.updateActiveField('draft', $event)"
                  class="rounded border-og-border bg-og-bg text-og-amber focus:ring-0"
                />
                <span>Draft</span>
              </label>
            </div>
          </div>

          @if (expanded()) {
            <div class="grid grid-cols-12 gap-2 mt-2.5 pt-2 border-t border-og-border/60">
              <div class="col-span-6">
                <label class="block text-[10px] uppercase tracking-wider text-og-muted mb-0.5">Title</label>
                <input
                  type="text"
                  [ngModel]="titleValue()"
                  (ngModelChange)="store.updateActiveField('title', $event)"
                  class="w-full bg-og-bg border border-og-border rounded px-2 py-1 text-xs text-og-text focus:outline-none focus:border-og-amber"
                />
              </div>
              <div class="col-span-3">
                <label class="block text-[10px] uppercase tracking-wider text-og-muted mb-0.5">Date</label>
                <input
                  type="date"
                  [ngModel]="dateValue()"
                  (ngModelChange)="store.updateActiveField('date', $event)"
                  class="w-full bg-og-bg border border-og-border rounded px-2 py-1 text-xs text-og-text font-mono focus:outline-none focus:border-og-amber"
                />
              </div>
              <div class="col-span-3">
                <label class="block text-[10px] uppercase tracking-wider text-og-muted mb-0.5">Slug</label>
                <input
                  type="text"
                  [ngModel]="slugValue()"
                  (ngModelChange)="store.updateActiveField('slug', $event)"
                  class="w-full bg-og-bg border border-og-border rounded px-2 py-1 text-xs text-og-text font-mono focus:outline-none focus:border-og-amber"
                />
              </div>
              <div class="col-span-6">
                <label class="block text-[10px] uppercase tracking-wider text-og-muted mb-0.5">Tags (comma separated)</label>
                <input
                  type="text"
                  [ngModel]="tagsString()"
                  (ngModelChange)="onTagsChange($event)"
                  class="w-full bg-og-bg border border-og-border rounded px-2 py-1 text-xs text-og-text font-mono focus:outline-none focus:border-og-amber"
                />
              </div>
              <div class="col-span-6">
                <label class="block text-[10px] uppercase tracking-wider text-og-muted mb-0.5">Description</label>
                <input
                  type="text"
                  [ngModel]="descriptionValue()"
                  (ngModelChange)="store.updateActiveField('description', $event)"
                  class="w-full bg-og-bg border border-og-border rounded px-2 py-1 text-xs text-og-text focus:outline-none focus:border-og-amber"
                />
              </div>

              <!-- Custom Front Matter Fields -->
              @if (customEntries().length > 0) {
                <div class="col-span-12 flex flex-wrap gap-2 pt-1">
                  @for (entry of customEntries(); track entry[0]) {
                    <div class="flex items-center gap-1 bg-og-bg border border-og-border rounded px-2 py-0.5 text-[11px]">
                      <span class="text-og-citrus font-mono">{{ entry[0] }}:</span>
                      <input
                        type="text"
                        [ngModel]="entry[1]"
                        (ngModelChange)="store.updateActiveField(entry[0], $event)"
                        class="bg-transparent text-og-text w-24 focus:outline-none font-mono"
                      />
                      <button
                        type="button"
                        (click)="store.removeActiveField(entry[0])"
                        class="text-og-muted hover:text-red-400"
                        title="Remove custom field"
                      >
                        <lucide-icon name="x" class="w-3 h-3"></lucide-icon>
                      </button>
                    </div>
                  }
                </div>
              }

              <!-- Add Custom Key-Value -->
              <div class="col-span-12 flex items-center gap-2 pt-1">
                <input
                  type="text"
                  [(ngModel)]="newFieldKey"
                  placeholder="Custom key (e.g. layout)"
                  class="bg-og-bg border border-og-border rounded px-2 py-0.5 text-[11px] font-mono w-36 focus:outline-none focus:border-og-amber"
                />
                <input
                  type="text"
                  [(ngModel)]="newFieldValue"
                  placeholder="Value"
                  class="bg-og-bg border border-og-border rounded px-2 py-0.5 text-[11px] font-mono w-40 focus:outline-none focus:border-og-amber"
                />
                <button
                  type="button"
                  (click)="addCustomField()"
                  class="px-2 py-0.5 rounded bg-og-panel hover:bg-og-border text-[11px] text-og-citrus border border-og-border flex items-center gap-1"
                >
                  <lucide-icon name="plus" class="w-3 h-3"></lucide-icon>
                  Add Field
                </button>
              </div>
            </div>
          }
        </section>
      }
    }
  `
})
export class FrontMatterFormComponent {
  readonly store = inject(WorkspaceStore);
  readonly expanded = signal(true);

  newFieldKey = '';
  newFieldValue = '';

  private readonly reservedKeys = new Set(['title', 'date', 'draft', 'slug', 'tags', 'description']);

  readonly titleValue = computed(() => String(this.store.activeTab()?.fields['title'] ?? ''));
  readonly dateValue = computed(() => String(this.store.activeTab()?.fields['date'] ?? ''));
  readonly draftValue = computed(() => Boolean(this.store.activeTab()?.fields['draft']));
  readonly slugValue = computed(() => String(this.store.activeTab()?.fields['slug'] ?? ''));
  readonly descriptionValue = computed(() => String(this.store.activeTab()?.fields['description'] ?? ''));

  readonly tagsString = computed(() => {
    const raw = this.store.activeTab()?.fields['tags'];
    return Array.isArray(raw) ? raw.join(', ') : String(raw ?? '');
  });

  readonly customEntries = computed<[string, string][]>(() => {
    const fields = this.store.activeTab()?.fields ?? {};
    return Object.entries(fields)
      .filter(([k]) => !this.reservedKeys.has(k))
      .map(([k, v]) => [k, String(v ?? '')]);
  });

  onTagsChange(value: string): void {
    const tags = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.store.updateActiveField('tags', tags);
  }

  addCustomField(): void {
    const key = this.newFieldKey.trim();
    if (!key) return;
    this.store.updateActiveField(key, this.newFieldValue);
    this.newFieldKey = '';
    this.newFieldValue = '';
  }
}
