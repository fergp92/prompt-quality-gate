/**
 * Integration tests for analyze-prompt.mjs
 *
 * Spawns the script as a child process with JSON on stdin,
 * simulating how the Claude Code hook system invokes it.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'analyze-prompt.mjs');

/**
 * Run analyze-prompt.mjs with the given input object piped via stdin.
 * Uses spawnSync to capture both stdout and stderr regardless of exit code.
 * Returns { stdout, stderr, exitCode }.
 */
function runAnalyzer(inputObj) {
  const input = JSON.stringify(inputObj);
  const result = spawnSync('node', [SCRIPT_PATH], {
    input,
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

describe('integration: analyze-prompt.mjs', () => {
  it('clean prompt passes silently', () => {
    const result = runAnalyzer({
      prompt:
        'fix the TypeError in src/auth.mjs:45 where validateToken throws on expired tokens. Run npm test -- auth to verify.',
      cwd: '/tmp',
      session_id: 'test-001',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('vague compound prompt blocks', () => {
    const result = runAnalyzer({
      prompt:
        "fix the bug it doesn't work and then make it better and also clean up the code and additionally add some tests",
      cwd: '/tmp',
      session_id: 'test-002',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"decision":"block"');
    expect(result.stderr).toContain('prompt-quality-gate');
  });

  it('skip: prefix passes without blocking', () => {
    const result = runAnalyzer({
      prompt: 'skip: fix the bug make it work and then do everything',
      cwd: '/tmp',
      session_id: 'test-003',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('hardcoded secret triggers block', () => {
    const result = runAnalyzer({
      prompt: "use this api_key: 'sk-abc123def456ghi789jkl012mno345pqr' for the integration",
      cwd: '/tmp',
      session_id: 'test-005',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"decision":"block"');
  });

  it('completes within 3 seconds', () => {
    const start = Date.now();
    runAnalyzer({
      prompt:
        'refactor the entire codebase to use new architecture patterns and restructure all modules to follow clean architecture',
      cwd: '/tmp',
      session_id: 'test-004',
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(3000);
  });
});
