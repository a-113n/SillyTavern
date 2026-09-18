# ST Logbook Extension — Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** A SillyTavern third-party extension that stores the Freaky Frankenstein / Bunker-family "Internal States" block in `chat_metadata.logbook`, strips it from outgoing prompts, and re-injects it at in-chat depth 0 — eliminating volatile state reconstruction by the model.

**Architecture:** Pure ES modules (`parser.js`, `turn.js`) carry all correctness and are TDD'd with `node --test`; `index.js` is thin SillyTavern glue (events, injection, settings UI) using only `SillyTavern.getContext()`. Regex scripts for history stripping are auto-installed into `extension_settings.regex`.

**Tech Stack:** Plain ES modules (repo `package.json` is `"type": "module"`), node 25 `node --test`, no build step, no dependencies.

**Design doc:** `docs/plans/2026-09-18-st-logbook-design.md` — read it first.

## Grounded API facts (verified against this repo)

- Extensions load from `public/scripts/extensions/third-party/<name>/` via `<script type="module">` — ES `import` of sibling files works (see `addExtensionScript` in `public/scripts/extensions.js:810`).
- `SillyTavern.getContext()` exposes: `chat`, `chatMetadata`, `eventSource`, `eventTypes`, `extensionSettings`, `saveSettingsDebounced`, `saveMetadataDebounced`, `setExtensionPrompt`, `Popup`, `uuidv4`.
- `setExtensionPrompt(key, value, position, depth, scan = false, role = 0, filter = null)` (`public/script.js:8866`). Position enum: `IN_CHAT = 1` (`public/script.js:483`). Role: `SYSTEM = 0`.
- Events (`public/scripts/events.js`): `chat_id_changed`, `generation_started`, `message_received`, `message_edited`, `message_swiped`.
- Regex script schema (`public/scripts/char-data.js:88` `RegexScriptData`): `{ id, scriptName, findRegex, replaceString, trimStrings, placement, disabled, markdownOnly, promptOnly, runOnEdit, substituteRegex, minDepth, maxDepth }`. Stored in `extension_settings.regex`. Placement `AI_OUTPUT = 2` (`regex/engine.js:287`); `promptOnly: true, markdownOnly: false` = strip from outgoing prompt only, UI unaffected.
- Real reference chat: `data/default-user/chats/The Bunker/Alone in the Bunker.jsonl` — last AI message carries a 17k-char states block, `Turn: 196`, 12 sections (no DND TASK SIM in this chat — parser must treat it as optional).
- Canonical section list (from `.pi/skills/st-internal-states-repair/SKILL.md`): NPC AGENDAS, NPC LOCATIONS, FACTIONS, QUESTS, INV & SKILLS, GM'S NOTEBOOK, WORLD SIM, PHYSICS; tail sections: BONDS, CHEKHOV'S GUN, INTERNAL THOUGHTS, DND TASK SIM.

---

## Phase 1 — Pure modules (TDD)

### Task 1: Scaffold + fixtures

**TDD scenario:** Trivial scaffold — no tests yet; fixture extraction sets up test data.

**Files:**
- Create: `public/scripts/extensions/third-party/st-logbook/manifest.json`
- Create: `public/scripts/extensions/third-party/st-logbook/index.js` (stub)
- Create: `public/scripts/extensions/third-party/st-logbook/style.css` (stub)
- Create: `public/scripts/extensions/third-party/st-logbook/tests/fixtures/` (generated)

**Step 1: Create manifest.json**

```json
{
    "display_name": "Logbook",
    "loading_order": 150,
    "requires": [],
    "optional": [],
    "js": "index.js",
    "css": "style.css",
    "author": "allen",
    "version": "0.1.0",
    "homePage": "",
    "auto_update": false,
    "description": "Persistent Internal States logbook: stores the states block in chat metadata, strips it from prompts, re-injects authoritative state at depth 0."
}
```

