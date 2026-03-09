/**
 * analyze-prompt.mjs — Core rules engine for prompt quality analysis.
 *
 * Pure functions exportable for testing — no side effects in exports.
 * Reads rules from ../rules/default-rules.json and evaluates prompts
 * against pattern-based rules with language-aware detection.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Stopword lists for language detection ──────────────────────────

const STOPWORDS_EN = ['the', 'is', 'of', 'to', 'in', 'a', 'for', 'with', 'on', 'at'];
const STOPWORDS_ES = ['el', 'la', 'los', 'de', 'que', 'en', 'un', 'es', 'por', 'con'];

// ── Language detection ─────────────────────────────────────────────

/**
 * Detect prompt language via stopword frequency analysis.
 * Counts English vs Spanish stopword matches; majority wins.
 * Defaults to 'en' on ties or when no stopwords are found.
 *
 * @param {string} prompt
 * @returns {'en' | 'es'}
 */
export function detectLanguage(prompt) {
  const words = prompt.toLowerCase().split(/\s+/);

  let enCount = 0;
  let esCount = 0;

  for (const word of words) {
    if (STOPWORDS_EN.includes(word)) enCount++;
    if (STOPWORDS_ES.includes(word)) esCount++;
  }

  return esCount > enCount ? 'es' : 'en';
}

// ── Rules loading ──────────────────────────────────────────────────

/**
 * Load rules from ../rules/default-rules.json relative to this script.
 * @returns {object[]} Array of rule objects.
 */
function loadRules() {
  const rulesPath = join(__dirname, '..', 'rules', 'default-rules.json');
  const raw = readFileSync(rulesPath, 'utf-8');
  const data = JSON.parse(raw);
  return data.rules;
}

/**
 * Load learned patterns from ../memory/patterns.json relative to this script.
 * @returns {object[]} Array of pattern objects.
 */
function loadPatterns() {
  const patternsPath = join(__dirname, '..', 'memory', 'patterns.json');
  const raw = readFileSync(patternsPath, 'utf-8');
  const data = JSON.parse(raw);
  return data.patterns || [];
}

// ── Rule evaluation ────────────────────────────────────────────────

/**
 * Evaluate a single rule against a prompt.
 *
 * Steps:
 *  1. Guard check: skip if prompt length is outside [minLength, maxLength].
 *  2. Pattern matching: check patterns_${lang} for substring includes.
 *  3. Regex matching: test each regex in rule.regex against prompt.
 *  4. min_matches: if set, require >= min_matches pattern hits.
 *  5. Negation: if negation_${lang} terms are found, the prompt is specific
 *     enough -- skip (no issue).
 *  6. Return issue object or null.
 *
 * @param {string} prompt
 * @param {object} rule
 * @param {'en' | 'es'} lang
 * @returns {object | null} Issue object or null if no match.
 */
function evaluateRule(prompt, rule, lang) {
  const promptLower = prompt.toLowerCase();
  const guard = rule.guard || {};

  // Step 1 — Guard: minLength
  if (guard.minLength != null && prompt.length < guard.minLength) {
    return null;
  }
  // Step 1 — Guard: maxLength
  if (guard.maxLength != null && prompt.length > guard.maxLength) {
    return null;
  }

  // Step 2 — Pattern matching
  const patterns = rule[`patterns_${lang}`] || [];
  let patternMatchCount = 0;

  for (const pattern of patterns) {
    if (promptLower.includes(pattern.toLowerCase())) {
      patternMatchCount++;
    }
  }

  // Step 3 — Regex matching
  let regexMatched = false;
  if (Array.isArray(rule.regex)) {
    for (const re of rule.regex) {
      if (new RegExp(re, 'i').test(prompt)) {
        regexMatched = true;
        break;
      }
    }
  }

  // Determine if the rule triggered at all
  const hasPatterns = patterns.length > 0;
  const hasRegex = Array.isArray(rule.regex) && rule.regex.length > 0;

  // Step 4 — min_matches threshold
  if (rule.min_matches != null) {
    if (patternMatchCount < rule.min_matches) {
      return null;
    }
  } else {
    // Without min_matches, at least one pattern OR regex must match
    if (hasPatterns && patternMatchCount === 0 && !regexMatched) {
      return null;
    }
    if (!hasPatterns && hasRegex && !regexMatched) {
      return null;
    }
    if (!hasPatterns && !hasRegex) {
      return null;
    }
  }

  // Step 5 — Negation: if any negation term found, prompt is good enough
  const negations = rule[`negation_${lang}`] || [];
  for (const neg of negations) {
    if (promptLower.includes(neg.toLowerCase())) {
      return null;
    }
  }

  // Step 6 — Build and return issue
  const name = rule.name ? rule.name[lang] || rule.name.en : rule.id;
  const suggestion = rule.suggestion ? rule.suggestion[lang] || rule.suggestion.en : '';

  return {
    ruleId: rule.id,
    name,
    suggestion,
    severity: rule.severity || 'warning',
  };
}

// ── Learned pattern evaluation ───────────────────────────────────

/**
 * Evaluate learned patterns against a prompt.
 *
 * Tokenizes the pattern's `avoid` field, filters to words > 3 chars,
 * then checks how many appear in the prompt. If >= 60% match, emit
 * a learned-source issue.
 *
 * @param {string} prompt
 * @param {object[]} patterns - Array of learned pattern objects.
 * @returns {object[]} Array of issue objects with source: 'learned'.
 */
