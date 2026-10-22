export interface WordDiffToken {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

/**
 * Computes a deterministic word-level diff between `original` and `revised` prose
 * while preserving whitespace tokens for accurate side-by-side / inline rendering.
 */
export function computeWordDiff(original: string, revised: string): WordDiffToken[] {
  if (original === revised) {
    return original ? [{ type: 'equal', text: original }] : [];
  }

  const origTokens = tokenizeWordsAndSpace(original);
  const revTokens = tokenizeWordsAndSpace(revised);

  const n = origTokens.length;
  const m = revTokens.length;

  // LCS dynamic programming table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (origTokens[i] === revTokens[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const raw: WordDiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (origTokens[i] === revTokens[j]) {
      raw.push({ type: 'equal', text: origTokens[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'delete', text: origTokens[i] });
      i++;
    } else {
      raw.push({ type: 'insert', text: revTokens[j] });
      j++;
    }
  }
  while (i < n) {
    raw.push({ type: 'delete', text: origTokens[i++] });
  }
  while (j < m) {
    raw.push({ type: 'insert', text: revTokens[j++] });
  }

  // Merge adjacent tokens of the same type
  const merged: WordDiffToken[] = [];
  for (const token of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === token.type) {
      prev.text += token.text;
    } else {
      merged.push({ ...token });
    }
  }

  return merged;
}

function tokenizeWordsAndSpace(input: string): string[] {
  return input.match(/\S+|\s+/g) ?? [];
}
