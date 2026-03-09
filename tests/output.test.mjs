import { describe, it, expect } from 'vitest';
import { formatOutput } from '../scripts/analyze-prompt.mjs';

describe('formatOutput', () => {
  it('returns null when there are 0 issues', () => {
    const result = formatOutput([], 'en');
    expect(result).toBeNull();
  });

  it('returns warning type for 1 warning issue', () => {
    const issues = [
      {
        ruleId: 'R001',
        name: 'Vague prompt',
        suggestion: 'Be more specific about what to change.',
        severity: 'warning',
      },
    ];
    const result = formatOutput(issues, 'en');
    expect(result).not.toBeNull();
    expect(result.type).toBe('warning');
    expect(result.stderr).toContain('prompt-quality-gate');
    expect(result.stdout).toBeNull();
  });

  it('returns block type for 2+ warning issues', () => {
    const issues = [
      {
        ruleId: 'R001',
        name: 'Vague prompt',
        suggestion: 'Be more specific.',
        severity: 'warning',
      },
      {
        ruleId: 'R002',
        name: 'Missing context',
        suggestion: 'Add file paths.',
        severity: 'warning',
      },
    ];
    const result = formatOutput(issues, 'en');
    expect(result).not.toBeNull();
    expect(result.type).toBe('block');
    expect(result.stdout).toContain('"decision":"block"');
  });

  it('returns block type for a single issue with severity block', () => {
    const issues = [
      {
        ruleId: 'R010',
        name: 'Dangerous operation',
        suggestion: 'Specify the exact files to delete.',
        severity: 'block',
      },
    ];
    const result = formatOutput(issues, 'en');
    expect(result).not.toBeNull();
    expect(result.type).toBe('block');
  });

  it('formats stderr with issue name and suggestion for single warning', () => {
    const issues = [
      {
        ruleId: 'R001',
        name: 'Vague prompt',
        suggestion: 'Be more specific about what to change.',
        severity: 'warning',
      },
    ];
    const result = formatOutput(issues, 'en');
    expect(result.stderr).toContain('Vague prompt');
    expect(result.stderr).toContain('Be more specific about what to change.');
  });

  it('formats learned-source issues differently', () => {
    const issues = [
      {
        ruleId: 'learned-001',
        name: 'Vague refactor',
        avoid: 'refactorizá el módulo de auth',
        suggestion: 'Extract validateToken to middleware',
        severity: 'warning',
        source: 'learned',
      },
    ];
    const result = formatOutput(issues, 'en');
    expect(result.type).toBe('warning');
    expect(result.stderr).toContain('Learned pattern');
    expect(result.stderr).toContain('Vague refactor');
    expect(result.stderr).toContain('refactorizá el módulo de auth');
    expect(result.stderr).toContain('Extract validateToken to middleware');
  });

  it('includes bypass instruction in block stdout JSON', () => {
    const issues = [
      {
        ruleId: 'R001',
        name: 'Issue one',
        suggestion: 'Fix one.',
        severity: 'warning',
      },
      {
        ruleId: 'R002',
        name: 'Issue two',
        suggestion: 'Fix two.',
        severity: 'warning',
      },
    ];
    const result = formatOutput(issues, 'en');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.decision).toBe('block');
    expect(parsed.bypass).toContain('skip:');
  });

  it('includes issue count in block stderr header', () => {
    const issues = [
      {
        ruleId: 'R001',
        name: 'Issue one',
        suggestion: 'Fix one.',
        severity: 'warning',
      },
      {
        ruleId: 'R002',
        name: 'Issue two',
        suggestion: 'Fix two.',
        severity: 'warning',
      },
      {
        ruleId: 'R003',
        name: 'Issue three',
        suggestion: 'Fix three.',
        severity: 'warning',
      },
    ];
    const result = formatOutput(issues, 'en');
    expect(result.stderr).toContain('3 issues detected');
  });
});
