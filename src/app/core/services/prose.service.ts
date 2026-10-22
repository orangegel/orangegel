import { Injectable } from '@angular/core';
import { ProseIssue } from '../bridge/models';

/**
 * Replaces all non-prose regions with equal-length spaces (preserving newlines where appropriate
 * or masking with spaces of identical length) so `maskNonProse(text).length === text.length` ALWAYS holds.
 *
 * Regions masked:
 * - Fenced code blocks (``` ... ```, ~~~ ... ~~~, including ```mermaid)
 * - Hugo paired mermaid shortcodes ({{< mermaid >}}...{{< /mermaid >}}, {{% mermaid %}}...{{% /mermaid %}})
 * - Hugo shortcodes ({{< ... >}}, {{% ... %}}) and Go template actions ({{ ... }})
 * - Liquid / Jinja / Nunjucks tags ({% ... %}, {# ... #})
 * - Inline code spans (`...`)
 * - Display math ($$...$$) and inline math ($...$)
 * - MDX / JSX / HTML tags (<...>) and HTML comments (<!--...-->)
 * - Markdown link/image targets ([label](url) -> masks (url) only, keeping label prose!)
 * - Raw URLs (https?://[^\s)]+) and email addresses
 */
export function maskNonProse(text: string): string {
  const chars = text.split('');

  const maskRange = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') {
        chars[i] = ' ';
      }
    }
  };

  const applyRegexMask = (regex: RegExp) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      maskRange(match.index, match.index + match[0].length);
    }
  };

  // 1. Fenced code blocks (```...``` or ~~~...~~~) including ```mermaid
  applyRegexMask(/(?:```|~~~)[\s\S]*?(?:```|~~~|$)/g);

  // 2. Hugo paired mermaid shortcodes: {{< mermaid >}}...{{< /mermaid >}}
  applyRegexMask(/\{\{[<%]\s*mermaid\b[\s\S]*?\{\{[<%]\s*\/mermaid\s*[>%]\}\}/gi);

  // 3. Hugo shortcodes & Go templates: {{< ... >}}, {{% ... %}}, {{ ... }}
  applyRegexMask(/\{\{[\s\S]*?\}\}/g);

  // 4. Liquid / Jinja2 / Nunjucks tags: {% ... %}, {# ... #}
  applyRegexMask(/\{[%#][\s\S]*?[%#]\}/g);

  // 5. HTML comments: <!-- ... -->
  applyRegexMask(/<!--[\s\S]*?-->/g);

  // 6. Display math $$...$$ and inline math $...$
  applyRegexMask(/\$\$[\s\S]*?\$\$/g);
  applyRegexMask(/\$(?!\s)[^$\n]+?(?<!\s)\$/g);

  // 7. Inline code (`...`)
  applyRegexMask(/`+[^`\n]*`+/g);

  // 8. JSX / MDX / HTML tags (<Tag ...> or </Tag>)
  applyRegexMask(/<\/?[A-Za-z!][^>\n]*>/g);

  // 9. Markdown link targets: mask the `(url "title")` part of `[text](url)` and the `[` `]` brackets
  const mdLinkRegex = /(!?\[)([^\]\n]*)(\]\([^\)\n]*\))/g;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = mdLinkRegex.exec(text)) !== null) {
    const prefixLen = linkMatch[1].length;
    const labelLen = linkMatch[2].length;
    const suffixLen = linkMatch[3].length;
    maskRange(linkMatch.index, linkMatch.index + prefixLen);
    maskRange(
      linkMatch.index + prefixLen + labelLen,
      linkMatch.index + prefixLen + labelLen + suffixLen
    );
  }

  // 10. Raw URLs & emails
  applyRegexMask(/\bhttps?:\/\/[^\s)>\]]+/gi);
  applyRegexMask(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);

  // 11. HTML entities (&nbsp;, &#123;)
  applyRegexMask(/&[a-zA-Z0-9#]+;/g);

  return chars.join('');
}

const WEASEL_WORDS = [
  'very',
  'basically',
  'actually',
  'obviously',
  'clearly',
  'literally',
  'simply',
  'just',
  'quite',
  'extremely',
  'virtually',
  'practically'
];

const IRREGULAR_PARTICIPLES = [
  'been',
  'born',
  'beaten',
  'become',
  'begun',
  'bent',
  'bitten',
  'blown',
  'broken',
  'brought',
  'built',
  'bought',
  'caught',
  'chosen',
  'come',
  'cost',
  'cut',
  'dealt',
  'done',
  'drawn',
  'driven',
  'drunk',
  'eaten',
  'fallen',
  'fed',
  'felt',
  'fought',
  'found',
  'flown',
  'forgotten',
  'forgiven',
  'frozen',
  'gotten',
  'given',
  'gone',
  'grown',
  'hung',
  'heard',
  'hidden',
  'hit',
  'held',
  'hurt',
  'kept',
  'known',
  'laid',
  'led',
  'left',
  'lent',
  'let',
  'lain',
  'lost',
  'made',
  'meant',
  'met',
  'paid',
  'put',
  'read',
  'ridden',
  'rung',
  'risen',
  'run',
  'said',
  'seen',
  'sold',
  'sent',
  'set',
  'shaken',
  'shown',
  'shut',
  'sung',
  'sunk',
  'sat',
  'slept',
  'spoken',
  'spent',
  'split',
  'spread',
  'stood',
  'stolen',
  'stuck',
  'struck',
  'sworn',
  'swept',
  'swum',
  'taken',
  'taught',
  'torn',
  'told',
  'thought',
  'thrown',
  'understood',
  'woken',
  'worn',
  'won',
  'written'
];

@Injectable({ providedIn: 'root' })
export class ProseService {
  private spellChecker: any = null;
  private loadingPromise: Promise<void> | null = null;
  private customWords = new Set<string>();

  async ensureDictionaryLoaded(projectWords: string[] = []): Promise<void> {
    projectWords.forEach((w) => this.customWords.add(w.toLowerCase()));
    if (this.spellChecker) {
      projectWords.forEach((w) => this.spellChecker.add(w));
      return;
    }
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      try {
        const [affResp, dicResp, nspellMod] = await Promise.all([
          fetch('/assets/dictionary/en.aff'),
          fetch('/assets/dictionary/en.dic'),
          import('nspell')
        ]);
        if (affResp.ok && dicResp.ok) {
          const [aff, dic] = await Promise.all([affResp.text(), dicResp.text()]);
          const nspellFactory: any = (nspellMod as any).default ?? nspellMod;
          this.spellChecker = nspellFactory(aff, dic);
          for (const word of this.customWords) {
            this.spellChecker.add(word);
          }
        }
      } catch {
        // Fallback if fetch is unavailable in pure node unit test environment
        this.spellChecker = null;
      }
    })();

    return this.loadingPromise;
  }

  addWord(word: string): void {
    this.customWords.add(word.toLowerCase());
    if (this.spellChecker) {
      this.spellChecker.add(word);
    }
  }

  checkProse(
    text: string,
    options: { spellcheck: boolean; styleCheck: boolean } = { spellcheck: true, styleCheck: true }
  ): ProseIssue[] {
    const masked = maskNonProse(text);
    const issues: ProseIssue[] = [];

    if (options.styleCheck) {
      // 1. Weasel words
      const weaselPattern = new RegExp(`\\b(${WEASEL_WORDS.join('|')})\\b`, 'gi');
      let match: RegExpExecArray | null;
      while ((match = weaselPattern.exec(masked)) !== null) {
        issues.push({
          id: `weasel-${match.index}`,
          kind: 'weasel',
          word: match[0],
          offset: match.index,
          length: match[0].length,
          message: `"${match[0]}" weakens prose clarity; consider omitting it.`,
          suggestions: []
        });
      }

      // 2. Repeated adjacent words ("the the")
      const repeatedPattern = /\b([A-Za-z]{2,})\s+\1\b/gi;
      while ((match = repeatedPattern.exec(masked)) !== null) {
        issues.push({
          id: `repeated-${match.index}`,
          kind: 'repeated',
          word: match[0],
          offset: match.index,
          length: match[0].length,
          message: `Repeated word "${match[1]}".`,
          suggestions: [match[1]]
        });
      }

      // 3. Passive voice ("was written", "is rendered", etc.)
      const passivePattern = new RegExp(
        `\\b(am|are|were|being|is|been|was|be)\\s+([a-z]+ed|${IRREGULAR_PARTICIPLES.join('|')})\\b`,
        'gi'
      );
      while ((match = passivePattern.exec(masked)) !== null) {
        issues.push({
          id: `passive-${match.index}`,
          kind: 'passive',
          word: match[0],
          offset: match.index,
          length: match[0].length,
          message: `Passive voice construction "${match[0]}"; prefer active voice.`,
          suggestions: []
        });
      }
    }

    if (options.spellcheck && this.spellChecker) {
      const wordRegex = /\b[A-Za-z][A-Za-z']*[A-Za-z]\b/g;
      let wordMatch: RegExpExecArray | null;
      while ((wordMatch = wordRegex.exec(masked)) !== null) {
        const word = wordMatch[0];
        if (word.length <= 2) continue;
        // Skip ALL-CAPS acronyms or camelCase identifiers
        if (/^[A-Z0-9]+$/.test(word) || /[a-z][A-Z]/.test(word)) continue;
        if (this.customWords.has(word.toLowerCase())) continue;

        const isCorrect =
          this.spellChecker.correct(word) || this.spellChecker.correct(word.toLowerCase());
        if (!isCorrect) {
          const suggestions: string[] = this.spellChecker.suggest(word).slice(0, 4);
          issues.push({
            id: `spell-${wordMatch.index}`,
            kind: 'spelling',
            word,
            offset: wordMatch.index,
            length: word.length,
            message: `Unknown spelling "${word}".`,
            suggestions
          });
        }
      }
    }

    return issues.sort((a, b) => a.offset - b.offset);
  }
}