**Step 2: Stub index.js + style.css**

`index.js`:
```js
// st-logbook — Internal States logbook extension (see docs/plans/2026-09-18-st-logbook-design.md)
console.debug('[st-logbook] loaded (stub)');
```

`style.css`: empty file (placeholder).

**Step 3: Extract real fixture from the Bunker chat**

Run from repo root:
```bash
mkdir -p public/scripts/extensions/third-party/st-logbook/tests/fixtures && python3 - <<'EOF'
import json, re
f = 'data/default-user/chats/The Bunker/Alone in the Bunker.jsonl'
for line in reversed(open(f).readlines()[1:]):
    d = json.loads(line)
    if d.get('is_user'): continue
    m = d.get('mes', '')
    i = m.find('<!-- GFX_START -->')
    if i >= 0:
        open('public/scripts/extensions/third-party/st-logbook/tests/fixtures/bunker-real-block.html', 'w').write(m[i:])
        print('wrote', len(m) - i, 'chars; turn =', re.findall(r'INTERNAL STATES \(Turn:\s*(\d+)\)', m))
        break
EOF
```
Expected: `wrote ~17000 chars; turn = ['196']`

**Step 4: Commit**

```bash
git add public/scripts/extensions/third-party/st-logbook/
git commit -m "feat(logbook): scaffold st-logbook extension + real fixture"
```

---

### Task 2: parser.js — extractStatesBlock

**TDD scenario:** New feature — full TDD cycle.

**Files:**
- Create: `public/scripts/extensions/third-party/st-logbook/parser.js`
- Test: `public/scripts/extensions/third-party/st-logbook/tests/parser.test.js`

**Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractStatesBlock } from '../parser.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const realBlock = readFileSync(join(fixtures, 'bunker-real-block.html'), 'utf8');

const synthetic = `He raised the lantern.

<!-- GFX_START -->
<internal_states>
<details>
  <summary>🎬 INTERNAL STATES (Turn: 41) </summary>
  <details><summary>👤 NPC AGENDAS</summary>
  - <b>Gus</b> | Agenda: fix the radio | Aware: storm truth
  </details>
  <details><summary>🌌 PHYSICS, ENGINE & WORLD</summary>
  - Env: rain
  </details>
</details>
</internal_states>
<!-- GFX_END -->

<details><summary>💚 BONDS</summary><br>- <b>Wren</b> ⇷ Allen | BOND 3
</details>
<details><summary>🧠 INTERNAL THOUGHTS</summary><br>- <b>Wren</b> | I held
</details>`;

test('extracts gfx block and tail sections from synthetic message', () => {
    const r = extractStatesBlock(synthetic);
    assert.ok(r.gfxBlock.includes('<!-- GFX_START -->') && r.gfxBlock.includes('<!-- GFX_END -->'));
    assert.ok(!r.gfxBlock.includes('💚 BONDS'));
    assert.equal(r.tailBlocks.length, 2);
    assert.ok(r.tailBlocks[0].includes('💚 BONDS'));
    assert.ok(r.tailBlocks[1].includes('🧠 INTERNAL THOUGHTS'));
    assert.ok(r.full.includes('GFX_START') && r.full.includes('I held'));
});

test('DND TASK SIM before GFX block is still captured', () => {
    const msg = `<details><summary>🎲 DND TASK SIM</summary><br>Task 10: roll
</details>

He spoke.
${synthetic}`;
    const r = extractStatesBlock(msg);
    assert.equal(r.tailBlocks.length, 3);
    assert.ok(r.tailBlocks.some(t => t.includes('DND TASK SIM')));
});

test('nested details do not truncate outer gfx match', () => {
    const r = extractStatesBlock(synthetic);
    assert.ok(r.gfxBlock.trim().endsWith('</internal_states>'));
});