export function evaluatePatterns(prompt, patterns) {
  const issues = [];
  const promptLower = prompt.toLowerCase();

  for (const pattern of patterns) {
    const keywords = pattern.avoid.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length === 0) continue;

    const matchCount = keywords.filter(kw => promptLower.includes(kw)).length;
    const matchRatio = matchCount / keywords.length;

    if (matchRatio >= 0.6) {
      const lang = detectLanguage(prompt);
      issues.push({
        ruleId: pattern.id,
        name: typeof pattern.name === 'object' ? pattern.name[lang] : pattern.name,
        avoid: pattern.avoid,
        suggestion: pattern.instead,
        severity: 'warning',
        source: 'learned'
      });
    }
  }
  return issues;
}

// ── Main orchestrator ──────────────────────────────────────────────

/**
 * Analyze a prompt against all rules and return issues.
 *
 * @param {string} prompt - The user prompt to analyze.
 * @param {object[]} learnedPatterns - Patterns from memory (not yet used, reserved).
 * @param {object[]} [rules] - Optional rules array (loaded from JSON if omitted).
 * @returns {{ issues: object[], skipped: boolean }}
 */
export function analyzePrompt(prompt, learnedPatterns, rules) {
  // 1. skip: prefix — bypass analysis entirely
  if (prompt.trimStart().toLowerCase().startsWith('skip:')) {
    return { issues: [], skipped: true };
  }

  // 2. Short prompts — not enough content to analyze meaningfully
  if (prompt.trim().length < 25) {
    return { issues: [], skipped: false };
  }

  // 3. Load rules if not provided
  if (!rules) {
    rules = loadRules();
  }

  // 4. Detect language
  const lang = detectLanguage(prompt);

  // 5. Evaluate all rules, collect non-null issues
  const issues = [];
  for (const rule of rules) {
    const issue = evaluateRule(prompt, rule, lang);
    if (issue) {
      issues.push(issue);
    }
  }

  // 5b. Evaluate learned patterns
  if (Array.isArray(learnedPatterns) && learnedPatterns.length > 0) {
    const learnedIssues = evaluatePatterns(prompt, learnedPatterns);
    issues.push(...learnedIssues);
  }

  // 6. Deduplicate by first 35 chars of suggestion
  const seen = new Set();
  const deduped = [];
  for (const issue of issues) {
    const key = issue.suggestion.substring(0, 35);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(issue);
    }
  }

  // 7. Cap at 4 issues max
  const capped = deduped.slice(0, 4);

  return { issues: capped, skipped: false };
}

// ── Output formatting ────────────────────────────────────────────

/**
 * Format analysis issues into structured output for the hook consumer.
 *
 * Decision logic:
 *  - 0 issues → null (no output, silent pass)
 *  - 1 warning (no block severity) → { type:'warning', stderr, stdout: null }
 *  - 2+ warnings OR any severity:'block' → { type:'block', stdout: JSON, stderr: header }
 *
 * @param {object[]} issues - Array of issue objects from analyzePrompt.
 * @param {'en' | 'es'} lang - Detected language (reserved for future i18n).
 * @returns {{ type: 'warning' | 'block', stderr: string, stdout: string | null } | null}
 */
export function formatOutput(issues, lang) {
  if (!issues || issues.length === 0) {
    return null;
  }

  const hasBlockSeverity = issues.some(i => i.severity === 'block');

  // Single warning (no block severity) → soft warning on stderr only
  if (issues.length === 1 && !hasBlockSeverity) {
    const issue = issues[0];
    let stderr;

    if (issue.source === 'learned') {
      stderr = `\u26a0 prompt-quality-gate: Learned pattern \u2014 "${issue.name}"\n   Avoid: ${issue.avoid}\n   Instead: ${issue.suggestion}`;
    } else {
      stderr = `\u26a0 prompt-quality-gate: ${issue.name}. ${issue.suggestion}\n   Tip: improve your prompt to be more specific.`;
    }

    return { type: 'warning', stderr, stdout: null };
  }

  // 2+ issues OR any block severity → hard block with JSON on stdout
  const numberedList = issues
    .map((issue, idx) => `${idx + 1}. ${issue.name}: ${issue.suggestion}`)
    .join(' ');

  const stdout = JSON.stringify({
    decision: 'block',
    reason: numberedList,
    bypass: "prefix your prompt with 'skip:' to send as-is",
  });

  const stderr = `\u2716 prompt-quality-gate: ${issues.length} issues detected \u2014 prompt blocked.`;

  return { type: 'block', stdout, stderr };
}

// ── CLI entry point ──────────────────────────────────────────────

/**
 * main() — stdin/stdout handler for the Claude Code hook.
 *
 * Reads JSON from stdin ({ prompt, cwd, session_id }),
 * runs the analysis pipeline, and writes output to stderr/stdout.
 *
 * Exit codes are always 0 (the hook protocol uses stdout JSON for decisions).
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
    // Malformed input — silently pass
    process.exit(0);
  }

  const prompt = input.prompt || '';
  if (!prompt) {
    process.exit(0);
  }

  // Load learned patterns from memory
  let learnedPatterns = [];
  try {
    learnedPatterns = loadPatterns();
  } catch {
    // No patterns file yet — that's fine
  }

  // Run analysis
  const result = analyzePrompt(prompt, learnedPatterns);

  // Format output
  const lang = detectLanguage(prompt);
  const output = formatOutput(result.issues, lang);

  if (output === null) {
    process.exit(0);
  }

  if (output.type === 'warning') {
    process.stderr.write(output.stderr);
    process.exit(0);
  }

  if (output.type === 'block') {
    process.stderr.write(output.stderr);
    process.stdout.write(output.stdout);
    process.exit(0);
  }
}

// Only run main when executed directly (not imported for testing)
if (process.argv[1] && process.argv[1].endsWith('analyze-prompt.mjs')) {
  main();
}
