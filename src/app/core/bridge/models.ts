export type SsgId =
  | 'hugo'
  | 'nextjs'
  | 'docusaurus'
  | 'nuxt'
  | 'gatsby'
  | 'astro'
  | 'jekyll'
  | 'hexo'
  | 'vuepress'
  | 'eleventy'
  | 'vitepress'
  | 'mkdocs'
  | 'zola'
  | 'pelican'
  | 'sveltekit'
  | 'remix'
  | 'middleman'
  | 'metalsmith'
  | 'gridsome'
  | 'bridgetown';

export interface SsgDescriptor {
  id: SsgId;
  displayName: string;
  ecosystem: string;
  isPreferred: boolean;
  configMarkers: string[];
  devCommandPreview: string;
  buildCommandPreview: string;
  defaultOutputDir: string;
  contentDirs: string[];
}

export interface FileTreeNode {
  name: string;
  relPath: string;
  isDir: boolean;
  isContent: boolean;
  children?: FileTreeNode[];
}

export interface ProjectSummary {
  rootPath: string;
  name: string;
  activeSsg: SsgId;
  detectedSsg: SsgId;
  detectionReason: string;
  hasTailwind: boolean;
  contentTree: FileTreeNode[];
  codeTree: FileTreeNode[];
}

export interface DocumentPayload {
  relPath: string;
  name: string;
  lang: string;
  isDoc: boolean;
  format: 'yaml' | 'toml' | 'json' | 'none';
  fields: Record<string, unknown>;
  body: string;
  previewRoute: string;
}

export interface EditorTab {
  path: string;
  name: string;
  lang: string;
  isDoc: boolean;
  format: 'yaml' | 'toml' | 'json' | 'none';
  fields: Record<string, unknown>;
  body: string;
  savedFieldsJson: string;
  savedBody: string;
  previewRoute: string;
}

export type ServerStateKind = 'stopped' | 'starting' | 'running' | 'deploying' | 'died';

export interface ServerStatusPayload {
  state: ServerStateKind;
  port?: number;
  url?: string;
  ssg?: SsgId;
  error?: string;
}

export interface LogLine {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface CommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export type SiteNodeStatus = 'published' | 'draft' | 'section' | 'taxonomy' | 'broken-link';

export interface SiteGraphNode {
  id: string;
  label: string;
  relPath: string;
  route: string;
  status: SiteNodeStatus;
  wordCount: number;
}

export interface SiteGraphEdge {
  source: string;
  target: string;
  broken?: boolean;
}

export interface SiteGraphPayload {
  nodes: SiteGraphNode[];
  edges: SiteGraphEdge[];
}

export type ProseIssueKind = 'spelling' | 'passive' | 'weasel' | 'repeated' | 'cliche';

export interface ProseIssue {
  id: string;
  kind: ProseIssueKind;
  message: string;
  word: string;
  offset: number;
  length: number;
  suggestions: string[];
}

export type AiRevisionMode = 'proofread' | 'tighten' | 'clarity';

export interface AiRevisionResult {
  mode: AiRevisionMode;
  originalText: string;
  revisedText: string;
  model: string;
  truncatedTailPreserved: boolean;
}

export interface GitFileEntry {
  path: string;
  status: 'M' | 'A' | 'D' | '??' | 'R';
  staged: boolean;
}

export interface GitStatusPayload {
  branch: string;
  ahead: number;
  behind: number;
  remoteName: string;
  remoteUrl: string;
  files: GitFileEntry[];
}

export type DeployTarget =
  | 'firebase'
  | 'githubpages'
  | 'gitlabpages'
  | 'cloudflare'
  | 'netlify'
  | 'vercel'
  | 's3cloudfront';

export interface DeployConfig {
  provider?: DeployTarget;
  firebaseSite: string;
  gcpProject: string;
  enableCloudRun?: boolean;
  cloudRunService?: string;
  cloudRunRegion?: string;
  artifactRepo?: string;
  appLabel: string;
  envLabel: string;
  liveUrl?: string;
  verifyUrl?: string;
  githubRepo?: string;
  githubBranch?: string;
  useBlacksmithCi?: boolean;
  gitlabProject?: string;
  gitlabBranch?: string;
  cloudflareProject?: string;
  cloudflareBranch?: string;
  netlifySiteId?: string;
  vercelProject?: string;
  s3Bucket?: string;
  cloudfrontDistributionId?: string;
}

export interface DeployStepPlan {
  index?: number;
  step: number;
  id: string;
  title: string;
  commandPreview: string;
  required?: boolean;
}

export interface DeployPlanPayload {
  ssg: SsgId;
  config: DeployConfig;
  steps: DeployStepPlan[];
  mermaidDiagram?: string;
}

export interface DeployEventPayload {
  stepId: string;
  status: 'pending' | 'running' | 'success' | 'skipped' | 'error';
  message: string;
  timestamp?: string;
  digest?: string;
  plainSha256?: string;
  cacheBustedSha256?: string;
}

export interface AppSettings {
  preferredSsg: SsgId;
  binaryOverrides: Partial<Record<SsgId, string>>;
  recentProjects: string[];
  llmEndpoint: string;
  llmModel: string;
  editorFontSize: number;
  editorWordWrap: boolean;
  proseSpellcheck: boolean;
  proseStyleCheck: boolean;
}

export type ViewportMode = 'desktop' | 'tablet' | 'mobile' | 'compare' | 'graph3d';
export type ViewportOrientation = 'portrait' | 'landscape';
export type ViewportZoom = 'autofit' | 0.5 | 0.75 | 1;

export interface ViewportPreset {
  id: string;
  category: 'desktop' | 'tablet' | 'mobile';
  name: string;
  width: number; // 0 means fluid 100%
  height: number;
  rotatable: boolean;
}