test('real bunker fixture parses fully', () => {
    const r = extractStatesBlock('prose before\n\n' + realBlock);
    assert.ok(r.gfxBlock.startsWith('<!-- GFX_START -->'));
    assert.equal(r.tailBlocks.length, 3); // BONDS, CHEKHOV, THOUGHTS (no DND in this chat)
});

test('no states block returns null', () => {
    assert.equal(extractStatesBlock('Just prose, nothing else.'), null);
});

test('tail sections without gfx wrapper are invalid (null)', () => {
    const orphan = `<details><summary>💚 BONDS</summary>…</details>`;
    assert.equal(extractStatesBlock('prose\n\n' + orphan), null);
});
```

**Step 2: Run — verify failure**

```bash
cd public/scripts/extensions/third-party/st-logbook && node --test tests/
```
Expected: FAIL — cannot find module `../parser.js`.

**Step 3: Implement parser.js (minimal)**

```js
// Pure module — no SillyTavern imports. Safe to unit test.

const GFX_RE = /<!-- GFX_START -->[\s\S]*?<!-- GFX_END -->/;
const TAIL_SUMMARIES = ['💚 BONDS', "🔫 CHEKHOV'S GUN", '🧠 INTERNAL THOUGHTS', '🎲 DND TASK SIM'];
const TAIL_RE = new RegExp(
    `<details>\\s*<summary>\\s*(?:${TAIL_SUMMARIES.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\s\\S]*?</details>`,
    'g',
);

/**
 * Extract the internal-states payload from a message.
 * @param {string} mes
 * @returns {{ gfxBlock: string, tailBlocks: string[], full: string } | null}
 *   Null when no GFX block is present — tail sections alone are not a valid state.
 */
export function extractStatesBlock(mes) {
    if (typeof mes !== 'string') return null;
    const gfx = mes.match(GFX_RE);
    if (!gfx) return null;
    const tailBlocks = [...mes.matchAll(TAIL_RE)].map(m => m[0]);
    return { gfxBlock: gfx[0], tailBlocks, full: gfx[0] + '\n\n' + tailBlocks.join('\n\n') };
}
```

**Step 4: Run — verify pass** (same command as Step 2). Expected: 6 passed.

**Step 5: Commit** `git commit -am "feat(logbook): extractStatesBlock parser with real-fixture test"`

---

### Task 3: parser.js — validateSections

**TDD scenario:** New feature — full TDD cycle.

**Files:**
- Modify: `public/scripts/extensions/third-party/st-logbook/parser.js`
- Test: `public/scripts/extensions/third-party/st-logbook/tests/parser.test.js` (append)

**Step 1: Append failing tests**

```js
import { validateSections } from '../parser.js';

test('validateSections reports present/missing canonical sections', () => {
    const r = extractStatesBlock(synthetic);
    const inv = validateSections(r.full);
    assert.deepEqual(inv.present.sort(), ['NPC AGENDAS', 'PHYSICS, ENGINE & WORLD', 'BONDS', 'INTERNAL THOUGHTS'].sort());
    assert.ok(inv.missing.includes('QUESTS'));
    assert.ok(inv.missing.includes("GM'S NOTEBOOK"));
    assert.ok(inv.missing.includes('CHEKHOV'));
    assert.ok(inv.missing.includes('INV & SKILLS'));
});

test('validateSections on real fixture finds 12 sections, DND missing', () => {
    const r = extractStatesBlock(realBlock);
    const inv = validateSections(r.full);
    assert.equal(inv.present.length, 12);
    assert.deepEqual(inv.missing, ['DND TASK SIM']);
});
```

**Step 2: Run — verify failure** (`node --test tests/`). Expected: FAIL — no export `validateSections`.

**Step 3: Implement**

Append to `parser.js`:

```js
const CORE_SECTIONS = ['NPC AGENDAS', 'NPC LOCATIONS', 'FACTIONS', 'QUESTS', 'INV & SKILLS', "GM'S NOTEBOOK", 'WORLD SIM', 'PHYSICS, ENGINE & WORLD'];
const TAIL_SECTION_KEYS = { '💚 BONDS': 'BONDS', "🔫 CHEKHOV'S GUN": 'CHEKHOV', '🧠 INTERNAL THOUGHTS': 'INTERNAL THOUGHTS', '🎲 DND TASK SIM': 'DND TASK SIM' };
const ALL_SECTIONS = [...CORE_SECTIONS, ...Object.values(TAIL_SECTION_KEYS)];

