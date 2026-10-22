import { computed, Injectable, inject, signal } from '@angular/core';
import { TAURI_EVENTS } from '../bridge/events';
import {
  AiRevisionMode,
  AiRevisionResult,
  AppSettings,
  DeployConfig,
  DeployEventPayload,
  DeployPlanPayload,
  DocumentPayload,
  EditorTab,
  GitStatusPayload,
  LogLine,
  ProjectSummary,
  ProseIssue,
  ServerStatusPayload,
  SiteGraphPayload,
  SsgDescriptor,
  SsgId,
  ViewportMode,
  ViewportOrientation,
  ViewportPreset,
  ViewportZoom
} from '../bridge/models';
import { TauriApiService, TOP_20_SSG_CATALOG } from '../bridge/tauri-api.service';
import { ProseService } from '../services/prose.service';

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  // Desktop
  { id: 'desktop-fluid', category: 'desktop', name: 'Responsive Fluid', width: 0, height: 0, rotatable: false },
  { id: 'desktop-1280', category: 'desktop', name: 'Laptop 13" (1280×800)', width: 1280, height: 800, rotatable: false },
  { id: 'desktop-1440', category: 'desktop', name: 'Desktop HD (1440×900)', width: 1440, height: 900, rotatable: false },
  { id: 'desktop-1080p', category: 'desktop', name: 'Desktop 1080p (1920×1080)', width: 1920, height: 1080, rotatable: false },
  // Tablet
  { id: 'ipad-mini', category: 'tablet', name: 'iPad Mini (768×1024)', width: 768, height: 1024, rotatable: true },
  { id: 'ipad-air', category: 'tablet', name: 'iPad Air (820×1180)', width: 820, height: 1180, rotatable: true },
  { id: 'ipad-pro', category: 'tablet', name: 'iPad Pro 12.9" (1024×1366)', width: 1024, height: 1366, rotatable: true },
  // Mobile
  { id: 'iphone-se', category: 'mobile', name: 'iPhone SE (375×667)', width: 375, height: 667, rotatable: true },
  { id: 'iphone-16-pro', category: 'mobile', name: 'iPhone 16 Pro (393×852)', width: 393, height: 852, rotatable: true },
  { id: 'pixel-9', category: 'mobile', name: 'Pixel 9 (412×915)', width: 412, height: 915, rotatable: true }
];

export interface PreviewState {
  mode: ViewportMode;
  presetId: string;
  orientation: ViewportOrientation;
  width: number;
  height: number;
  zoom: ViewportZoom;
  route: string;
  followEditor: boolean;
  reloadToken: number;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly api = inject(TauriApiService);
  private readonly prose = inject(ProseService);

  // Non-reactive callback registered by MonacoEditorComponent to jump cursor to a prose issue span
  revealInEditor: ((offset: number, length: number) => void) | null = null;

  // Layout mode: split (editor + preview), code-only, or preview-only
  readonly workspaceLayout = signal<'split' | 'code' | 'preview'>('split');
  readonly showBottomPanel = signal<boolean>(true);
  readonly showRightPanel = signal<boolean>(true);
  readonly activeRightTab = signal<'prose' | 'ai' | 'mermaid' | 'git' | 'deploy'>('prose');

  // Core project & SSG state
  readonly availableSsgs = signal<SsgDescriptor[]>(TOP_20_SSG_CATALOG);
  readonly project = signal<ProjectSummary | null>(null);
  readonly activeSsg = computed<SsgId>(() => this.project()?.activeSsg ?? 'hugo');
  readonly activeSsgDescriptor = computed<SsgDescriptor>(
    () => this.availableSsgs().find((s) => s.id === this.activeSsg()) ?? TOP_20_SSG_CATALOG[0]
  );

  // Editor buffer state (owned by WorkspaceStore, never by MonacoEditorComponent)
  readonly tabs = signal<EditorTab[]>([]);
  readonly activeTabPath = signal<string | null>(null);
  readonly activeTab = computed<EditorTab | null>(() => {
    const path = this.activeTabPath();
    if (!path) return null;
    return this.tabs().find((t) => t.path === path) ?? null;
  });

