/**
 * learn-from-session.mjs — Post-session learning hook.
 * Extracts user prompts from session transcript, invokes claude -p
 * to identify anti-patterns, and stores them in memory/patterns.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── extractUserPrompts ───────────────────────────────────────────────

/**
 * Filter JSONL lines for human/user prompts.
 * Takes the last 15 and truncates each to 400 chars.
 *
 * Supports two JSONL schemas:
 *  - { role: 'human', content: '...' }
 *  - { type: 'human', message: '...' }
 *
 * @param {string[]} lines - Array of JSONL strings (one JSON per line).
 * @returns {string[]} Last 15 user prompts, each <= 400 chars.
 */
export function extractUserPrompts(lines) {
  const prompts = [];

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip malformed lines
      continue;
    }

    const role = parsed.role || parsed.type;
    if (role !== 'human') continue;

    const text = parsed.content || parsed.message || '';
    if (!text) continue;

    prompts.push(text.slice(0, 400));
  }

  // Return last 15
  return prompts.slice(-15);
}

// ── deduplicatePatterns ──────────────────────────────────────────────

/**
 * Remove incoming patterns whose name.en (case-insensitive, trimmed)
 * already exists in the existing patterns array.
 *
 * @param {object[]} incoming - New patterns to evaluate.
 * @param {object[]} existing - Already-stored patterns.
 * @returns {object[]} Filtered incoming (only truly new patterns).
 */
export function deduplicatePatterns(incoming, existing) {
  const existingNames = new Set(
    existing.map(p => (p.name?.en || '').trim().toLowerCase())
  );

  return incoming.filter(p => {
    const name = (p.name?.en || '').trim().toLowerCase();
    return !existingNames.has(name);
  });
}

// ── mergePatterns ────────────────────────────────────────────────────

/**
 * Append incoming patterns to existing, capping total at 50.
 * Purge strategy when over 50:
 *  1. Remove oldest patterns with frequency === 'rare' first (by learnedAt).
 *  2. If still over 50, remove oldest patterns regardless of frequency.
 *
 * @param {object[]} existing - Current patterns array.
 * @param {object[]} incoming - New patterns to add.
 * @returns {object[]} Merged array, length <= 50.
 */
export function mergePatterns(existing, incoming) {
  const merged = [...existing, ...incoming];

  if (merged.length <= 50) {
    return merged;
  }

  // Phase 1: remove oldest rare patterns until at 50 or no rare left
  while (merged.length > 50) {
    // Find the oldest rare pattern
    let oldestRareIdx = -1;
    let oldestRareDate = null;

    for (let i = 0; i < merged.length; i++) {
      if (merged[i].frequency === 'rare') {
        const date = merged[i].learnedAt || '';
        if (oldestRareIdx === -1 || date < oldestRareDate) {
          oldestRareIdx = i;
          oldestRareDate = date;
        }
      }
    }

    if (oldestRareIdx !== -1) {
      merged.splice(oldestRareIdx, 1);
    } else {
      break; // No more rare patterns to remove
    }
  }

  // Phase 2: remove oldest patterns regardless of frequency
  while (merged.length > 50) {
    let oldestIdx = 0;
    let oldestDate = merged[0].learnedAt || '';

    for (let i = 1; i < merged.length; i++) {
      const date = merged[i].learnedAt || '';
      if (date < oldestDate) {
        oldestIdx = i;
        oldestDate = date;
      }
    }

    merged.splice(oldestIdx, 1);
  }

  return merged;
}

// ── buildLearningPrompt ──────────────────────────────────────────────

/**
 * Build a multi-part prompt string for `claude -p` to identify
 * new anti-patterns from session prompts.
 *
 * @param {string[]} prompts - Extracted user prompts from the session.
 * @param {object[]} rules - Current rules from default-rules.json.
 * @param {object[]} existingPatterns - Already-learned patterns.
 * @returns {string} Complete prompt string.
 */
export function buildLearningPrompt(prompts, rules, existingPatterns) {
  const promptList = prompts.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const ruleList = rules.map(r => `- ${r.id}: ${r.name.en}`).join('\n');

  const patternList = existingPatterns.length
    ? existingPatterns.map(p => `- ${p.name.en}: avoid "${p.avoid}"`).join('\n')
    : 'None yet.';

  return `You are analyzing a Claude Code session for prompt quality anti-patterns.

## User prompts from this session
${promptList}

## Current rules (already covered)
${ruleList}

## Existing learned patterns
${patternList}

## Instructions
Identify max 2 new anti-patterns from these prompts that are NOT already covered by current rules or existing patterns.
Return ONLY valid JSON array:
[{"name":{"en":"...","es":"..."},"avoid":"exact bad phrasing","instead":"improved version","frequency":"common"}]
If no new patterns found, return: []`;
}

