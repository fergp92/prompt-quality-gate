# Prompt Engineering Best Practices

## 1. One Task Per Prompt
Each prompt should focus on a single, well-defined task. Compound prompts
("do X and then Y and also Z") produce worse results. Split them.

## 2. Include File References
Always specify which files are involved. Use `@file` mentions or explicit
paths like `src/routes/auth.js`. Without scope, the agent guesses.

## 3. Specify Verification Criteria
Tell the agent how to verify the work: a test command to run, expected
output, or acceptance criteria. "Implement X" is incomplete without
"verify by running `npm test`".

## 4. Use Plan Mode for Architecture
Large refactors, migrations, and redesigns need a plan before code.
Use plan mode or request a design doc first. Coding without a spec
leads to rework.

## 5. Never Hardcode Secrets
API keys, passwords, tokens, and credentials must never appear in
prompts. Use environment variables, `.env` files, or a vault.
This is a non-negotiable security rule.

## 6. Read Context Files First
Before starting work on any project, read `SESSION-CONTEXT.md` or
`CLAUDE.md` to understand current state, active bugs, running
services, and recent changes. Context prevents duplicate work.

## 7. Be Specific About the Bug
"It doesn't work" is not actionable. Include: error message, file
and line number, stack trace, steps to reproduce, and expected vs
actual behavior.

## 8. Scope Mass Edits
"Rename all X to Y" needs a scope: which directory, which file
types, which module. Unbounded edits risk unintended changes
across the codebase.
