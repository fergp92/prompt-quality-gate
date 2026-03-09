import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzePrompt, detectLanguage } from '../scripts/analyze-prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const badPrompts = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'bad-prompts.json'), 'utf-8'));
const goodPrompts = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'good-prompts.json'), 'utf-8'));

describe('detectLanguage', () => {
  it('detects English', () => {
    expect(detectLanguage('fix the bug in the auth module')).toBe('en');
  });
  it('detects Spanish', () => {
    expect(detectLanguage('arreglá el bug en el módulo de auth')).toBe('es');
  });
  it('defaults to English for mixed/short', () => {
    expect(detectLanguage('hello')).toBe('en');
  });
});

describe('analyzePrompt', () => {
  it('returns empty issues for good prompts', () => {
    const result = analyzePrompt('refactor src/auth.mjs extracting validateToken to middleware. Run npm test to verify.', []);
    expect(result.issues).toHaveLength(0);
  });
  it('returns empty for short prompts under 25 chars', () => {
    const result = analyzePrompt('fix bug', []);
    expect(result.issues).toHaveLength(0);
  });
  it('returns empty for skip: prefix', () => {
    const result = analyzePrompt('skip: fix the bug make it work', []);
    expect(result.issues).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });
});

describe('rule detection — bad prompts', () => {
  for (const fixture of badPrompts) {
    it(`detects [${fixture.expectedRuleIds.join(', ')}] in: "${fixture.prompt.slice(0, 60)}..."`, () => {
      const result = analyzePrompt(fixture.prompt, []);
      const ruleIds = result.issues.map(i => i.ruleId);
      for (const expected of fixture.expectedRuleIds) {
        expect(ruleIds).toContain(expected);
      }
    });
  }
});

describe('rule detection — good prompts', () => {
  for (const fixture of goodPrompts) {
    it(`passes clean: "${fixture.prompt.slice(0, 60)}..."`, () => {
      const result = analyzePrompt(fixture.prompt, []);
      expect(result.issues).toHaveLength(0);
    });
  }
});

describe('learned patterns', () => {
  const patterns = [
    {
      id: 'learned-001',
      name: { en: 'Vague refactor', es: 'Refactor vago' },
      avoid: 'refactorizá el módulo de autenticación',
      instead: 'refactorizá auth.mjs extrayendo validateToken a middleware',
      frequency: 'common'
    }
  ];

  it('matches learned pattern by avoid keywords', () => {
    const result = analyzePrompt('refactorizá el módulo de autenticación por favor', patterns);
    expect(result.issues.some(i => i.source === 'learned')).toBe(true);
  });

  it('does not match unrelated prompts', () => {
    const result = analyzePrompt('run the tests in src/auth.test.mjs and verify output', patterns);
    const learnedIssues = result.issues.filter(i => i.source === 'learned');
    expect(learnedIssues).toHaveLength(0);
  });
});
