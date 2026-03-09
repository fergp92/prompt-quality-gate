import { describe, it, expect } from 'vitest';
import {
  extractUserPrompts,
  deduplicatePatterns,
  mergePatterns,
  buildLearningPrompt,
} from '../scripts/learn-from-session.mjs';

// ── Helper: build a JSONL line ───────────────────────────────────────
function jsonl(role, content) {
  return JSON.stringify({ role, content });
}

function jsonlTyped(type, message) {
  return JSON.stringify({ type, message });
}

// ── extractUserPrompts ───────────────────────────────────────────────

describe('extractUserPrompts', () => {
  it('extracts only human/user prompts from JSONL lines', () => {
    const lines = [
      jsonl('human', 'First prompt'),
      jsonl('assistant', 'Response 1'),
      jsonl('human', 'Second prompt'),
      jsonl('assistant', 'Response 2'),
      jsonl('human', 'Third prompt'),
    ];

    const result = extractUserPrompts(lines);
    expect(result).toEqual(['First prompt', 'Second prompt', 'Third prompt']);
  });

  it('returns last 15 user prompts when given more than 15', () => {
    const lines = [];
    for (let i = 1; i <= 20; i++) {
      lines.push(jsonl('human', `Prompt number ${i}`));
      lines.push(jsonl('assistant', `Response ${i}`));
    }

    const result = extractUserPrompts(lines);
    expect(result).toHaveLength(15);
    // Should be prompts 6-20 (last 15)
    expect(result[0]).toBe('Prompt number 6');
    expect(result[14]).toBe('Prompt number 20');
  });

  it('truncates prompts to 400 chars max', () => {
    const longContent = 'A'.repeat(500);
    const lines = [jsonl('human', longContent)];

    const result = extractUserPrompts(lines);
    expect(result).toHaveLength(1);
    expect(result[0].length).toBe(400);
  });

  it('handles type field as alternative to role field', () => {
    const lines = [
      jsonlTyped('human', 'Typed prompt'),
      jsonlTyped('assistant', 'Typed response'),
    ];

    const result = extractUserPrompts(lines);
    expect(result).toEqual(['Typed prompt']);
  });

  it('handles message field as alternative to content field', () => {
    const lines = [
      JSON.stringify({ role: 'human', message: 'Via message field' }),
    ];

    const result = extractUserPrompts(lines);
    expect(result).toEqual(['Via message field']);
  });

  it('returns empty array when no user prompts exist', () => {
    const lines = [
      jsonl('assistant', 'Only assistant messages'),
      jsonl('system', 'System message'),
    ];

    const result = extractUserPrompts(lines);
    expect(result).toEqual([]);
  });

  it('skips malformed lines gracefully', () => {
    const lines = [
      'not valid json',
      jsonl('human', 'Valid prompt'),
      '{broken',
    ];

    const result = extractUserPrompts(lines);
    expect(result).toEqual(['Valid prompt']);
  });
});

// ── deduplicatePatterns ──────────────────────────────────────────────

describe('deduplicatePatterns', () => {
  it('removes incoming patterns whose name already exists (case-insensitive)', () => {
    const incoming = [{ name: { en: 'Vague auth' } }];
    const existing = [{ name: { en: 'vague auth' } }];

    const result = deduplicatePatterns(incoming, existing);
    expect(result).toEqual([]);
  });

  it('keeps incoming patterns with new names', () => {
    const incoming = [{ name: { en: 'New pattern' } }];
    const existing = [{ name: { en: 'Other' } }];

    const result = deduplicatePatterns(incoming, existing);
    expect(result).toEqual(incoming);
  });

  it('handles mixed case and whitespace trimming', () => {
    const incoming = [
      { name: { en: '  Existing Pattern  ' } },
      { name: { en: 'Brand New' } },
    ];
    const existing = [{ name: { en: 'existing pattern' } }];

    const result = deduplicatePatterns(incoming, existing);
    expect(result).toHaveLength(1);
    expect(result[0].name.en).toBe('Brand New');
  });

  it('returns all incoming when existing is empty', () => {
    const incoming = [
      { name: { en: 'Pattern A' } },
      { name: { en: 'Pattern B' } },
    ];

    const result = deduplicatePatterns(incoming, []);
    expect(result).toEqual(incoming);
  });
});

// ── mergePatterns ────────────────────────────────────────────────────

