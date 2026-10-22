import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { TAURI_COMMANDS, TAURI_EVENTS } from './events';
import {
  AiRevisionMode,
  AiRevisionResult,
  AppSettings,
  CommandResult,
  DeployConfig,
  DeployEventPayload,
  DeployPlanPayload,
  DocumentPayload,
  GitStatusPayload,
  LogLine,
  ProjectSummary,
  ServerStatusPayload,
  SiteGraphPayload,
  SsgDescriptor,
  SsgId
} from './models';

export const TOP_20_SSG_CATALOG: SsgDescriptor[] = [
  {
    id: 'hugo',
    displayName: 'Hugo',
    ecosystem: 'Go',
    isPreferred: true,
    configMarkers: ['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml'],
    devCommandPreview: 'hugo server --port <P> --bind 127.0.0.1 --buildDrafts',
    buildCommandPreview: 'hugo --gc --minify',
    defaultOutputDir: 'public/',
    contentDirs: ['content/']
  },
  {
    id: 'nextjs',
    displayName: 'Next.js',
    ecosystem: 'JS/TS (React)',
    isPreferred: false,
    configMarkers: ['next.config.ts', 'next.config.mjs', 'next.config.js'],
    devCommandPreview: 'npx next dev --port <P> --hostname 127.0.0.1',
    buildCommandPreview: 'npx next build',
    defaultOutputDir: 'out/',
    contentDirs: ['src/app/', 'app/', 'pages/', 'content/']
  },
  {
    id: 'docusaurus',
    displayName: 'Docusaurus',
    ecosystem: 'JS/TS (React)',
    isPreferred: false,
    configMarkers: ['docusaurus.config.ts', 'docusaurus.config.js'],
    devCommandPreview: 'npx docusaurus start --port <P> --host 127.0.0.1 --no-open',
    buildCommandPreview: 'npx docusaurus build',
    defaultOutputDir: 'build/',
    contentDirs: ['docs/', 'blog/', 'src/pages/']
  },
  {
    id: 'nuxt',
    displayName: 'Nuxt',
    ecosystem: 'JS/TS (Vue)',
    isPreferred: false,
    configMarkers: ['nuxt.config.ts', 'nuxt.config.js'],
    devCommandPreview: 'npx nuxi dev --port <P> --host 127.0.0.1',
    buildCommandPreview: 'npx nuxi generate',
    defaultOutputDir: '.output/public/',
    contentDirs: ['content/', 'pages/']
  },
  {
    id: 'gatsby',
    displayName: 'Gatsby',
    ecosystem: 'JS/TS (React)',
    isPreferred: false,
    configMarkers: ['gatsby-config.ts', 'gatsby-config.js'],
    devCommandPreview: 'npx gatsby develop --port <P> --host 127.0.0.1',
    buildCommandPreview: 'npx gatsby build',
    defaultOutputDir: 'public/',
    contentDirs: ['src/pages/', 'content/']
  },
  {
    id: 'astro',
    displayName: 'Astro',
    ecosystem: 'JS/TS',
    isPreferred: false,
    configMarkers: ['astro.config.mjs', 'astro.config.ts'],
    devCommandPreview: 'npx astro dev --port <P> --host 127.0.0.1',
    buildCommandPreview: 'npx astro build',
    defaultOutputDir: 'dist/',
    contentDirs: ['src/content/', 'src/pages/']
  },
  {
    id: 'jekyll',
    displayName: 'Jekyll',
    ecosystem: 'Ruby',
    isPreferred: false,
    configMarkers: ['_config.yml', 'Gemfile'],
    devCommandPreview: 'bundle exec jekyll serve --port <P> --host 127.0.0.1 --livereload',
    buildCommandPreview: 'bundle exec jekyll build',
    defaultOutputDir: '_site/',
    contentDirs: ['_posts/', '_drafts/']
  },
  {
    id: 'hexo',
    displayName: 'Hexo',
    ecosystem: 'JS/Node',
    isPreferred: false,
    configMarkers: ['_config.yml', 'package.json (hexo)'],
    devCommandPreview: 'npx hexo server -p <P> -i 127.0.0.1',
    buildCommandPreview: 'npx hexo generate',
    defaultOutputDir: 'public/',
    contentDirs: ['source/_posts/', 'source/']
  },
  {
    id: 'vuepress',
    displayName: 'VuePress',
    ecosystem: 'JS/TS (Vue)',
    isPreferred: false,
    configMarkers: ['.vuepress/config.ts', 'docs/.vuepress/config.js'],
    devCommandPreview: 'npx vuepress dev docs --port <P> --host 127.0.0.1',
    buildCommandPreview: 'npx vuepress build docs',
    defaultOutputDir: 'docs/.vuepress/dist/',
    contentDirs: ['docs/']
  },
  {
    id: 'eleventy',
    displayName: 'Eleventy (11ty)',
    ecosystem: 'JS/Node',
    isPreferred: false,
    configMarkers: ['eleventy.config.js', '.eleventy.js'],
    devCommandPreview: 'npx @11ty/eleventy --serve --port=<P>',
    buildCommandPreview: 'npx @11ty/eleventy',
    defaultOutputDir: '_site/',
    contentDirs: ['src/', 'content/', 'posts/']
  },
  {
    id: 'vitepress',
    displayName: 'VitePress',
    ecosystem: 'JS/TS (Vue)',
    isPreferred: false,
    configMarkers: ['.vitepress/config.mts', 'docs/.vitepress/config.ts'],
    devCommandPreview: 'npx vitepress dev docs --port <P> --host 127.0.0.1',
    buildCommandPreview: 'npx vitepress build docs',
    defaultOutputDir: 'docs/.vitepress/dist/',
    contentDirs: ['docs/']
  },
  {
    id: 'mkdocs',
    displayName: 'MkDocs',
    ecosystem: 'Python',
    isPreferred: false,
    configMarkers: ['mkdocs.yml', 'mkdocs.yaml'],
    devCommandPreview: 'mkdocs serve --dev-addr 127.0.0.1:<P>',
    buildCommandPreview: 'mkdocs build',
    defaultOutputDir: 'site/',
    contentDirs: ['docs/']
  },
  {
    id: 'zola',
    displayName: 'Zola',
    ecosystem: 'Rust',
    isPreferred: false,
    configMarkers: ['config.toml', 'templates/'],
    devCommandPreview: 'zola serve --port <P> --interface 127.0.0.1',
    buildCommandPreview: 'zola build',
    defaultOutputDir: 'public/',
    contentDirs: ['content/']
  },
  {
    id: 'pelican',
    displayName: 'Pelican',
    ecosystem: 'Python',
    isPreferred: false,
    configMarkers: ['pelicanconf.py'],
    devCommandPreview: 'pelican --listen --port <P> --bind 127.0.0.1 --autoreload',
    buildCommandPreview: 'pelican content -s publishconf.py',
    defaultOutputDir: 'output/',
    contentDirs: ['content/']
  },
  {
    id: 'sveltekit',
    displayName: 'SvelteKit',
    ecosystem: 'JS/TS (Svelte)',
    isPreferred: false,
    configMarkers: ['svelte.config.js'],
    devCommandPreview: 'npx vite dev --port <P> --host 127.0.0.1',
    buildCommandPreview: 'npx vite build',
    defaultOutputDir: 'build/',
    contentDirs: ['src/routes/', 'src/content/']
  },
  {
    id: 'remix',
    displayName: 'Remix / React Router',
    ecosystem: 'JS/TS (React)',
    isPreferred: false,
    configMarkers: ['react-router.config.ts', 'vite.config.ts'],
    devCommandPreview: 'npx vite dev --port <P> --host 127.0.0.1',
    buildCommandPreview: 'npx vite build',
    defaultOutputDir: 'build/client/',
    contentDirs: ['app/routes/', 'content/']
  },
  {
    id: 'middleman',
    displayName: 'Middleman',
    ecosystem: 'Ruby',
    isPreferred: false,
    configMarkers: ['config.rb', 'Gemfile'],
    devCommandPreview: 'bundle exec middleman server -p <P> -b 127.0.0.1',
    buildCommandPreview: 'bundle exec middleman build',
    defaultOutputDir: 'build/',
    contentDirs: ['source/']
  },
  {
    id: 'metalsmith',
    displayName: 'Metalsmith',
    ecosystem: 'JS/Node',
    isPreferred: false,
    configMarkers: ['metalsmith.js', 'metalsmith.json'],
    devCommandPreview: 'npx browser-sync start --server build --port <P> --no-open',
    buildCommandPreview: 'npm run build',
    defaultOutputDir: 'build/',
    contentDirs: ['src/']
  },
  {
    id: 'gridsome',
    displayName: 'Gridsome',
    ecosystem: 'JS/Vue',
    isPreferred: false,
    configMarkers: ['gridsome.config.js'],
    devCommandPreview: 'npx gridsome develop --port <P> --host 127.0.0.1',
    buildCommandPreview: 'npx gridsome build',
    defaultOutputDir: 'dist/',
    contentDirs: ['src/pages/', 'content/']
  },
  {
    id: 'bridgetown',
    displayName: 'Bridgetown',
    ecosystem: 'Ruby',
    isPreferred: false,
    configMarkers: ['bridgetown.config.yml'],
    devCommandPreview: 'bin/bridgetown start -p <P> -b 127.0.0.1',
    buildCommandPreview: 'bin/bridgetown build',
    defaultOutputDir: 'output/',
    contentDirs: ['src/_posts/', 'src/']
  }
];

