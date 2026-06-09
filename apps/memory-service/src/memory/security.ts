/**
 * Security scan for memory entry content.
 *
 * Memory entries are injected into the LLM system prompt at session start
 * (see `SnapshotRenderer`), so any content written into the store is a
 * potential indirect-prompt-injection vector. We scan every write before
 * persisting and reject anything that matches a known-bad pattern.
 *
 * The rule list is intentionally narrow and explicit — false positives are
 * tolerable (worst case: an honest memory entry is rejected and the agent
 * rephrases), but false negatives (allowing a payload through) are not.
 *
 * Two categories of rejection:
 *
 *  1. **Prompt-injection patterns** — phrases that try to override the
 *     system prompt or impersonate a higher-priority role. Listed inline.
 *
 *  2. **Invisible Unicode** — zero-width spaces, joiners, BOM, word joiners,
 *     etc. These are common in steganographic payloads and have no use in
 *     normal memory entries.
 */

export interface SecurityScanResult {
  safe: boolean;
  reason?: string;
  pattern?: string;
}

interface InjectionPattern {
  readonly pattern: RegExp;
  readonly reason: string;
}

const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions?/i, reason: "prompt-injection" },
  { pattern: /disregard\s+(all\s+)?prior/i, reason: "prompt-injection" },
  { pattern: /you\s+are\s+now\s+/i, reason: "prompt-injection" },
  { pattern: /system\s*:\s*you\s+are/i, reason: "prompt-injection" },
  { pattern: /forget\s+everything\s+(above|before)/i, reason: "prompt-injection" },
];

/**
 * Invisible / zero-width characters we reject outright. Includes:
 *   U+200B ZERO WIDTH SPACE
 *   U+200C ZERO WIDTH NON-JOINER
 *   U+200D ZERO WIDTH JOINER
 *   U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM
 *   U+2060 WORD JOINER
 */
const INVISIBLE_UNICODE = /[​‌‍﻿⁠]/;

export function securityScan(content: string): SecurityScanResult {
  if (INVISIBLE_UNICODE.test(content)) {
    return { safe: false, reason: "invisible-unicode" };
  }
  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      return { safe: false, reason, pattern: pattern.source };
    }
  }
  return { safe: true };
}