  readonly hasDirtyTabs = computed<boolean>(() =>
    this.tabs().some((t) => this.isTabDirty(t))
  );

  // Dev Server supervisor state
  readonly serverStatus = signal<ServerStatusPayload>({ state: 'stopped' });
  readonly serverLogs = signal<LogLine[]>([]);
  readonly buildInProgress = signal<boolean>(false);

  // Multi-Device Preview Browser state
  readonly previewState = signal<PreviewState>({
    mode: 'desktop',
    presetId: 'desktop-1280',
    orientation: 'portrait',
    width: 1280,
    height: 800,
    zoom: 'autofit',
    route: '/',
    followEditor: true,
    reloadToken: 1
  });

  // 3D Site Topology Graph state
  readonly siteGraph = signal<SiteGraphPayload>({ nodes: [], edges: [] });

  // Prose, Dictionary & Local AI state
  readonly projectDictionary = signal<string[]>([]);
  readonly proseIssues = signal<ProseIssue[]>([]);
  readonly aiBusy = signal<boolean>(false);
  readonly aiSuggestion = signal<{
    tabPath: string;
    snapshotBody: string;
    result: AiRevisionResult;
  } | null>(null);

  // Git & Deploy state
  readonly gitStatus = signal<GitStatusPayload | null>(null);
  readonly gitDiffText = signal<string>('');
  readonly deployConfig = signal<DeployConfig | null>(null);
  readonly deployPlan = signal<DeployPlanPayload | null>(null);
  readonly deployEvents = signal<DeployEventPayload[]>([]);
  readonly deployRunning = signal<boolean>(false);

  // App-level settings
  readonly settings = signal<AppSettings>({
    preferredSsg: 'hugo',
    binaryOverrides: {},
    recentProjects: [],
    llmEndpoint: 'http://localhost:11434/v1',
    llmModel: 'qwen2.5-coder:7b-instruct',
    editorFontSize: 13,
    editorWordWrap: true,
    proseSpellcheck: true,
    proseStyleCheck: true
  });

  async initialize(): Promise<void> {
    const [catalog, settings, status, logs, startupProject] = await Promise.all([
      this.api.getSsgCatalog(),
      this.api.getSettings(),
      this.api.getServerStatus(),
      this.api.getServerLogs(),
      this.api.getStartupProject()
    ]);
    this.availableSsgs.set(catalog);
    this.settings.set(settings);
    this.serverStatus.set(status);
    this.serverLogs.set(logs);

    // Subscribe to Rust -> Angular event streams
    await this.api.onEvent<LogLine>(TAURI_EVENTS.SSG_LOG, (line) => {
      this.serverLogs.update((prev) => [...prev.slice(-499), line]);
    });
    await this.api.onEvent<ServerStatusPayload>(TAURI_EVENTS.SSG_STATUS, (st) => {
      this.serverStatus.set(st);
    });
    await this.api.onEvent<DeployEventPayload>(TAURI_EVENTS.DEPLOY_EVENT, (ev) => {
      this.deployEvents.update((prev) => {
        const idx = prev.findIndex((p) => p.stepId === ev.stepId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = ev;
          return copy;
        }
        return [...prev, ev];
      });
    });
    await this.api.onEvent<ProjectSummary>(TAURI_EVENTS.PROJECT_CHANGED, (proj) => {
      this.project.set(proj);
    });

    // Priority 1: CLI directory argument (`orangegel .` or `orangegel /path/to/site`)
    // Priority 2: Most recent project or default demo project
    const initialPath =
      startupProject ||
      settings.recentProjects[0] ||
      '/Users/jaysmith/Projects/OpenSource/MyExternal/OrangeGel-site';
    try {
      await this.openProjectByPath(initialPath);
    } catch {
      // Fallback if initial demo project has not been created on disk yet
    }
  }

  async installCliLauncher(): Promise<string> {
    return this.api.installCliLauncher();
  }

  isTabDirty(tab: EditorTab): boolean {
    return tab.body !== tab.savedBody || JSON.stringify(tab.fields) !== tab.savedFieldsJson;
  }

