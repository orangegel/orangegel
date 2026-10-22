import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { maskNonProse, ProseService } from './prose.service';
import { computeWordDiff } from './diff.util';
import { extractMermaidDiagrams } from '../../features/inspector/mermaid-preview.component';
import { TOP_20_SSG_CATALOG } from '../bridge/tauri-api.service';

describe('maskNonProse (Offset-Preserving Masking Invariant)', () => {
  it('always preserves exact character length across Hugo shortcodes, Mermaid fences, code blocks, and URLs', () => {
    const sample = [
      '# Architecture Post',
      '',
      'Here is prose before a Hugo shortcode {{< figure src="/img/gel.png" caption="Citrus" >}} and after.',
      '',
      '{{< mermaid >}}',
      'flowchart LR',
      '  A["UnspelledIdentXyz"] --> B["AnotherNodeQwe"]',
      '{{< /mermaid >}}',
      '',
      'Inline `const unspelledVar = 42;` and a [link to docs](https://example.com/unspelled-path/xyz).',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  Alice->>Bob: Hello!',
      '```',
      '',
      '$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$',
      '',
      '<Callout type="warning">Prose inside component stays visible</Callout>'
    ].join('\n');

    const masked = maskNonProse(sample);

    // Crucial invariant: exact character length and newline alignment
    expect(masked.length).toBe(sample.length);

    // Verify non-prose tokens are blanked out
    expect(masked).not.toContain('UnspelledIdentXyz');
    expect(masked).not.toContain('unspelledVar');
    expect(masked).not.toContain('https://example.com');
    expect(masked).not.toContain('sequenceDiagram');
    expect(masked).not.toContain('{{< figure');
    expect(masked).not.toContain('<Callout');

    // Verify genuine prose remains at the exact same character offset
    const targetPhrase = 'Prose inside component stays visible';
    expect(masked.indexOf(targetPhrase)).toBe(sample.indexOf(targetPhrase));
  });

  it('detects weasel words, repeated words, and passive voice at exact character offsets', () => {
    const service = new ProseService();
    const doc = '```\nvery repeated repeated\n```\nThis is very clear and the the system was built fast.';
    const issues = service.checkProse(doc, { spellcheck: false, styleCheck: true });

    // None of the issues should come from inside the fenced code block (indices 0..29)
    for (const issue of issues) {
      expect(issue.offset).toBeGreaterThan(29);
      expect(doc.slice(issue.offset, issue.offset + issue.length)).toBe(issue.word);
    }

    expect(issues.some((i) => i.kind === 'weasel' && i.word === 'very')).toBe(true);
    expect(issues.some((i) => i.kind === 'repeated' && i.word === 'the the')).toBe(true);
    expect(issues.some((i) => i.kind === 'passive' && i.word === 'was built')).toBe(true);
  });
});

describe('computeWordDiff', () => {
  it('computes accurate equal, delete, and insert word spans', () => {
    const original = 'The post was very quickly written by the author.';
    const revised = 'The author wrote the post quickly.';
    const diff = computeWordDiff(original, revised);

    const reconstructedOriginal = diff
      .filter((t) => t.type !== 'insert')
      .map((t) => t.text)
      .join('');
    const reconstructedRevised = diff
      .filter((t) => t.type !== 'delete')
      .map((t) => t.text)
      .join('');

    expect(reconstructedOriginal).toBe(original);
    expect(reconstructedRevised).toBe(revised);
  });
});

describe('extractMermaidDiagrams & Top 20 SSG Catalog', () => {
  it('extracts both fenced ```mermaid blocks and Hugo {{< mermaid >}} shortcodes', () => {
    const md = [
      '{{< mermaid >}}',
      'flowchart LR',
      '  Hugo --> Edge',
      '{{< /mermaid >}}',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  A->>B: Ping',
      '```'
    ].join('\n');

    const extracted = extractMermaidDiagrams(md);
    expect(extracted.length).toBe(2);
    expect(extracted[0].sourceType).toBe('fence');
    expect(extracted[1].sourceType).toBe('hugo-shortcode');
  });

  it('lists all 20 Jamstack generators with Hugo first and marked as preferred', () => {
    expect(TOP_20_SSG_CATALOG.length).toBe(20);
    expect(TOP_20_SSG_CATALOG[0].id).toBe('hugo');
    expect(TOP_20_SSG_CATALOG[0].isPreferred).toBe(true);
  });
});