/**
 * Inventory which canonical sections a states payload contains.
 * @param {string} full gfxBlock + tailBlocks concatenation
 * @returns {{ present: string[], missing: string[] }}
 */
export function validateSections(full) {
    const present = [];
    for (const s of ALL_SECTIONS) {
        if (full.includes(`<summary>${sectionLabel(s)}`)) present.push(s);
    }
    return { present, missing: ALL_SECTIONS.filter(s => !present.includes(s)) };
}

function sectionLabel(name) {
    for (const [emoji, key] of Object.entries(TAIL_SECTION_KEYS)) {
        if (key === name) return emoji;
    }
    return name;
}
```

Note: core summaries render as e.g. `<summary>👤 NPC AGENDAS</summary>` — `full.includes('<summary>👤 NPC AGENDAS')` style matching; `sectionLabel` maps tail keys back to their emoji labels. If the real fixture uses whitespace variants (`<summary> 🎒 INV & SKILLS`), adjust matching to strip spaces from summaries before compare — implement as: normalize `full` by removing spaces between `<summary>` and text. Simplest robust version: build a squashed copy `full.replace(/<summary>\s+/g, '<summary>')` and match against labels the same way.

**Step 4: Run — verify pass.** Expected: 8 passed total.

**Step 5: Commit** `git commit -am "feat(logbook): canonical section validation"`

---

### Task 4: parser.js — extractTurn / renumberTurn

**TDD scenario:** New feature — full TDD cycle.

**Files:**
- Modify: `public/scripts/extensions/third-party/st-logbook/parser.js`
- Test: append to `tests/parser.test.js`

**Step 1: Append failing tests**

```js
import { extractTurn, renumberTurn } from '../parser.js';

test('extractTurn reads the number from the summary label', () => {
    assert.equal(extractTurn(realBlock), 196);
    assert.equal(extractTurn(synthetic), 41);
});

test('extractTurn tolerates malformed and missing labels', () => {
    assert.equal(extractTurn('🎬 INTERNAL STATES (Turn: twelve)'), null);
    assert.equal(extractTurn('no label at all'), null);
    assert.equal(extractTurn(null), null);
});

test('renumberTurn rewrites the label in place', () => {
    const out = renumberTurn(synthetic, 42);
    assert.match(out, /INTERNAL STATES \(Turn: 42\)/);
    assert.ok(!out.includes('Turn: 41'));
    // body untouched
    assert.ok(out.includes('fix the radio'));
});

test('renumberTurn injects a label when missing', () => {
    const noLabel = synthetic.replace('(Turn: 41) ', '');
    const out = renumberTurn(noLabel, 7);
    assert.match(out, /INTERNAL STATES \(Turn: 7\)/);
});
```

**Step 2: Run — verify failure.**

**Step 3: Implement**

```js
const TURN_RE = /INTERNAL STATES \(Turn:\s*(\d+)\)/;

/** @returns {number | null} */
export function extractTurn(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(TURN_RE);
    return m ? Number(m[1]) : null;
}