@Injectable({ providedIn: 'root' })
export class TauriApiService {
  private mockDocs = new Map<string, DocumentPayload>();
  private mockDictionary: string[] = ['OrangeGel', 'OrangeGelCore', 'Jamstack', 'Tauri', 'Hugo', 'Shortcode'];
  private mockServerStatus: ServerStatusPayload = { state: 'stopped' };
  private mockLogs: LogLine[] = [
    {
      timestamp: '10:15:00',
      stream: 'system',
      level: 'info',
      text: 'OrangeGel supervisor ready — Hugo (Preferred) + 19 Jamstack SSG adapters loaded.'
    }
  ];
  private mockListeners = new Map<string, Set<(payload: any) => void>>();

  constructor() {
    this.seedDemoFiles();
  }

  isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  private emitMock<T>(event: string, payload: T): void {
    const callbacks = this.mockListeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(payload));
    }
  }

  async onEvent<T>(eventName: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    if (this.isTauriRuntime()) {
      return listen<T>(eventName, (event) => handler(event.payload));
    }
    if (!this.mockListeners.has(eventName)) {
      this.mockListeners.set(eventName, new Set());
    }
    this.mockListeners.get(eventName)!.add(handler);
    return () => {
      this.mockListeners.get(eventName)?.delete(handler);
    };
  }

  async getSsgCatalog(): Promise<SsgDescriptor[]> {
    if (this.isTauriRuntime()) {
      return invoke<SsgDescriptor[]>(TAURI_COMMANDS.GET_SSG_CATALOG);
    }
    return TOP_20_SSG_CATALOG;
  }

  async openProject(path: string): Promise<ProjectSummary> {
    if (this.isTauriRuntime()) {
      return invoke<ProjectSummary>(TAURI_COMMANDS.OPEN_PROJECT, { path });
    }
    return this.getDemoProjectSummary(path);
  }

  async chooseProject(): Promise<ProjectSummary | null> {
    if (this.isTauriRuntime()) {
      return invoke<ProjectSummary | null>(TAURI_COMMANDS.CHOOSE_PROJECT);
    }
    return this.getDemoProjectSummary('/Users/demo/Sites/citrus-hugo-docs');
  }

  async createNewSite(path: string, ssg: SsgId, siteName: string): Promise<ProjectSummary> {
    if (this.isTauriRuntime()) {
      return invoke<ProjectSummary>(TAURI_COMMANDS.CREATE_NEW_SITE, { path, ssg, siteName });
    }
    const summary = this.getDemoProjectSummary(`${path.replace(/\/$/, '')}/${siteName}`, ssg);
    this.emitMock(TAURI_EVENTS.PROJECT_CHANGED, summary);
    return summary;
  }

  async switchProjectSsg(ssg: SsgId): Promise<ProjectSummary> {
    if (this.isTauriRuntime()) {
      return invoke<ProjectSummary>(TAURI_COMMANDS.SWITCH_PROJECT_SSG, { ssg });
    }
    const summary = this.getDemoProjectSummary('/Users/demo/Sites/citrus-hugo-docs', ssg);
    this.emitMock(TAURI_EVENTS.PROJECT_CHANGED, summary);
    return summary;
  }

  async refreshProjectTree(): Promise<ProjectSummary> {
    if (this.isTauriRuntime()) {
      return invoke<ProjectSummary>(TAURI_COMMANDS.REFRESH_PROJECT_TREE);
    }
    return this.getDemoProjectSummary('/Users/demo/Sites/citrus-hugo-docs');
  }

  async readDocument(relPath: string): Promise<DocumentPayload> {
    if (this.isTauriRuntime()) {
      return invoke<DocumentPayload>(TAURI_COMMANDS.READ_DOCUMENT, { relPath });
    }
    const existing = this.mockDocs.get(relPath);
    if (existing) {
      return structuredClone(existing);
    }
    const fallback: DocumentPayload = {
      relPath,
      name: relPath.split('/').pop() || relPath,
      lang: relPath.endsWith('.toml') ? 'toml' : relPath.endsWith('.html') ? 'html' : 'markdown',
      isDoc: relPath.endsWith('.md') || relPath.endsWith('.mdx'),
      format: 'toml',
      fields: {
        title: 'Untitled Document',
        date: '2026-10-20',
        draft: true,
        slug: 'untitled',
        tags: ['hugo', 'orangegel']
      },
      body: '# New Content\n\nWrite your static site content here.\n',
      previewRoute: '/'
    };
    this.mockDocs.set(relPath, fallback);
    return structuredClone(fallback);
  }

  async saveDocument(
    relPath: string,
    format: 'yaml' | 'toml' | 'json' | 'none',
    fields: Record<string, unknown>,
    body: string
  ): Promise<void> {
    if (this.isTauriRuntime()) {
      await invoke<void>(TAURI_COMMANDS.SAVE_DOCUMENT, { relPath, format, fields, body });
      return;
    }
    const doc = this.mockDocs.get(relPath);
    if (doc) {
      doc.format = format;
      doc.fields = structuredClone(fields);
      doc.body = body;
    }
  }

  async createContent(relPath: string, ssg: SsgId): Promise<DocumentPayload> {
    if (this.isTauriRuntime()) {
      return invoke<DocumentPayload>(TAURI_COMMANDS.CREATE_CONTENT, { relPath, ssg });
    }
    const slug = (relPath.split('/').pop() || 'post').replace(/\.mdx?$/, '');
    const created: DocumentPayload = {
      relPath,
      name: relPath.split('/').pop() || relPath,
      lang: 'markdown',
      isDoc: true,
      format: ssg === 'hugo' || ssg === 'zola' ? 'toml' : 'yaml',
      fields: {
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        date: new Date().toISOString().slice(0, 10),
        draft: true,
        slug,
        tags: [ssg, 'draft'],
        description: `Created with ${ssg.toUpperCase()} archetype in OrangeGel.`
      },
      body: `## ${slug.replace(/-/g, ' ')}\n\nStart writing your **${ssg}** article here.\n\n\`\`\`mermaid\nflowchart LR\n  Author["Author in Monaco"] --> Preview["Responsive Device Studio"]\n  Preview --> Deploy["Firebase Hosting Edge"]\n\`\`\`\n`,
      previewRoute: '/' + relPath.replace(/^content\//, '').replace(/\.mdx?$/, '/')
    };
    this.mockDocs.set(relPath, created);
    return structuredClone(created);
  }

  async deleteFile(relPath: string): Promise<boolean> {
    if (this.isTauriRuntime()) {
      return invoke<boolean>(TAURI_COMMANDS.DELETE_FILE, { relPath });
    }
    this.mockDocs.delete(relPath);
    return true;
  }

  async getSiteGraph(): Promise<SiteGraphPayload> {
    if (this.isTauriRuntime()) {
      return invoke<SiteGraphPayload>(TAURI_COMMANDS.GET_SITE_GRAPH);
    }
    return {
      nodes: [
        {
          id: 'home',
          label: 'Home (_index.md)',
          relPath: 'content/_index.md',
          route: '/',
          status: 'published',
          wordCount: 420
        },
        {
          id: 'arch',
          label: 'Architecture & Spatial UI',
          relPath: 'content/posts/architecture-overview.md',
          route: '/posts/architecture-overview/',
          status: 'published',
          wordCount: 890
        },
        {
          id: 'ssg20',
          label: 'Top 20 Jamstack Generators',
          relPath: 'content/posts/jamstack-top-20.md',
          route: '/posts/jamstack-top-20/',
          status: 'draft',
          wordCount: 640
        },
        {
          id: 'sec-posts',
          label: 'Section: /posts/',
          relPath: 'content/posts/_index.md',
          route: '/posts/',
          status: 'section',
          wordCount: 150
        },
        {
          id: 'tax-hugo',
          label: 'Tag: #hugo',
          relPath: 'content/tags/hugo/_index.md',
          route: '/tags/hugo/',
          status: 'taxonomy',
          wordCount: 80
        },
        {
          id: 'broken-ref',
          label: 'Missing: /docs/legacy-wails',
          relPath: 'content/docs/legacy-wails.md',
          route: '/docs/legacy-wails/',
          status: 'broken-link',
          wordCount: 0
        }
      ],
      edges: [
        { source: 'home', target: 'sec-posts' },
        { source: 'sec-posts', target: 'arch' },
        { source: 'sec-posts', target: 'ssg20' },
        { source: 'arch', target: 'tax-hugo' },
        { source: 'ssg20', target: 'tax-hugo' },
        { source: 'arch', target: 'broken-ref', broken: true }
      ]
    };
  }

  async startDevServer(buildDrafts = true): Promise<ServerStatusPayload> {
    if (this.isTauriRuntime()) {
      return invoke<ServerStatusPayload>(TAURI_COMMANDS.START_DEV_SERVER, { buildDrafts });
    }
    this.mockServerStatus = { state: 'starting', ssg: 'hugo' };
    this.emitMock(TAURI_EVENTS.SSG_STATUS, this.mockServerStatus);
    const startLog: LogLine = {
      timestamp: new Date().toTimeString().slice(0, 8),
      stream: 'stdout',
      level: 'info',
      text: 'Spawning process group: hugo server --port 54132 --bind 127.0.0.1 --buildDrafts'
    };
    this.mockLogs.push(startLog);
    this.emitMock(TAURI_EVENTS.SSG_LOG, startLog);

    this.mockServerStatus = {
      state: 'running',
      port: 54132,
      url: 'http://127.0.0.1:54132',
      ssg: 'hugo'
    };
    this.emitMock(TAURI_EVENTS.SSG_STATUS, this.mockServerStatus);
    const readyLog: LogLine = {
      timestamp: new Date().toTimeString().slice(0, 8),
      stream: 'stdout',
      level: 'info',
      text: 'Web Server is available at http://127.0.0.1:54132/ (bind address 127.0.0.1) — Built in 42 ms'
    };
    this.mockLogs.push(readyLog);
    this.emitMock(TAURI_EVENTS.SSG_LOG, readyLog);
    return this.mockServerStatus;
  }

  async stopDevServer(): Promise<ServerStatusPayload> {
    if (this.isTauriRuntime()) {
      return invoke<ServerStatusPayload>(TAURI_COMMANDS.STOP_DEV_SERVER);
    }
    this.mockServerStatus = { state: 'stopped' };
    this.emitMock(TAURI_EVENTS.SSG_STATUS, this.mockServerStatus);
    const stopLog: LogLine = {
      timestamp: new Date().toTimeString().slice(0, 8),
      stream: 'system',
      level: 'info',
      text: 'Sent SIGTERM to process group (-pgid); ephemeral port 54132 released.'
    };
    this.mockLogs.push(stopLog);
    this.emitMock(TAURI_EVENTS.SSG_LOG, stopLog);
    return this.mockServerStatus;
  }

  async getServerStatus(): Promise<ServerStatusPayload> {
    if (this.isTauriRuntime()) {
      return invoke<ServerStatusPayload>(TAURI_COMMANDS.GET_SERVER_STATUS);
    }
    return this.mockServerStatus;
  }

  async getServerLogs(): Promise<LogLine[]> {
    if (this.isTauriRuntime()) {
      return invoke<LogLine[]>(TAURI_COMMANDS.GET_SERVER_LOGS);
    }
    return [...this.mockLogs];
  }

  async runProductionBuild(): Promise<CommandResult> {
    if (this.isTauriRuntime()) {
      return invoke<CommandResult>(TAURI_COMMANDS.RUN_PRODUCTION_BUILD);
    }
    const buildLog: LogLine = {
      timestamp: new Date().toTimeString().slice(0, 8),
      stream: 'stdout',
      level: 'info',
      text: 'Production build complete: hugo --gc --minify → public/ (28 pages, 0 errors in 68ms)'
    };
    this.mockLogs.push(buildLog);
    this.emitMock(TAURI_EVENTS.SSG_LOG, buildLog);
    return {
      ok: true,
      exitCode: 0,
      stdout: 'Pages: 28 | Non-page files: 14 | Total in 68 ms',
      stderr: ''
    };
  }

  async openInSystemBrowser(url: string): Promise<void> {
    if (this.isTauriRuntime()) {
      await invoke<void>(TAURI_COMMANDS.OPEN_IN_SYSTEM_BROWSER, { url });
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async readProjectDictionary(): Promise<string[]> {
    if (this.isTauriRuntime()) {
      return invoke<string[]>(TAURI_COMMANDS.READ_PROJECT_DICTIONARY);
    }
    return [...this.mockDictionary];
  }

  async addProjectDictionaryWord(word: string): Promise<string[]> {
    if (this.isTauriRuntime()) {
      return invoke<string[]>(TAURI_COMMANDS.ADD_PROJECT_DICTIONARY_WORD, { word });
    }
    if (!this.mockDictionary.includes(word)) {
      this.mockDictionary.push(word);
    }
    return [...this.mockDictionary];
  }

  async aiRevise(text: string, mode: AiRevisionMode): Promise<AiRevisionResult> {
    if (this.isTauriRuntime()) {
      return invoke<AiRevisionResult>(TAURI_COMMANDS.AI_REVISE, { text, mode });
    }
    const MAX_CHUNK = 12000;
    const head = text.slice(0, MAX_CHUNK);
    const tail = text.slice(MAX_CHUNK);
    let revisedHead = head
      .replace(/\bvery\s+/gi, '')
      .replace(/\bbasically\s+/gi, '')
      .replace(/\bwas written by\b/gi, 'wrote')
      .replace(/\bis being rendered by\b/gi, 'renders in')
      .replace(/\bthe the\b/gi, 'the');
    if (mode === 'tighten' && revisedHead === head) {
      revisedHead = head.replace(/\bin order to\b/gi, 'to').replace(/\bdue to the fact that\b/gi, 'because');
    }
    if (revisedHead === head) {
      revisedHead = head + '\n\n<!-- Proofread verified with temperature: 0.0 -->';
    }
    return {
      mode,
      originalText: text,
      revisedText: revisedHead + tail,
      model: 'qwen2.5-coder:7b-instruct (localhost:11434)',
      truncatedTailPreserved: tail.length > 0
    };
  }

  async gitStatus(): Promise<GitStatusPayload> {
    if (this.isTauriRuntime()) {
      return invoke<GitStatusPayload>(TAURI_COMMANDS.GIT_STATUS);
    }
    return {
      branch: 'main',
      ahead: 1,
      behind: 0,
      remoteName: 'origin',
      remoteUrl: 'git@github.com:jasonsmithio/citrus-hugo-docs.git',
      files: [
        { path: 'content/posts/architecture-overview.md', status: 'M', staged: false },
        { path: 'hugo.toml', status: 'M', staged: true },
        { path: '.orangegel/dictionary.txt', status: 'A', staged: true }
      ]
    };
  }

  async gitDiff(relPath?: string): Promise<string> {
    if (this.isTauriRuntime()) {
      return invoke<string>(TAURI_COMMANDS.GIT_DIFF, { relPath });
    }
    return [
      `diff --git a/${relPath || 'content/posts/architecture-overview.md'} b/${relPath || 'content/posts/architecture-overview.md'}`,
      'index 84c92a1..f910b3e 100644',
      `--- a/${relPath || 'content/posts/architecture-overview.md'}`,
      `+++ b/${relPath || 'content/posts/architecture-overview.md'}`,
      '@@ -10,4 +10,5 @@',
      '-Legacy Wails + Svelte preview pane',
      '+Tauri v2 + Angular Signals + Multi-Device Responsive Preview Studio',
      '+Three.js 3D Site Topology Graph & Anime.js spring physics'
    ].join('\n');
  }

  async gitCommit(message: string): Promise<CommandResult> {
    if (this.isTauriRuntime()) {
      return invoke<CommandResult>(TAURI_COMMANDS.GIT_COMMIT, { message });
    }
    return {
      ok: true,
      exitCode: 0,
      stdout: `[main 9f41e2b] ${message}\n 2 files changed, 14 insertions(+), 2 deletions(-)`,
      stderr: ''
    };
  }

  async gitPush(): Promise<CommandResult | null> {
    if (this.isTauriRuntime()) {
      return invoke<CommandResult | null>(TAURI_COMMANDS.GIT_PUSH);
    }
    return {
      ok: true,
      exitCode: 0,
      stdout: 'To git@github.com:jasonsmithio/citrus-hugo-docs.git\n   4c10a8b..9f41e2b  main -> main',
      stderr: ''
    };
  }

  private mockDeployConfig: DeployConfig = {
    provider: 'firebase',
    firebaseSite: 'orangegel-docs',
    gcpProject: 'jasonsmithio',
    enableCloudRun: true,
    cloudRunService: 'orangegel-origin-ssr',
    cloudRunRegion: 'us-central1',
    appLabel: 'orangegel-docs',
    envLabel: 'prod',
    liveUrl: 'https://orangegel-docs.web.app',
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

  async getDeployConfig(): Promise<DeployConfig> {
    if (this.isTauriRuntime()) {
      return invoke<DeployConfig>(TAURI_COMMANDS.GET_DEPLOY_CONFIG);
    }
    return structuredClone(this.mockDeployConfig);
  }

  async saveDeployConfig(config: DeployConfig): Promise<DeployConfig> {
    if (this.isTauriRuntime()) {
      return invoke<DeployConfig>(TAURI_COMMANDS.SAVE_DEPLOY_CONFIG, { config });
    }
    this.mockDeployConfig = structuredClone(config);
    return structuredClone(this.mockDeployConfig);
  }

  async planDeploy(config?: DeployConfig): Promise<DeployPlanPayload> {
    if (this.isTauriRuntime()) {
      return invoke<DeployPlanPayload>(TAURI_COMMANDS.PLAN_DEPLOY, { config });
    }
    const cfg = config ? { ...this.mockDeployConfig, ...config } : await this.getDeployConfig();
    const provider = cfg.provider || 'firebase';
    const verifyUrl = cfg.liveUrl || cfg.verifyUrl || 'https://orangegel-docs.web.app';

    if (provider === 'githubpages') {
      const repo = cfg.githubRepo || 'orangegel/site';
      const branch = cfg.githubBranch || 'gh-pages';
      return {
        ssg: 'hugo',
        config: cfg,
        mermaidDiagram: [
          'flowchart TB',
          '  S1["1. Git Preflight"] --> S2["2. SSG Build"]',
          '  S2 --> S3["3. Blacksmith Workflow (blacksmith-4vcpu-ubuntu-2204)"]',
          '  S3 --> S4["4. GitHub Pages Publish LAST"]',
          '  S4 --> S5["5. SHA-256 Edge Verify"]'
        ].join('\n'),
        steps: [
          {
            step: 1,
            id: 'preflight',
            title: 'Preflight & GitHub Remote Check',
            commandPreview: `git remote -v && gh repo view ${repo}`,
            required: true
          },
          {
            step: 2,
            id: 'ssg_build',
            title: 'SSG Production Build (Hugo)',
            commandPreview: 'hugo --gc --minify',
            required: true
          },
          ...(cfg.useBlacksmithCi !== false
            ? [
                {
                  step: 3,
                  id: 'blacksmith_workflow',
                  title: 'Generate Blacksmith GitHub Pages Workflow (blacksmith-4vcpu-ubuntu-2204)',
                  commandPreview:
                    'Write .github/workflows/deploy-pages.yml (runs-on: blacksmith-4vcpu-ubuntu-2204 -> actions/deploy-pages@v4)',
                  required: true
                }
              ]
            : []),
          {
            step: cfg.useBlacksmithCi !== false ? 4 : 3,
            id: 'github_pages',
            title: 'GitHub Pages Branch Release (Edge Publish — Always Last)',
            commandPreview: `npx gh-pages -d public -b ${branch} -r https://github.com/${repo}.git`,
            required: true
          },
          {
            step: cfg.useBlacksmithCi !== false ? 5 : 4,
            id: 'verify_edge',
            title: 'Plain vs. Cache-Busted Edge SHA-256 Verification',
            commandPreview: `GET https://orangegel.github.io/site vs ?_og_cb=<ts>`,
            required: true
          }
        ]
      };
    }

    if (provider === 'gitlabpages') {
      const project = cfg.gitlabProject || 'jasonsmithio/orangegel-site';
      const branch = cfg.gitlabBranch || 'main';
      return {
        ssg: 'hugo',
        config: cfg,
        mermaidDiagram: [
          'flowchart TB',
          '  S1["1. GitLab Preflight"] --> S2["2. SSG Build"]',
          '  S2 --> S3["3. .gitlab-ci.yml pages:"]',
          '  S3 --> S4["4. GitLab Pages Push LAST"]',
          '  S4 --> S5["5. SHA-256 Edge Verify"]'
        ].join('\n'),
        steps: [
          {
            step: 1,
            id: 'preflight',
            title: 'Preflight & GitLab Remote Check',
            commandPreview: `git remote -v (target: gitlab.com/${project})`,
            required: true
          },
          {
            step: 2,
            id: 'ssg_build',
            title: 'SSG Production Build (Hugo)',
            commandPreview: 'hugo --gc --minify',
            required: true
          },
          {
            step: 3,
            id: 'gitlab_ci',
            title: 'Ensure .gitlab-ci.yml pages: Artifact Pipeline',
            commandPreview: 'Write .gitlab-ci.yml pages job publishing public/ artifact',
            required: true
          },
          {
            step: 4,
            id: 'gitlab_pages',
            title: 'GitLab Pages Push & Pipeline Release (Always Last)',
            commandPreview: `git push https://gitlab.com/${project}.git HEAD:${branch}`,
            required: true
          },
          {
            step: 5,
            id: 'verify_edge',
            title: 'Plain vs. Cache-Busted Edge SHA-256 Verification',
            commandPreview: `GET https://jasonsmithio.gitlab.io/orangegel-site vs ?_og_cb=<ts>`,
            required: true
          }
        ]
      };
    }

    if (provider === 'cloudflare') {
      const cfProj = cfg.cloudflareProject || 'orangegel-site';
      const cfBranch = cfg.cloudflareBranch || 'main';
      return {
        ssg: 'hugo',
        config: cfg,
        mermaidDiagram: [
          'flowchart TB',
          '  S1["1. Wrangler Preflight"] --> S2["2. SSG Build"]',
          '  S2 --> S3["3. Cloudflare Pages Edge LAST"]',
          '  S3 --> S4["4. SHA-256 Edge Verify"]'
        ].join('\n'),
        steps: [
          {
            step: 1,
            id: 'preflight',
            title: 'Preflight & Wrangler Auth Check',
            commandPreview: 'npx wrangler whoami',
            required: true
          },
          {
            step: 2,
            id: 'ssg_build',
            title: 'SSG Production Build (Hugo)',
            commandPreview: 'hugo --gc --minify',
            required: true
          },
          {
            step: 3,
            id: 'cloudflare_pages',
            title: 'Cloudflare Pages Edge Release (Always Last)',
            commandPreview: `npx wrangler pages deploy public --project-name ${cfProj} --branch ${cfBranch}`,
            required: true
          },
          {
            step: 4,
            id: 'verify_edge',
            title: 'Plain vs. Cache-Busted Edge SHA-256 Verification',
            commandPreview: `GET https://${cfProj}.pages.dev vs ?_og_cb=<ts>`,
            required: true
          }
        ]
      };
    }

    if (provider === 'netlify') {
      const siteId = cfg.netlifySiteId || 'orangegel-site';
      return {
        ssg: 'hugo',
        config: cfg,
        mermaidDiagram: [
          'flowchart TB',
          '  S1["1. Netlify Preflight"] --> S2["2. SSG Build"]',
          '  S2 --> S3["3. Netlify Prod Edge LAST"]',
          '  S3 --> S4["4. SHA-256 Edge Verify"]'
        ].join('\n'),
        steps: [
          {
            step: 1,
            id: 'preflight',
            title: 'Preflight & Netlify Auth Check',
            commandPreview: 'npx netlify status',
            required: true
          },
          {
            step: 2,
            id: 'ssg_build',
            title: 'SSG Production Build (Hugo)',
            commandPreview: 'hugo --gc --minify',
            required: true
          },
          {
            step: 3,
            id: 'netlify_edge',
            title: 'Netlify Production Edge Deploy (Always Last)',
            commandPreview: `npx netlify deploy --prod --dir public --site ${siteId}`,
            required: true
          },
          {
            step: 4,
            id: 'verify_edge',
            title: 'Plain vs. Cache-Busted Edge SHA-256 Verification',
            commandPreview: `GET https://${siteId}.netlify.app vs ?_og_cb=<ts>`,
            required: true
          }
        ]
      };
    }

    if (provider === 'vercel') {
      const vercelProj = cfg.vercelProject || 'orangegel-site';
      return {
        ssg: 'hugo',
        config: cfg,
        mermaidDiagram: [
          'flowchart TB',
          '  S1["1. Vercel Preflight"] --> S2["2. SSG Build"]',
          '  S2 --> S3["3. Vercel Prod Edge LAST"]',
          '  S3 --> S4["4. SHA-256 Edge Verify"]'
        ].join('\n'),
        steps: [
          {
            step: 1,
            id: 'preflight',
            title: 'Preflight & Vercel Auth Check',
            commandPreview: 'npx vercel whoami',
            required: true
          },
          {
            step: 2,
            id: 'ssg_build',
            title: 'SSG Production Build (Hugo)',
            commandPreview: 'hugo --gc --minify',
            required: true
          },
          {
            step: 3,
            id: 'vercel_edge',
            title: 'Vercel Production Edge Release (Always Last)',
            commandPreview: `npx vercel deploy public --prod --yes --name ${vercelProj}`,
            required: true
          },
          {
            step: 4,
            id: 'verify_edge',
            title: 'Plain vs. Cache-Busted Edge SHA-256 Verification',
            commandPreview: `GET https://${vercelProj}.vercel.app vs ?_og_cb=<ts>`,
            required: true
          }
        ]
      };
    }

    if (provider === 's3cloudfront') {
      const bucket = cfg.s3Bucket || 'orangegel-static-site';
      const distId = cfg.cloudfrontDistributionId || 'E1ORANGEGELDIST';
      return {
        ssg: 'hugo',
        config: cfg,
        mermaidDiagram: [
          'flowchart TB',
          '  S1["1. AWS Preflight"] --> S2["2. SSG Build"]',
          '  S2 --> S3["3. S3 Origin Sync"]',
          '  S3 --> S4["4. CloudFront Invalidate LAST"]',
          '  S4 --> S5["5. SHA-256 Edge Verify"]'
        ].join('\n'),
        steps: [
          {
            step: 1,
            id: 'preflight',
            title: 'Preflight & AWS STS Identity Check',
            commandPreview: 'aws sts get-caller-identity',
            required: true
          },
          {
            step: 2,
            id: 'ssg_build',
            title: 'SSG Production Build (Hugo)',
            commandPreview: 'hugo --gc --minify',
            required: true
          },
          {
            step: 3,
            id: 's3_sync',
            title: 'Sync Static Artifacts to S3 Origin',
            commandPreview: `aws s3 sync public s3://${bucket} --delete`,
            required: true
          },
          {
            step: 4,
            id: 'cloudfront_invalidation',
            title: 'CloudFront Edge Cache Invalidation (Always Last)',
            commandPreview: `aws cloudfront create-invalidation --distribution-id ${distId} --paths "/*"`,
            required: true
          },
          {
            step: 5,
            id: 'verify_edge',
            title: 'Plain vs. Cache-Busted Edge SHA-256 Verification',
            commandPreview: `GET https://${bucket}.s3.amazonaws.com vs ?_og_cb=<ts>`,
            required: true
          }
        ]
      };
    }

    return {
      ssg: 'hugo',
      config: cfg,
      mermaidDiagram: [
        'flowchart TB',
        '  S1["1. Preflight & Rollback"] --> S2["2. SSG Build"]',
        '  S2 --> S3["3. Cloud Run @sha256"]',
        '  S3 --> S4["4. Firebase Hosting Edge LAST"]',
        '  S4 --> S5["5. SHA-256 Edge Verify"]'
      ].join('\n'),
      steps: [
        {
          step: 1,
          id: 'preflight',
          title: 'Preflight & Rollback Capture',
          commandPreview: `gcloud run services describe ${cfg.cloudRunService} --region=${cfg.cloudRunRegion} --project=${cfg.gcpProject}`,
          required: true
        },
        {
          step: 2,
          id: 'ssg_build',
          title: 'SSG Production Build (Hugo)',
          commandPreview: 'hugo --gc --minify',
          required: true
        },
        {
          step: 3,
          id: 'cloud_run',
          title: 'Cloud Build & Cloud Run Origin (@sha256)',
          commandPreview: `gcloud run deploy ${cfg.cloudRunService} --image=us-central1-docker.pkg.dev/${cfg.gcpProject}/web/origin@sha256:e3b0c44298fc1c149afbf4c8996fb924 --region=${cfg.cloudRunRegion} --labels=app=${cfg.appLabel},env=${cfg.envLabel}`,
          required: Boolean(cfg.cloudRunService)
        },
        {
          step: 4,
          id: 'firebase_hosting',
          title: 'Firebase Hosting Release (Always Last — Edge Purge)',
          commandPreview: `firebase deploy --only hosting:${cfg.firebaseSite} --project ${cfg.gcpProject}`,
          required: true
        },
        {
          step: 5,
          id: 'verify_edge',
          title: 'Plain vs. Cache-Busted Edge SHA-256 Verification',
          commandPreview: `GET ${verifyUrl} vs ${verifyUrl}?_og_cb=<ts>`,
          required: true
        }
      ]
    };
  }

  async runDeploy(config?: DeployConfig): Promise<CommandResult | null> {
    if (this.isTauriRuntime()) {
      return invoke<CommandResult | null>(TAURI_COMMANDS.RUN_DEPLOY, { config });
    }
    const plan = await this.planDeploy(config);
    for (const s of plan.steps) {
      this.emitMock<DeployEventPayload>(TAURI_EVENTS.DEPLOY_EVENT, {
        stepId: s.id,
        status: 'success',
        message: `${s.title} succeeded (${s.commandPreview})`,
        plainSha256: s.id === 'verify_edge' ? '3a7bd3e2360a3d29eea436fcfb7e44c7' : undefined,
        cacheBustedSha256: s.id === 'verify_edge' ? '3a7bd3e2360a3d29eea436fcfb7e44c7' : undefined
      });
    }
    return {
      ok: true,
      exitCode: 0,
      stdout: `Deploy pipeline (${plan.config.provider || 'firebase'}) succeeded: edge purged last and SHA-256 verified.`,
      stderr: ''
    };
  }

  async getSettings(): Promise<AppSettings> {
    if (this.isTauriRuntime()) {
      return invoke<AppSettings>(TAURI_COMMANDS.GET_SETTINGS);
    }
    return {
      preferredSsg: 'hugo',
      binaryOverrides: {},
      recentProjects: ['/Users/demo/Sites/citrus-hugo-docs'],
      llmEndpoint: 'http://localhost:11434/v1',
      llmModel: 'qwen2.5-coder:7b-instruct',
      editorFontSize: 13,
      editorWordWrap: true,
      proseSpellcheck: true,
      proseStyleCheck: true
    };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    if (this.isTauriRuntime()) {
      await invoke<void>(TAURI_COMMANDS.SAVE_SETTINGS, { settings });
    }
  }

  async getStartupProject(): Promise<string | null> {
    if (this.isTauriRuntime()) {
      return invoke<string | null>(TAURI_COMMANDS.GET_STARTUP_PROJECT);
    }
    return null;
  }

  async installCliLauncher(): Promise<string> {
    if (this.isTauriRuntime()) {
      return invoke<string>(TAURI_COMMANDS.INSTALL_CLI_LAUNCHER);
    }
    return 'Installed `orangegel` CLI launcher to ~/.local/bin/orangegel';
  }

  private seedDemoFiles(): void {
    this.mockDocs.set('content/posts/architecture-overview.md', {
      relPath: 'content/posts/architecture-overview.md',
      name: 'architecture-overview.md',
      lang: 'markdown',
      isDoc: true,
      format: 'toml',
      fields: {
        title: 'OrangeGel Architecture & Spatial UI',
        date: '2026-10-20',
        draft: false,
        slug: 'architecture-overview',
        tags: ['hugo', 'tauri', 'angular', 'threejs'],
        description: 'How OrangeGel unifies the Top 20 Jamstack SSGs with Hugo-first ergonomics.'
      },
      body: [
        '# Welcome to OrangeGel Studio',
        '',
        'OrangeGel is a native **Tauri v2** and **Angular Signals** static site studio supporting all **Top 20 Jamstack Generators** with **Hugo** as the flagship default.',
        '',
        '{{< mermaid >}}',
        'flowchart LR',
        '  Hugo["Hugo (Preferred Flagship)"] --> Sizer["WebKit Sizer Stage"]',
        '  Top20["Top 20 Jamstack SSGs"] --> Sizer',
        '  Sizer --> Edge["Firebase Hosting Edge Purge Last"]',
        '{{< /mermaid >}}',
        '',
        '## Prose & Style Verification Demo',
        '',
        'This paragraph is very basically written to demonstrate the the deterministic prose checker and Hunspell scanner while masking code fences and Hugo shortcodes.',
        '',
        '```mermaid',
        'sequenceDiagram',
        '  participant Author',
        '  participant Monaco',
        '  participant RustSupervisor',
        '  Author->>Monaco: Edit Markdown & Front Matter',
        '  Monaco->>RustSupervisor: invoke("save_document")',
        '  RustSupervisor-->>Author: Live reload on ephemeral port',
        '```',
        ''
      ].join('\n'),
      previewRoute: '/posts/architecture-overview/'
    });

    this.mockDocs.set('content/_index.md', {
      relPath: 'content/_index.md',
      name: '_index.md',
      lang: 'markdown',
      isDoc: true,
      format: 'toml',
      fields: {
        title: 'Citrus Gel Documentation Home',
        date: '2026-10-20',
        draft: false,
        slug: 'index',
        tags: ['home', 'hugo'],
        description: 'Root landing page for the Hugo documentation site.'
      },
      body: '# Citrus Gel Static Site\n\nSelect a post in the sidebar or switch between **Desktop**, **Tablet**, **Mobile**, **Compare**, and **3D Site Graph** modes in the preview studio.\n',
      previewRoute: '/'
    });

    this.mockDocs.set('hugo.toml', {
      relPath: 'hugo.toml',
      name: 'hugo.toml',
      lang: 'toml',
      isDoc: false,
      format: 'none',
      fields: {},
      body: [
        'baseURL = "https://orangegel-docs.web.app/"',
        'languageCode = "en-us"',
        'title = "OrangeGel Hugo Flagship Site"',
        'enableRobotsTXT = true',
        '',
        '[markup.goldmark.renderer]',
        '  unsafe = true',
        '',
        '[params]',
        '  themeColor = "#FF7A18"',
        '  citrusGlow = true'
      ].join('\n'),
      previewRoute: '/'
    });
  }

  private getDemoProjectSummary(rootPath: string, ssg: SsgId = 'hugo'): ProjectSummary {
    return {
      rootPath,
      name: rootPath.split('/').pop() || 'citrus-hugo-docs',
      activeSsg: ssg,
      detectedSsg: ssg,
      detectionReason: ssg === 'hugo' ? 'Detected hugo.toml + content/ (Hugo Preferred)' : `Explicit adapter override (${ssg})`,
      hasTailwind: true,
      contentTree: [
        {
          name: 'content',
          relPath: 'content',
          isDir: true,
          isContent: true,
          children: [
            {
              name: '_index.md',
              relPath: 'content/_index.md',
              isDir: false,
              isContent: true
            },
            {
              name: 'posts',
              relPath: 'content/posts',
              isDir: true,
              isContent: true,
              children: [
                {
                  name: 'architecture-overview.md',
                  relPath: 'content/posts/architecture-overview.md',
                  isDir: false,
                  isContent: true
                },
                {
                  name: 'jamstack-top-20.md',
                  relPath: 'content/posts/jamstack-top-20.md',
                  isDir: false,
                  isContent: true
                }
              ]
            }
          ]
        }
      ],
      codeTree: [
        {
          name: 'hugo.toml',
          relPath: 'hugo.toml',
          isDir: false,
          isContent: false
        },
        {
          name: 'layouts',
          relPath: 'layouts',
          isDir: true,
          isContent: false,
          children: [
            {
              name: '_default/baseof.html',
              relPath: 'layouts/_default/baseof.html',
              isDir: false,
              isContent: false
            },
            {
              name: 'shortcodes/mermaid.html',
              relPath: 'layouts/shortcodes/mermaid.html',
              isDir: false,
              isContent: false
            }
          ]
        }
      ]
    };
  }
}