// ── main (CLI entry point, not exported) ─────────────────────────────

/**
 * Auto-runs when executed directly.
 * Reads stdin JSON with { transcript_path, session_id },
 * extracts prompts, invokes claude -p for analysis,
 * and updates memory/patterns.json.
 */
async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Malformed input — exit silently
    return;
  }

  const transcriptPath = input.transcript_path;
  if (!transcriptPath) return;

  // Read transcript (JSONL — one JSON object per line)
  let transcriptRaw;
  try {
    transcriptRaw = readFileSync(transcriptPath, 'utf-8');
  } catch {
    process.stderr.write(`\u26a0 prompt-quality-gate: could not read transcript at ${transcriptPath}\n`);
    return;
  }

  const lines = transcriptRaw.split('\n').filter(l => l.trim());

  // Extract user prompts
  const prompts = extractUserPrompts(lines);

  // If fewer than 3 prompts, not enough data to learn from
  if (prompts.length < 3) return;

  // Load rules
  let rules;
  try {
    const rulesPath = join(__dirname, '..', 'rules', 'default-rules.json');
    const rulesData = JSON.parse(readFileSync(rulesPath, 'utf-8'));
    rules = rulesData.rules;
  } catch {
    process.stderr.write('\u26a0 prompt-quality-gate: could not load rules.\n');
    return;
  }

  // Load existing patterns
  const patternsPath = join(__dirname, '..', 'memory', 'patterns.json');
  let existingPatterns = [];
  try {
    const patternsData = JSON.parse(readFileSync(patternsPath, 'utf-8'));
    existingPatterns = patternsData.patterns || [];
  } catch {
    // No patterns file yet — start fresh
  }

  // Build the learning prompt
  let fullPrompt = buildLearningPrompt(prompts, rules, existingPatterns);

  // Append best-practices reference if available
  try {
    const bpPath = join(__dirname, '..', 'references', 'best-practices.md');
    const bpContent = readFileSync(bpPath, 'utf-8');
    fullPrompt += `\n\n## Reference: Best Practices\n${bpContent}`;
  } catch {
    // best-practices.md not found — continue without it
  }

  // Invoke claude -p
  let claudeOutput;
  try {
    claudeOutput = execFileSync('claude', ['-p', fullPrompt], {
      timeout: 25000,
      encoding: 'utf-8',
    });
  } catch (err) {
    process.stderr.write(`\u26a0 prompt-quality-gate: claude CLI not available or timed out. Skipping learning.\n`);
    return;
  }

  // Parse output as JSON array
  let newPatterns;
  try {
    newPatterns = JSON.parse(claudeOutput.trim());
  } catch {
    // Try extracting JSON from markdown code blocks
    const codeBlockMatch = claudeOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        newPatterns = JSON.parse(codeBlockMatch[1].trim());
      } catch {
        process.stderr.write('\u26a0 prompt-quality-gate: could not parse claude output as JSON.\n');
        return;
      }
    } else {
      process.stderr.write('\u26a0 prompt-quality-gate: could not parse claude output as JSON.\n');
      return;
    }
  }

  if (!Array.isArray(newPatterns) || newPatterns.length === 0) return;

  // Add metadata to each new pattern
  const now = new Date().toISOString();
  for (let idx = 0; idx < newPatterns.length; idx++) {
    newPatterns[idx].id = 'learned-' + (existingPatterns.length + idx + 1).toString().padStart(3, '0');
    newPatterns[idx].source = 'session';
    newPatterns[idx].learnedAt = now;
  }

  // Deduplicate against existing
  const deduped = deduplicatePatterns(newPatterns, existingPatterns);
  if (deduped.length === 0) return;

  // Merge and cap at 50
  const merged = mergePatterns(existingPatterns, deduped);

  // Write back
  writeFileSync(patternsPath, JSON.stringify({ version: 1, patterns: merged }, null, 2), 'utf-8');

  process.stderr.write(`\u2139 prompt-quality-gate: learned ${deduped.length} new pattern(s) from session.\n`);
}

// Auto-run when executed directly
if (process.argv[1] && process.argv[1].endsWith('learn-from-session.mjs')) {
  main();
}