describe('mergePatterns', () => {
  it('appends incoming to existing', () => {
    const existing = [{ name: { en: 'A' }, learnedAt: '2026-01-01T00:00:00Z' }];
    const incoming = [{ name: { en: 'B' }, learnedAt: '2026-01-02T00:00:00Z' }];

    const result = mergePatterns(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].name.en).toBe('A');
    expect(result[1].name.en).toBe('B');
  });

  it('caps at 50 by removing oldest rare patterns first', () => {
    const existing = [];
    // 48 existing patterns: first 5 are rare (oldest), rest are common
    for (let i = 0; i < 48; i++) {
      existing.push({
        name: { en: `Pattern ${i}` },
        frequency: i < 5 ? 'rare' : 'common',
        learnedAt: new Date(2026, 0, i + 1).toISOString(),
      });
    }

    const incoming = [
      { name: { en: 'New 1' }, frequency: 'common', learnedAt: '2026-03-01T00:00:00Z' },
      { name: { en: 'New 2' }, frequency: 'common', learnedAt: '2026-03-02T00:00:00Z' },
      { name: { en: 'New 3' }, frequency: 'common', learnedAt: '2026-03-03T00:00:00Z' },
    ];

    const result = mergePatterns(existing, incoming);
    expect(result).toHaveLength(50);
    // The oldest rare pattern (Pattern 0) should be removed
    expect(result.find(p => p.name.en === 'Pattern 0')).toBeUndefined();
    // New patterns should be present
    expect(result.find(p => p.name.en === 'New 1')).toBeDefined();
    expect(result.find(p => p.name.en === 'New 2')).toBeDefined();
    expect(result.find(p => p.name.en === 'New 3')).toBeDefined();
  });

  it('removes oldest regardless when no rare patterns remain and still over 50', () => {
    const existing = [];
    // 49 existing patterns, all common
    for (let i = 0; i < 49; i++) {
      existing.push({
        name: { en: `Pattern ${i}` },
        frequency: 'common',
        learnedAt: new Date(2026, 0, i + 1).toISOString(),
      });
    }

    const incoming = [
      { name: { en: 'New 1' }, frequency: 'common', learnedAt: '2026-03-01T00:00:00Z' },
      { name: { en: 'New 2' }, frequency: 'common', learnedAt: '2026-03-02T00:00:00Z' },
    ];

    const result = mergePatterns(existing, incoming);
    expect(result).toHaveLength(50);
    // Pattern 0 (oldest) should be removed
    expect(result.find(p => p.name.en === 'Pattern 0')).toBeUndefined();
  });

  it('does not purge when total is at or below 50', () => {
    const existing = [];
    for (let i = 0; i < 10; i++) {
      existing.push({
        name: { en: `Pattern ${i}` },
        frequency: 'rare',
        learnedAt: new Date(2026, 0, i + 1).toISOString(),
      });
    }
    const incoming = [
      { name: { en: 'New' }, frequency: 'common', learnedAt: '2026-03-01T00:00:00Z' },
    ];

    const result = mergePatterns(existing, incoming);
    expect(result).toHaveLength(11);
  });
});

// ── buildLearningPrompt ──────────────────────────────────────────────

describe('buildLearningPrompt', () => {
  it('returns a string containing key phrases', () => {
    const prompts = ['fix the bug', 'update the code'];
    const rules = [
      { id: 'vague-task', name: { en: 'Vague Task' } },
    ];
    const existingPatterns = [
      { name: { en: 'No context' }, avoid: 'fix it' },
    ];

    const result = buildLearningPrompt(prompts, rules, existingPatterns);
    expect(typeof result).toBe('string');
    expect(result.toLowerCase()).toContain('identify max 2 new anti-patterns');
    expect(result).toContain('fix the bug');
    expect(result).toContain('update the code');
    expect(result).toContain('vague-task');
    expect(result).toContain('Vague Task');
    expect(result).toContain('No context');
  });

  it('handles empty existing patterns', () => {
    const prompts = ['test prompt'];
    const rules = [{ id: 'r1', name: { en: 'Rule 1' } }];

    const result = buildLearningPrompt(prompts, rules, []);
    expect(result).toContain('None yet.');
    expect(result.toLowerCase()).toContain('identify max 2 new anti-patterns');
  });

  it('numbers prompts sequentially', () => {
    const prompts = ['alpha', 'beta', 'gamma'];
    const rules = [];
    const result = buildLearningPrompt(prompts, rules, []);
    expect(result).toContain('1. alpha');
    expect(result).toContain('2. beta');
    expect(result).toContain('3. gamma');
  });

  it('includes JSON return format instructions', () => {
    const result = buildLearningPrompt(['p'], [], []);
    expect(result).toContain('Return ONLY valid JSON array');
  });
});
