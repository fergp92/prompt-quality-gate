/**
 * install-hooks.mjs — Idempotent hook installer for prompt-quality-gate.
 *
 * Reads ~/.claude/settings.json, backs up to settings.json.bak,
 * adds UserPromptSubmit and Stop hooks if not already present,
 * and writes the updated settings back.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const BACKUP_PATH = join(homedir(), '.claude', 'settings.json.bak');

// Hook definitions — these match the design doc section 6.1
const HOOKS_TO_INSTALL = {
  UserPromptSubmit: {
    matcher: '',
    hooks: [{
      type: 'command',
      command: "node '${CLAUDE_PLUGIN_ROOT}/skills/prompt-quality-gate/scripts/analyze-prompt.mjs'",
      timeout: 3
    }]
  },
  Stop: {
    matcher: '',
    hooks: [{
      type: 'command',
      command: "node '${CLAUDE_PLUGIN_ROOT}/skills/prompt-quality-gate/scripts/learn-from-session.mjs'",
      timeout: 30
    }]
  }
};

function main() {
  // 1. Read existing settings (or start fresh)
  let settings = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch (e) {
      console.error(`⚠ prompt-quality-gate: Could not parse ${SETTINGS_PATH}: ${e.message}`);
      console.error('  Creating new settings file.');
      settings = {};
    }
    // 2. Backup
    copyFileSync(SETTINGS_PATH, BACKUP_PATH);
    console.error(`ℹ Backup saved to ${BACKUP_PATH}`);
  }

  // 3. Ensure hooks structure exists
  if (!settings.hooks) {
    settings.hooks = {};
  }

  let changed = false;

  // 4. Add hooks idempotently
  for (const [eventName, hookDef] of Object.entries(HOOKS_TO_INSTALL)) {
    if (!Array.isArray(settings.hooks[eventName])) {
      settings.hooks[eventName] = [];
    }

    // Check if our hook is already installed (by checking command string)
    const alreadyInstalled = settings.hooks[eventName].some(entry => {
      if (!entry.hooks || !Array.isArray(entry.hooks)) return false;
      return entry.hooks.some(h => h.command && h.command.includes('prompt-quality-gate'));
    });

    if (alreadyInstalled) {
      console.error(`ℹ ${eventName} hook already installed — skipping.`);
    } else {
      settings.hooks[eventName].push(hookDef);
      console.error(`✓ ${eventName} hook installed.`);
      changed = true;
    }
  }

  // 5. Write back
  if (changed) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    console.error(`✓ Settings saved to ${SETTINGS_PATH}`);
  } else {
    console.error('ℹ No changes needed — all hooks already installed.');
  }
}

main();