  async openProjectByPath(path: string): Promise<void> {
    const summary = await this.api.openProject(path);
    this.project.set(summary);
    const [dict, graph, git, deployCfg, plan] = await Promise.all([
      this.api.readProjectDictionary(),
      this.api.getSiteGraph(),
      this.api.gitStatus(),
      this.api.getDeployConfig(),
      this.api.planDeploy()
    ]);
    this.projectDictionary.set(dict);
    await this.prose.ensureDictionaryLoaded(dict);
    this.siteGraph.set(graph);
    this.gitStatus.set(git);
    this.deployConfig.set(deployCfg);
    this.deployPlan.set(plan);

    // Open default first content file if no tab is open
    if (this.tabs().length === 0) {
      try {
        await this.openDocument('content/posts/architecture-overview.md');
      } catch {
        try {
          await this.openDocument('content/_index.md');
        } catch {
          // Ignore if no default markdown document exists yet
        }
      }
    }
  }

  async chooseAndOpenProject(): Promise<void> {
    const summary = await this.api.chooseProject();
    if (summary) {
      this.project.set(summary);
      await this.openProjectByPath(summary.rootPath);
    }
  }

  async createNewSite(path: string, ssg: SsgId, siteName: string): Promise<void> {
    const summary = await this.api.createNewSite(path, ssg, siteName);
    this.project.set(summary);
    await this.openProjectByPath(summary.rootPath);
  }

  async switchSsg(ssg: SsgId): Promise<void> {
    const summary = await this.api.switchProjectSsg(ssg);
    this.project.set(summary);
    const plan = await this.api.planDeploy();
    this.deployPlan.set(plan);
  }

  async openDocument(relPath: string): Promise<void> {
    const existing = this.tabs().find((t) => t.path === relPath);
    if (existing) {
      this.activeTabPath.set(relPath);
      this.syncFollowRoute(existing.previewRoute);
      this.runProseScan(existing.body, existing.isDoc);
      return;
    }

    const doc: DocumentPayload = await this.api.readDocument(relPath);
    const fieldsJson = JSON.stringify(doc.fields);
    const newTab: EditorTab = {
      path: doc.relPath,
      name: doc.name,
      lang: doc.lang,
      isDoc: doc.isDoc,
      format: doc.format,
      fields: structuredClone(doc.fields),
      body: doc.body,
      savedFieldsJson: fieldsJson,
      savedBody: doc.body,
      previewRoute: doc.previewRoute
    };

    this.tabs.update((list) => [...list, newTab]);
    this.activeTabPath.set(newTab.path);
    this.syncFollowRoute(newTab.previewRoute);
    this.runProseScan(newTab.body, newTab.isDoc);
  }

  closeTab(path: string): void {
    const remaining = this.tabs().filter((t) => t.path !== path);
    this.tabs.set(remaining);
    if (this.activeTabPath() === path) {
      const next = remaining[remaining.length - 1] ?? null;
      this.activeTabPath.set(next?.path ?? null);
      if (next) {
        this.runProseScan(next.body, next.isDoc);
      } else {
        this.proseIssues.set([]);
      }
    }
  }

  updateActiveBody(newBody: string): void {
    const path = this.activeTabPath();
    if (!path) return;
    let isDoc = false;
    this.tabs.update((list) =>
      list.map((tab) => {
        if (tab.path !== path) return tab;
        isDoc = tab.isDoc;
        return { ...tab, body: newBody };
      })
    );
    this.runProseScan(newBody, isDoc);
  }

  updateActiveField(key: string, value: unknown): void {
    const path = this.activeTabPath();
    if (!path) return;
    this.tabs.update((list) =>
      list.map((tab) => {
        if (tab.path !== path) return tab;
        return {
          ...tab,
          fields: {
            ...tab.fields,
            [key]: value
          }
        };
      })
    );
  }

  removeActiveField(key: string): void {
    const path = this.activeTabPath();
    if (!path) return;
    this.tabs.update((list) =>
      list.map((tab) => {
        if (tab.path !== path) return tab;
        const copy = { ...tab.fields };
        delete copy[key];
        return { ...tab, fields: copy };
      })
    );
  }

