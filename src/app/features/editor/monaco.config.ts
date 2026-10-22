/**
 * Configures custom TOML & Mermaid Monarch grammars and rich authoring completion providers
 * for Hugo Go-templates/shortcodes, Tailwind CSS utilities, Lucide icons, Mermaid diagrams,
 * Three.js / Anime.js snippets, and HTMX attributes.
 */
let monacoConfigured = false;

export function registerOrangeGelMonacoExtensions(monaco: any): void {
  if (monacoConfigured || !monaco) return;
  monacoConfigured = true;

  // 1. Register TOML language with date-before-number rule so 2026-10-20 isn't parsed as subtraction
  monaco.languages.register({ id: 'toml', extensions: ['.toml'], aliases: ['TOML', 'toml'] });
  monaco.languages.setMonarchTokensProvider('toml', {
    tokenizer: {
      root: [
        [/^\s*\[+[^\]]+\]+/, 'type.identifier'],
        [/#.*$/, 'comment'],
        [/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/, 'number.date'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\b(true|false)\b/, 'keyword'],
        [/[+-]?\d+(\.\d+)?/, 'number'],
        [/[A-Za-z0-9_-]+(?=\s*=)/, 'variable']
      ]
    }
  });

  // 2. Register Mermaid language grammar
  monaco.languages.register({ id: 'mermaid', aliases: ['Mermaid', 'mermaid'] });
  monaco.languages.setMonarchTokensProvider('mermaid', {
    tokenizer: {
      root: [
        [/%%.*$/, 'comment'],
        [/\b(flowchart|graph|sequenceDiagram|stateDiagram-v2|classDiagram|erDiagram|xychart-beta|subgraph|end|direction|participant|TB|LR|TD|RL)\b/, 'keyword'],
        [/-->|-\.-|==>|-->>|->>/, 'operator'],
        [/"[^"]*"/, 'string']
      ]
    }
  });

  // 3. Register Hugo Shortcodes, Mermaid, Tailwind, Lucide, Three.js, Anime.js & HTMX completions
  const targetLanguages = ['markdown', 'html', 'toml', 'yaml', 'typescript', 'javascript'];
  for (const lang of targetLanguages) {
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions = [
          // Hugo Shortcodes & Go Templates
          {
            label: 'hugo-mermaid-shortcode',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: '{{< mermaid >}}\nflowchart LR\n  A["${1:Source}"] --> B["${2:Target}"]\n{{< /mermaid >}}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Hugo Mermaid diagram shortcode',
            range
          },
          {
            label: 'hugo-figure-shortcode',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: '{{< figure src="${1:/images/diagram.png}" title="${2:Caption}" >}}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Hugo figure shortcode',
            range
          },
          {
            label: 'hugo-icon-lucide',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: '{{< icon "${1|sparkles,flame,monitor,tablet,smartphone,rocket,orbit|}" >}}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Hugo Lucide icon shortcode',
            range
          },
          {
            label: 'hugo-range-pages',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: '{{ range where .Site.RegularPages "Section" "${1:posts}" }}\n  <h2><a href="{{ .RelPermalink }}">{{ .Title }}</a></h2>\n{{ end }}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Hugo Go-template range over section pages',
            range
          },
          // Mermaid Fenced Diagrams
          {
            label: 'mermaid-flowchart',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: '```mermaid\nflowchart TB\n  Start["${1:Author}"] --> Build["${2:Hugo Build}"]\n  Build --> Edge["${3:Firebase Hosting}"]\n```',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Mermaid Flowchart fenced block',
            range
          },
          // Three.js & Anime.js Authoring Snippets
          {
            label: 'threejs-webgl-island',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'const scene = new THREE.Scene();\nconst camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);\nconst renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Three.js responsive WebGL scene snippet',
            range
          },
          {
            label: 'animejs-spring-morph',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'anime({\n  targets: "${1:.card}",\n  scale: [0.95, 1],\n  easing: "spring(1, 80, 12, 0)"\n});',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Anime.js spring physics snippet',
            range
          },
          // Tailwind CSS & HTMX
          {
            label: 'tw-glass-panel',
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: 'relative flex-1 min-h-0 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl',
            documentation: 'WebKit-safe Tailwind CSS citrus glass panel classes',
            range
          },
          {
            label: 'hx-get-swap',
            kind: monaco.languages.CompletionItemKind.Property,
            insertText: 'hx-get="${1:/api/fragment}" hx-target="${2:#result}" hx-swap="innerHTML"',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'HTMX declarative fetch & swap attributes',
            range
          }
        ];

        return { suggestions };
      }
    });
  }
}