/** Force the turn label to n; injects one if absent. */
export function renumberTurn(text, n) {
    if (TURN_RE.test(text)) return text.replace(TURN_RE, `INTERNAL STATES (Turn: ${n})`);
    return text.replace(/(INTERNAL STATES \()/, `INTERNAL STATES (Turn: ${n} ` + '');
}
```

(If injection-without-label proves awkward with the real emoji label format `🎬 INTERNAL STATES (Turn: N)`, implement: append `(Turn: ${n})` after the first `INTERNAL STATES ` occurrence without parens.)

**Step 4: Run — verify pass.** Expected: 12 passed total.

**Step 5: Commit** `git commit -am "feat(logbook): turn extraction and force-renumber"`

---

### Task 5: turn.js — injection builder + guards

**TDD scenario:** New feature — full TDD cycle.

**Files:**
- Create: `public/scripts/extensions/third-party/st-logbook/turn.js`
- Test: `public/scripts/extensions/third-party/st-logbook/tests/turn.test.js`

**Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, nextTurnFrom, isSameState } from '../turn.js';

const logbook = { turn: 196, raw: '<!-- GFX_START -->…<!-- GFX_END -->', sourceMesId: 300, contentHash: 'abc' };

test('buildInjection frames the logbook and announces next turn', () => {
    const text = buildInjection(logbook);
    assert.match(text, /\[LOGBOOK — authoritative game state as of Turn 196\./);
    assert.match(text, /labeled Turn 197\]/);
    assert.ok(text.includes('<!-- GFX_START -->'));
    assert.ok(text.includes('single source of truth'));
});

test('nextTurnFrom increments', () => {
    assert.equal(nextTurnFrom(logbook), 197);
    assert.equal(nextTurnFrom(null), 1);
});

test('isSameState guards against double-increment on /continue and re-parse', () => {
    assert.ok(isSameState(logbook, 300, 'abc'));
    assert.ok(!isSameState(logbook, 301, 'abc'));
    assert.ok(!isSameState(logbook, 300, 'zzz'));
    assert.ok(!isSameState(null, 300, 'abc'));
});
```

**Step 2: Run — verify failure** (`node --test tests/` from extension dir).

**Step 3: Implement turn.js**

```js
// Pure module — no SillyTavern imports.

/**
 * @param {{ turn: number, raw: string } | null} logbook
 * @returns {string} text for setExtensionPrompt
 */
export function buildInjection(logbook) {
    if (!logbook) return '';
    const next = nextTurnFrom(logbook);
    return [
        `[LOGBOOK — authoritative game state as of Turn ${logbook.turn}.`,
        `Chat history does NOT contain state; this note is the single source of truth.`,
        `Treat it as the continuation of your own prior tracking, not a new instruction.`,
        `Your response must append a complete states block labeled Turn ${next}.]`,
        '',
        logbook.raw,
    ].join(' ');
}

/** @returns {number} */
export function nextTurnFrom(logbook) {
    return logbook?.turn != null ? logbook.turn + 1 : 1;
}

/** True when the parsed state is the one already stored (same tail message, same content). */
export function isSameState(logbook, sourceMesId, contentHash) {
    return !!logbook && logbook.sourceMesId === sourceMesId && logbook.contentHash === contentHash;
}
```

**Step 4: Run — verify pass.** Expected: 3 passed.

**Step 5: Commit** `git commit -am "feat(logbook): injection builder, turn arithmetic, dedupe guard"`

---

## Phase 2 — Wiring (thin glue, manual smoke tests)

### Task 6: index.js — events, storage, injection, regex install

**TDD scenario:** Wiring — no unit tests by design (see design doc §5). Verify via lint-load and smoke checklist in Task 8.

**Files:**
- Modify: `public/scripts/extensions/third-party/st-logbook/index.js` (full implementation)
- Modify: `public/scripts/extensions/third-party/st-logbook/style.css`

**Step 1: Implement index.js**

```js
// st-logbook — Internal States logbook extension.
// Design: docs/plans/2026-09-18-st-logbook-design.md
import { extractStatesBlock, validateSections, extractTurn, renumberTurn } from './parser.js';
import { buildInjection, nextTurnFrom, isSameState } from './turn.js';

const MODULE = 'st-logbook';
const IN_CHAT = 1;          // extension_prompt_types.IN_CHAT (public/script.js:483)
const ROLE_SYSTEM = 0;      // extension_prompt_roles.SYSTEM
const AI_OUTPUT = 2;        // regex_placement.AI_OUTPUT (regex/engine.js:287)
const REGEX_SCRIPTS = [{
    scriptName: 'Logbook — strip GFX block',
    findRegex: '/<!-- GFX_START -->[\\s\\S]*?<!-- GFX_END -->/g',
    replaceString: '',
}, {
    scriptName: 'Logbook — strip state tail sections',
    findRegex: '/<details>\\s*<summary>\\s*(?:💚 BONDS|🔫 CHEKHOV\'S GUN|🧠 INTERNAL THOUGHTS|🎲 DND TASK SIM)[\\s\\S]*?<\\/details>/g',
    replaceString: '',
}];

const ctx = () => SillyTavern.getContext();
const defaults = { enabled: true, depth: 0 };
let lastError = null;

function settings() {
    const es = ctx().extensionSettings;
    es[MODULE] ??= structuredClone(defaults);
    return es[MODULE];
}

/** Prompt-only context strippers, owned by this extension, idempotent upsert. */
function installRegexScripts() {
    const es = ctx().extensionSettings;
    es.regex ??= [];
    for (const tpl of REGEX_SCRIPTS) {
        const existing = es.regex.find(r => r.scriptName === tpl.scriptName);
        const entry = {
            id: existing?.id ?? crypto.randomUUID(),
            scriptName: tpl.scriptName,
            findRegex: tpl.findRegex,
            replaceString: '',
            trimStrings: [],
            placement: [AI_OUTPUT],
            disabled: !settings().enabled,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: 0,
            maxDepth: -1,
            ...tpl,
            ...(existing ? {} : {}),
        };
        Object.assign(existing ?? (es.regex.push(entry), entry), entry);
    }
    ctx().saveSettingsDebounced();
}

function logbook() { return ctx().chatMetadata?.logbook ?? null; }

/** Scan backwards for the newest AI message with a valid block. */
function bootstrap(force = false) {
    const { chat, chatMetadata, saveMetadataDebounced } = ctx();
    if (!force && logbook()) return;
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m?.is_user) continue;
        const parsed = extractStatesBlock(String(m.mes ?? ''));
        if (parsed) {
            const turn = extractTurn(parsed.full) ?? 1;
            chatMetadata.logbook = {
                turn,
                raw: renumberTurn(parsed.full, turn),
                sourceMesId: i,
                contentHash: hash(parsed.full),
                updatedAt: Date.now(),
            };
            saveMetadataDebounced();
            lastError = null;
            return;
        }
    }
    // No markers anywhere → dormant (no logbook, no injection).
    chatMetadata.logbook = undefined;
}

function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
}

function inject() {
    const value = settings().enabled ? buildInjection(logbook()) : '';
    ctx().setExtensionPrompt(MODULE, value, IN_CHAT, settings().depth, false, ROLE_SYSTEM, null);
}

/** Parse the tail AI message; update logbook only on a valid block. */
function harvest(messageId) {
    const { chat, chatMetadata, saveMetadataDebounced } = ctx();
    if (!settings().enabled) return;
    const lb = logbook();
    if (!lb) return; // dormant chat
    const i = messageId ?? chat.length - 1;
    const m = chat[i];
    if (!m || m.is_user || i !== chat.length - 1) return; // tail-only, monotonic
    const parsed = extractStatesBlock(String(m.mes ?? ''));
    if (!parsed) {
        lastError = 'tail message has no states block — logbook unchanged';
        console.warn(`[${MODULE}] ${lastError}`);
        return;
    }
    const h = hash(parsed.full);
    if (isSameState(lb, i, h)) return;
    const next = nextTurnFrom(lb);
    chatMetadata.logbook = {
        turn: next,
        raw: renumberTurn(parsed.full, next),
        sourceMesId: i,
        contentHash: h,
        updatedAt: Date.now(),
    };
    const inv = validateSections(parsed.full);
    if (inv.missing.length) {
        lastError = `stored with missing sections: ${inv.missing.join(', ')}`;
        console.warn(`[${MODULE}] ${lastError}`);
    } else lastError = null;
    saveMetadataDebounced();
    inject();
}

function onChatChanged() { bootstrap(); lastError = null; inject(); }
function onGenerationStarted() { inject(); }

jQuery(() => {
    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
    eventSource.on(eventTypes.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(eventTypes.MESSAGE_RECEIVED, (id) => harvest(id));
    eventSource.on(eventTypes.MESSAGE_EDITED, (id) => harvest(id));
    eventSource.on(eventTypes.MESSAGE_SWIPED, (id) => harvest(id));
    installRegexScripts();
    onChatChanged();
    console.debug(`[${MODULE}] ready`);
});
```

Note on the `Object.assign(existing ?? (es.regex.push(entry), entry), entry)` upsert line — if it reads too clever, write it plainly:
```js
let entry = es.regex.find(r => r.scriptName === tpl.scriptName);
if (!entry) { entry = {}; es.regex.push(entry); }
Object.assign(entry, { ...defaults-of-entry, ...tpl });
```
Use the plain version.

`style.css`: leave empty for now (drawer styling in Task 7).

**Step 2: Syntax check**

```bash
node --check public/scripts/extensions/third-party/st-logbook/index.js
node --check public/scripts/extensions/third-party/st-logbook/parser.js
node --check public/scripts/extensions/third-party/st-logbook/turn.js
```
Expected: no output (clean parse). `SillyTavern`/`jQuery` are browser globals — `--check` only parses, doesn't resolve them.

**Step 3: Re-run pure tests (regression)** `node --test tests/` — still green.

**Step 4: Commit** `git commit -am "feat(logbook): event wiring, logbook storage, depth-0 injection, regex install"`

---

### Task 7: Settings drawer UI

**TDD scenario:** UI glue — manual verification only.

**Files:**
- Modify: `public/scripts/extensions/third-party/st-logbook/index.js`
- Modify: `public/scripts/extensions/third-party/st-logbook/style.css`

**Step 1: Append drawer HTML + wiring inside `jQuery(() => {...})`**

```js
const html = `
<div class="st-logbook-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Logbook</b>
            <span class="st-logbook-status"></span>
        </div>
        <div class="inline-drawer-content">
            <label><input id="st_logbook_enabled" type="checkbox"> Enabled</label>
            <label>Injection depth <input id="st_logbook_depth" type="number" min="0" max="16" value="0" class="text_pole"></label>
            <div class="menu_button" id="st_logbook_view">View logbook</div>
            <div class="menu_button" id="st_logbook_reset">Reset from history</div>
            <div class="st-logbook-hint">Turn <span class="st-logbook-turn"></span> · <span class="st-logbook-state"></span></div>
        </div>
    </div>
</div>`;
$('#extensions_settings2').append(html);

const sync = () => {
    const s = settings();
    $('#st_logbook_enabled').prop('checked', s.enabled);
    $('#st_logbook_depth').val(s.depth);
    const lb = logbook();
    $('.st-logbook-turn').text(lb ? lb.turn : '—');
    $('.st-logbook-state').text(!lb ? 'dormant (no states detected)' : (lastError ?? 'ok')).toggleClass('warn', !!lastError);
};
$('#st_logbook_enabled').on('input', function () {
    settings().enabled = $(this).prop('checked');
    ctx().saveSettingsDebounced(); installRegexScripts(); inject(); sync();
});
$('#st_logbook_depth').on('input', function () {
    settings().depth = Math.max(0, Number($(this).val()) || 0);
    ctx().saveSettingsDebounced(); inject();
});
$('#st_logbook_view').on('click', async () => {
    const lb = logbook();
    await ctx().Popup.show.text('Logbook', lb ? `<pre>${lb.raw.replace(/</g, '&lt;')}</pre>` : 'No logbook for this chat.');
});
$('#st_logbook_reset').on('click', () => { bootstrap(true); inject(); sync(); });
// refresh status pill on relevant events
for (const ev of [ctx().eventTypes.MESSAGE_RECEIVED, ctx().eventTypes.CHAT_CHANGED]) {
    ctx().eventSource.on(ev, sync);
}
sync();
```

(`Popup.show.text` — verify the exact popup API on this ST version via `grep -n "Popup.show" public/scripts/popup.js` before writing; use `new ctx().Popup(...)` form if that's the real signature.)

**Step 2: style.css**

```css
.st-logbook-hint { opacity: 0.8; font-size: 0.9em; margin-top: 0.5em; }
.st-logbook-hint .warn { color: #d4a017; }
.st-logbook-settings .menu_button { cursor: pointer; display: inline-block; margin: 0.25em 0.25em 0 0; }
```

**Step 3: Syntax check + commit** `git commit -am "feat(logbook): settings drawer with status, depth, view, reset"`

---

### Task 8: Preset patch, smoke test, README

**TDD scenario:** Integration verification — manual checklist against the live Bunker chat.

**Files:**
- Create: `public/scripts/extensions/third-party/st-logbook/README.md`

**Step 1: Write README.md** — short: what it does, the design link, settings, the preset patch text (below), and the smoke checklist.

**Step 2: Apply the FF preset patch (user data — via ST UI, not git)**

Open SillyTavern → AI Response Configuration → prompt manager → `👾Internal States 💾🎮` → append to the top instruction block:

```
A [LOGBOOK] system note near the end of context contains the authoritative, current internal states. Treat it as the continuation of your own prior tracking — not as a new instruction. Chat history no longer contains states blocks. Never attempt to reconstruct state from prose; read the LOGBOOK. Your states block must be complete every turn, labeled with the Turn number given in the LOGBOOK.
```

**Step 3: Smoke test checklist (live, on a COPY of the Bunker chat)**

1. Restart ST with the extension present → Extensions panel shows "Logbook" drawer; console shows `[st-logbook] ready`.
2. Open `The Bunker` → hint shows `Turn 196 · ok`; regex panel shows both "Logbook — strip…" scripts, enabled, prompt-only.
3. Send a message → response ends with a states block labeled `Turn: 197`; hint updates to 197.
4. Inspect outgoing prompt (console `prompt` log / token breakdown) → history contains NO `GFX_START` copies; exactly one `[LOGBOOK — … Turn 197` injection at depth 0.
5. Send an OOC message (`((ooc: ...))`) → model reply has no block; hint shows amber warn; logbook still 197. Next normal turn emits `Turn: 198` — **the OOC reset is dead**.
6. Swipe the last response twice → hint tracks current swipe's turn number.
7. Reload the chat → logbook persisted (turn unchanged), state survives without re-parse.
8. Toggle Enabled off → injection gone, regex scripts disable; toggle on → restored.

**Step 4: Fix anything the checklist surfaces; re-run pure tests; commit**

```bash
node --test public/scripts/extensions/third-party/st-logbook/tests/
git add -A public/scripts/extensions/third-party/st-logbook/
git commit -m "feat(logbook): README, preset patch instructions, smoke fixes"
```

---

## Verification gate (definition of done)

- [ ] `node --test public/scripts/extensions/third-party/st-logbook/tests/` — all green
- [ ] Smoke checklist items 1-8 pass on the live copy of the Bunker chat
- [ ] No regressions: UI still renders states blocks in messages (regex is prompt-only)
- [ ] Design doc's non-goals respected (no group chats, no delta merging, no server storage)