  async saveActiveTab(): Promise<void> {
    const tab = this.activeTab();
    if (!tab) return;
    await this.api.saveDocument(tab.path, tab.format, tab.fields, tab.body);
    const savedJson = JSON.stringify(tab.fields);
    this.tabs.update((list) =>
      list.map((t) =>
        t.path === tab.path ? { ...t, savedBody: tab.body, savedFieldsJson: savedJson } : t
      )
    );
    this.previewState.update((st) => ({ ...st, reloadToken: st.reloadToken + 1 }));
  }

  async scaffoldContent(relPath: string): Promise<void> {
    const created = await this.api.createContent(relPath, this.activeSsg());
    const summary = await this.api.refreshProjectTree();
    this.project.set(summary);
    await this.openDocument(created.relPath);
  }

  async startServer(): Promise<void> {
    const status = await this.api.startDevServer(true);
    this.serverStatus.set(status);
  }

  async stopServer(): Promise<void> {
    const status = await this.api.stopDevServer();
    this.serverStatus.set(status);
  }

  async triggerProductionBuild(): Promise<void> {
    this.buildInProgress.set(true);
    try {
      await this.api.runProductionBuild();
    } finally {
      this.buildInProgress.set(false);
    }
  }

  // Viewport Studio actions
  setViewportMode(mode: ViewportMode): void {
    const current = this.previewState();
    if (mode === 'desktop' || mode === 'tablet' || mode === 'mobile') {
      const defaultPreset =
        VIEWPORT_PRESETS.find((p) => p.category === mode && p.width > 0) ??
        VIEWPORT_PRESETS.find((p) => p.category === mode)!;
      this.previewState.set({
        ...current,
        mode,
        presetId: defaultPreset.id,
        orientation: 'portrait',
        width: defaultPreset.width,
        height: defaultPreset.height
      });
    } else {
      this.previewState.set({ ...current, mode });
    }
  }

  selectViewportPreset(presetId: string): void {
    const preset = VIEWPORT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.previewState.update((st) => ({
      ...st,
      mode: preset.category,
      presetId: preset.id,
      orientation: 'portrait',
      width: preset.width,
      height: preset.height
    }));
  }

  toggleOrientation(): void {
    this.previewState.update((st) => {
      if (st.width === 0 || st.height === 0) return st;
      const nextOrientation: ViewportOrientation =
        st.orientation === 'portrait' ? 'landscape' : 'portrait';
      return {
        ...st,
        orientation: nextOrientation,
        width: st.height,
        height: st.width
      };
    });
  }

  setCustomDimensions(width: number, height: number): void {
    this.previewState.update((st) => ({
      ...st,
      width: Math.max(240, Math.min(3840, width)),
      height: Math.max(240, Math.min(2160, height))
    }));
  }

  setZoom(zoom: ViewportZoom): void {
    this.previewState.update((st) => ({ ...st, zoom }));
  }

  setPreviewRoute(route: string): void {
    const normalized = route.startsWith('/') ? route : `/${route}`;
    this.previewState.update((st) => ({ ...st, route: normalized }));
  }

  toggleFollowEditor(): void {
    this.previewState.update((st) => ({ ...st, followEditor: !st.followEditor }));
  }

  reloadPreview(): void {
    this.previewState.update((st) => ({ ...st, reloadToken: st.reloadToken + 1 }));
  }

  async openExternalPreview(): Promise<void> {
    const base = this.serverStatus().url || 'http://127.0.0.1:1313';
    const url = `${base.replace(/\/$/, '')}${this.previewState().route}`;
    await this.api.openInSystemBrowser(url);
  }

  private syncFollowRoute(route: string): void {
    if (this.previewState().followEditor && route) {
      this.previewState.update((st) => ({ ...st, route }));
    }
  }

  // Prose & Dictionary actions
  runProseScan(body: string, isDoc: boolean): void {
    if (!isDoc) {
      this.proseIssues.set([]);
      return;
    }
    const cfg = this.settings();
    const issues = this.prose.checkProse(body, {
      spellcheck: cfg.proseSpellcheck,
      styleCheck: cfg.proseStyleCheck
    });
    this.proseIssues.set(issues);
  }

