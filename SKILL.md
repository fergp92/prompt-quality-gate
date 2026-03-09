---
name: prompt-quality-gate
description: Real-time prompt quality analysis that blocks vague, compound, or insecure prompts with bilingual (ES+EN) detection and session-based learning memory. Triggers on blocked prompts, quality warnings, rejected submissions, and prompt improvement suggestions.
---

# Prompt Quality Gate

Real-time prompt quality analysis with bilingual detection and learning memory.

## Overview

Analyzes every prompt before Claude processes it via the `UserPromptSubmit` hook. Detects 10 categories of low-quality prompts (vague tasks, missing file references, compound requests, hardcoded secrets, etc.) in both English and Spanish. Learns new anti-patterns from session history via the `Stop` hook.

## How It Works

1. **UserPromptSubmit hook** — `scripts/analyze-prompt.mjs` runs on every prompt
   - Auto-detects language (EN/ES) via stopword frequency
   - Evaluates 10 rules + learned patterns from memory
   - 0 issues → silent pass
   - 1 issue → yellow warning (prompt passes)
   - 2+ issues or severity:block → prompt blocked with suggestions
   - Bypass: prefix prompt with `skip:` to send as-is

2. **Stop hook** — `scripts/learn-from-session.mjs` runs at session end
   - Extracts last 15 user prompts from transcript
   - Invokes `claude -p` to identify max 2 new anti-patterns
   - Deduplicates and stores in `memory/patterns.json`
   - Caps at 50 patterns, purges rare/oldest

## Rules

| # | Rule | Detects | Severity |
|---|------|---------|----------|
| 1 | vague-task | "fix the bug", "make it work" | warning |
| 2 | bug-no-details | Bug report without error/stack | warning |
| 3 | no-file-reference | Code changes without @file or path | warning |
| 4 | no-verification | Implementation without test/verify | warning |
| 5 | compound-task | 3+ "and then/also/además" markers | warning |
| 6 | arch-no-plan | Refactor/migrate without plan mode | warning |
| 7 | code-before-spec | Code without spec/design mention | **block** |
| 8 | no-context-read | Starting without SESSION-CONTEXT/CLAUDE.md | warning |
| 9 | hardcoded-secret | API key/password literal in prompt | **block** |
| 10 | mass-edit-no-scope | "change all" without path scope | warning |

## Learning Memory

The quality gate learns from your sessions. After each session, it analyzes your prompts and identifies recurring anti-patterns. These learned patterns are stored in `memory/patterns.json` and matched in future sessions.

## Requirements

- **Node.js** runtime (already present with Claude Code)
- `claude` CLI on PATH (for learning hook only)
