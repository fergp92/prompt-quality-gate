# prompt-quality-gate

Real-time prompt quality analysis for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Blocks vague, compound, or insecure prompts **before** Claude processes them. Bilingual (EN+ES) with auto-detection and session-based learning memory.

> **Inspired by** [lucasrudi/token-optimizer-memory](https://github.com/lucasrudi/token-optimizer-memory) — we took the core ideas (real-time hook analysis + post-session learning loop) and built a robust, testable Node.js reimplementation with bilingual support and spec-driven development rules.

## Why

Bad prompts waste tokens and produce bad outputs. "Fix the bug" burns context that "fix the TypeError in `src/auth.mjs:45` where `validateToken` throws on expired tokens — run `npm test -- auth` to verify" wouldn't.

This skill intercepts every prompt via Claude Code's `UserPromptSubmit` hook and catches problems **before** they consume tokens — shift-left for prompt engineering.

## How It Works

```
User types prompt
        ↓
  ┌─────────────────────────┐
  │  analyze-prompt.mjs     │ ← UserPromptSubmit hook (< 3s)
  │  ├── Detect language    │
  │  ├── Evaluate 10 rules  │
  │  ├── Match learned       │
  │  │   patterns (memory)  │
  │  └── Verdict:           │
  │      0 issues → pass ✓  │
  │      1 issue  → warn ⚠  │
  │      2+ / block → ✖     │
  └─────────────────────────┘
        ↓
  Claude processes prompt
        ↓
  Session ends
        ↓
  ┌─────────────────────────┐
  │  learn-from-session.mjs │ ← Stop hook (< 30s)
  │  ├── Extract last 15    │
  │  │   user prompts       │
  │  ├── Invoke claude -p   │
  │  │   → identify 2 new   │
  │  │     anti-patterns     │
  │  └── Store in           │
  │      memory/patterns.json│
  └─────────────────────────┘
```

## Rules

10 bilingual detection rules with guards, negation lists, and regex support:

| # | Rule | Detects | Severity |
|---|------|---------|----------|
| 1 | `vague-task` | "fix the bug", "make it work", "arreglá el bug" | warning |
| 2 | `bug-no-details` | Bug report without error message or stack trace | warning |
| 3 | `no-file-reference` | Code changes without `@file` or path | warning |
| 4 | `no-verification` | Implementation without test/verify step | warning |
| 5 | `compound-task` | 3+ task markers ("and then", "also", "además") | warning |
| 6 | `arch-no-plan` | Refactor/migrate without plan mode | warning |
| 7 | `code-before-spec` | Writing code without spec/design mention | **block** |
| 8 | `no-context-read` | Starting work without reading context files | warning |
| 9 | `hardcoded-secret` | API keys, passwords, tokens in prompt text | **block** |
| 10 | `mass-edit-no-scope` | "change all/replace everywhere" without path scope | warning |

### Severity System

- `warning` rules: 1 issue → yellow warning (prompt passes), 2+ → blocked
- `block` rules: immediate block regardless of count
- Prompts < 25 chars: always pass (too short to judge)
- Max 4 issues reported per prompt
- Bypass: prefix any prompt with `skip:` to send as-is

## Learning Memory

The quality gate **gets smarter with every session**:

1. At session end, extracts your last 15 prompts from the transcript
2. Invokes `claude -p` to analyze them against best practices
3. Identifies up to 2 new anti-patterns you tend to repeat
4. Stores them in `memory/patterns.json` with deduplication
5. In future sessions, matches learned patterns by 60% keyword overlap
6. Caps at 50 patterns; purges rare/oldest when full

## Language Detection

Auto-detects EN or ES via stopword frequency analysis. All feedback (warnings, blocks, suggestions) is returned in the detected language. Patterns support both languages natively.

## Installation

### As a superpowers skill (recommended)

Copy the skill to your superpowers plugin:

```bash
cp -r prompt-quality-gate/ ~/.claude/plugins/cache/claude-plugins-official/superpowers/*/skills/prompt-quality-gate/
```

Add hooks to `hooks.json`:

```json
{
  "UserPromptSubmit": [{
    "matcher": "",
    "hooks": [{
      "type": "command",
      "command": "node '${CLAUDE_PLUGIN_ROOT}/skills/prompt-quality-gate/scripts/analyze-prompt.mjs'",
      "timeout": 3000
    }]
  }],
  "Stop": [{
    "matcher": "",
    "hooks": [{
      "type": "command",
      "command": "node '${CLAUDE_PLUGIN_ROOT}/skills/prompt-quality-gate/scripts/learn-from-session.mjs'",
      "timeout": 30000
    }]
  }]
}
```

### Standalone (Claude Code hooks)

```bash
node scripts/install-hooks.mjs
```

This idempotently registers both hooks in `~/.claude/settings.json`.

## Development

```bash
pnpm install --frozen-lockfile
pnpm test          # 55 tests (unit + integration)
pnpm run test:watch
```

### Project Structure

```
prompt-quality-gate/
├── SKILL.md                      # Skill manifest
├── scripts/
│   ├── analyze-prompt.mjs        # UserPromptSubmit hook — rules engine
│   ├── learn-from-session.mjs    # Stop hook — learning loop
│   └── install-hooks.mjs         # Standalone hook installer
├── rules/
│   └── default-rules.json        # 10 bilingual detection rules
├── memory/
│   └── patterns.json             # Learned anti-patterns (grows over time)
├── references/
│   └── best-practices.md         # Reference for learning prompt
└── tests/
    ├── analyze-prompt.test.mjs   # 23 unit tests
    ├── output.test.mjs           # 8 output format tests
    ├── learn-from-session.test.mjs # 19 learning tests
    ├── integration.test.mjs      # 5 integration tests (stdin→stdout)
    └── fixtures/
        ├── bad-prompts.json      # 10 test cases (one per rule)
        └── good-prompts.json     # 5 clean prompts that pass
```

## Comparison with Original

This project was inspired by [lucasrudi/token-optimizer-memory](https://github.com/lucasrudi/token-optimizer-memory). Here's how the approaches differ:

| Aspect | token-optimizer-memory | prompt-quality-gate |
|--------|----------------------|---------------------|
| **Approach** | Optimize tokens post-hoc | Prevent bad prompts pre-submission |
| **Language** | Bash + heredocs + Python inline | Node.js ESM (zero external deps) |
| **i18n** | English only | Bilingual EN+ES with auto-detection |
| **Rules** | 6 generic, inline in bash | 10 declarative JSON, with guards and regex |
| **Tests** | None | 55 tests (vitest) |
| **Memory** | Static hints file | Dynamic learning loop via `claude -p` |
| **Security** | Heredoc injection vulnerability | Native JSON parsing, no shell injection |
| **Cross-check** | Dead code (never executes) | Learned patterns matched by keyword overlap |
| **Hint gen** | Substring-based (incorrect) | Per-rule bilingual suggestions |
| **Integration** | Manual config | Superpowers skill or standalone installer |

### Key Design Decisions

1. **Shift-left** — blocking before token consumption is more effective than optimizing after
2. **Declarative rules** — JSON schema means anyone can add rules without touching code
3. **Learning loop** — the gate evolves with your coding style; not static
4. **Bilingual native** — not bolted-on; every rule has EN+ES patterns and suggestions
5. **Spec-driven rules** — rules 7 and 8 enforce [USDAF](https://github.com/Fergp92/usdaf) discipline (no code before spec, read context files first)

## USDAF Integration

Rules 7 (`code-before-spec`) and 8 (`no-context-read`) enforce the **Unified Spec-Driven Agile Framework** principle: specs before code, context before action. This makes the quality gate a natural companion to USDAF's 8-phase development workflow.

## Requirements

- **Node.js** ≥ 18 (already present with Claude Code)
- `claude` CLI on PATH (for learning hook only)

## License

MIT

## Credits

- Inspired by [@lucasrudi](https://github.com/lucasrudi)'s [token-optimizer-memory](https://github.com/lucasrudi/token-optimizer-memory)
- Built with [USDAF](https://github.com/Fergp92/usdaf) — spec-driven, agent-assisted development