  async addWordToDictionary(word: string): Promise<void> {
    const updated = await this.api.addProjectDictionaryWord(word);
    this.projectDictionary.set(updated);
    this.prose.addWord(word);
    const active = this.activeTab();
    if (active) {
      this.runProseScan(active.body, active.isDoc);
    }
  }

  applyProseSuggestion(issue: ProseIssue, replacement: string): void {
    const tab = this.activeTab();
    if (!tab) return;
    const before = tab.body.slice(0, issue.offset);
    const after = tab.body.slice(issue.offset + issue.length);
    this.updateActiveBody(before + replacement + after);
  }

  // Local AI Proofreader actions
  async requestAiRevision(mode: AiRevisionMode): Promise<void> {
    const tab = this.activeTab();
    if (!tab) return;
    const snapshot = tab.body;
    this.aiBusy.set(true);
    try {
      const result = await this.api.aiRevise(snapshot, mode);
      this.aiSuggestion.set({
        tabPath: tab.path,
        snapshotBody: snapshot,
        result
      });
    } finally {
      this.aiBusy.set(false);
    }
  }

  applyAiSuggestion(): { ok: boolean; reason?: string } {
    const suggestion = this.aiSuggestion();
    const tab = this.activeTab();
    if (!suggestion || !tab) {
      return { ok: false, reason: 'No active suggestion' };
    }
    if (tab.path !== suggestion.tabPath || tab.body !== suggestion.snapshotBody) {
      return {
        ok: false,
        reason: 'Stale buffer guard: The document changed since this AI revision was generated. Re-run revision first.'
      };
    }
    this.updateActiveBody(suggestion.result.revisedText);
    this.aiSuggestion.set(null);
    return { ok: true };
  }

  // Git & Deploy actions
  async refreshGit(): Promise<void> {
    const status = await this.api.gitStatus();
    this.gitStatus.set(status);
    const diff = await this.api.gitDiff(status.files[0]?.path);
    this.gitDiffText.set(diff);
  }

  async commitChanges(message: string): Promise<void> {
    if (!message.trim()) return;
    await this.api.gitCommit(message);
    await this.refreshGit();
  }

  async pushChanges(): Promise<void> {
    await this.api.gitPush();
    await this.refreshGit();
  }

  async updateDeployConfig(patch: Partial<DeployConfig>): Promise<void> {
    const current: DeployConfig = this.deployConfig() ?? {
      provider: 'firebase',
      firebaseSite: 'orangegel-docs',
      gcpProject: 'jasonsmithio',
      appLabel: 'orangegel-docs',
      envLabel: 'prod',
      verifyUrl: 'https://orangegel-docs.web.app',
      githubRepo: 'orangegel/site',
      githubBranch: 'gh-pages',
      useBlacksmithCi: true,
      gitlabProject: 'jasonsmithio/orangegel-site',
      gitlabBranch: 'main',
      cloudflareProject: 'orangegel-site',
      cloudflareBranch: 'main',
      netlifySiteId: 'orangegel-site',
      vercelProject: 'orangegel-site',
      s3Bucket: 'orangegel-static-site',
      cloudfrontDistributionId: 'E1ORANGEGELDIST'
    };
    const next: DeployConfig = { ...current, ...patch };
    this.deployConfig.set(next);
    await this.api.saveDeployConfig(next);
    const plan = await this.api.planDeploy(next);
    this.deployPlan.set(plan);
  }

  async executeDeployPipeline(): Promise<void> {
    this.deployRunning.set(true);
    this.deployEvents.set([]);
    try {
      await this.api.runDeploy(this.deployConfig() ?? undefined);
    } finally {
      this.deployRunning.set(false);
    }
  }

  async updateSettings(next: AppSettings): Promise<void> {
    this.settings.set(next);
    await this.api.saveSettings(next);
    const tab = this.activeTab();
    if (tab) {
      this.runProseScan(tab.body, tab.isDoc);
    }
  }
}
