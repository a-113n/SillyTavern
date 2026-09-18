# ST Logbook Extension — Design

**Date:** 2026-09-18
**Status:** Validated via brainstorm session
**Target:** SillyTavern (this repo), third-party extension

## Problem

The Freaky Frankenstein preset (`FF-RPG.json`) tracks RPG state (NPC agendas, locations,
factions, quests, inventory, GM notebook, world sim, bonds, Chekhov's gun, thoughts, DND sim)
via a giant HTML block the model must re-emit at the end of **every** response, re-reading its
own previous emission from chat history.

State persistence is pure chat-recency and therefore volatile:

- Model drops sections; whole GFX block sometimes omitted entirely.
- `Turn:` counter resets after OOC turns (e.g. `Turn: 8` after `Turn: 123`).
- Every turn burns ~1-2k tokens re-copying state; N copies live in context.
- No regex scripts exist today despite the preset demanding them (token bloat).
- Manual repair is the current mitigation (`.pi/skills/st-internal-states-repair`).

## Goal

Store the latest states block **outside the chat transcript** (a "logbook"), strip old blocks
from the outgoing prompt, and inject the stored logbook each turn so the model *reads*
authoritative state instead of *reconstructing* it.

## Chosen Approach

Custom third-party extension (Option A). Alternatives considered and rejected:

- **B: Pure STscript (QR + setvar/getvar)** — clunky parsing, fragile to format drift, painful
  swipe handling.
- **C: Regex-only stopgap** — token savings but state still lives-or-dies on one emission.

Key loop decision: the model **still re-emits the full states block every turn** (Option 1, not
deltas) — stored verbatim, format-agnostic, GFX rendering in UI preserved. Delta-merging
explicitly rejected as fragile.

Injection placement: **in-chat depth 0, system role** (Option a), configurable in settings.
Lands at the tail of chat history, just before absolute-depth-0 injections (e.g. BOLT CoT).

## Architecture

```
public/scripts/extensions/third-party/st-logbook/
├── manifest.json      # display_name "Logbook", loading_order ~150 (after regex)
├── index.js           # wiring: events, injection, settings UI  (ST glue only)
├── parser.js          # PURE: extract/validate/renumber states blocks
├── turn.js            # PURE: turn arithmetic + injection text builders
└── style.css          # settings drawer + status pill
```

Pure/wiring split is the TDD seam: `parser.js` and `turn.js` are dependency-free ES modules
testable in isolation (`*.test.js` beside them, node --test / bun — no build step).

### parser.js API

- `extractStatesBlock(mes)` → `{ gfxBlock, tailBlocks, full }`
  - GFX: `<!-- GFX_START -->…<!-- GFX_END -->` (non-greedy `[\s\S]*?`).
  - Tail sections position-independent by summary label:
    `💚 BONDS | 🔫 CHEKHOV'S GUN | 🧠 INTERNAL THOUGHTS | 🎲 DND TASK SIM`
    (DND sometimes sits at top of message — handled).
- `validateSections(block)` → canonical-section inventory (13-section canon).
- `renumberTurn(block, n)` → force-write `Turn: n` label.

### turn.js API

- `buildInjection(logbook, nextTurn)` → `[LOGBOOK]` text.
- `nextTurnFrom(logbook)` → counter arithmetic.

## Storage

`chat_metadata.logbook = { turn: N, raw: "<verbatim HTML>", sourceMesId, updatedAt, contentHash }`

- Saved in the chat file itself via `saveMetadataDebounced()` — per-chat, survives restarts,
  no server component.

## Data Flow (turn lifecycle)

1. **`CHAT_CHANGED`** — backward scan of `chat[]` for newest AI message with a valid block;
   seed logbook if empty (existing logbook wins — may be newer than visible messages after
   deletions). No markers anywhere → extension dormant for that chat.
2. **`GENERATION_STARTED`** — `setExtensionPrompt('logbook', buildInjection(...),
   IN_CHAT, depth 0, 'system')`. Injection ≈
   `[LOGBOOK — authoritative game state as of Turn {N}. Chat history does NOT contain state;
   this note is the single source of truth. Your response must append a complete states block
   labeled Turn {N+1}.]` + verbatim HTML.
3. **`MESSAGE_RECEIVED`** — parse finalized (non-streaming race) tail message. Valid → store
   verbatim with Turn force-renumbered to `N+1`, bump `turn`, save. Invalid → logbook
   unchanged (state never regresses), console warning, amber status pill.
4. **`MESSAGE_SWIPED` / `MESSAGE_EDITED`** — re-parse current swipe/content of the tail
   message only. Editing older messages never touches the logbook (tail-only parsing keeps
   it monotonic). `sourceMesId` + content hash prevents double-increment on `/continue`.

## Turn Counter

- Seeded from seed block's label; increments **only** on valid tail-block parse.
- OOC / failed / prose-only turns → no increment (canon preserved, now code-enforced).
- Emitted number is irrelevant — force-renumbered to `N+1`. Drift impossible; classic OOC
  reset (`Turn: 8` after `Turn: 123`) never reaches the prompt because history is stripped.

## Preset Edits (data change, pasted into `👾Internal States 💾🎮`)

- "A `[LOGBOOK]` system note near the end of context contains the authoritative current
  internal states. Treat it as the continuation of your own prior tracking."
- "Chat history no longer contains states blocks. Never reconstruct state from prose; read
  the LOGBOOK."
- Template unchanged — model still emits the full block at message end.

## History Stripping (auto-installed regex scripts)

Written into `extension_settings.regex`, owned by the extension, idempotent on update:

1. `Logbook — strip GFX block`: `<!-- GFX_START -->[\s\S]*?<!-- GFX_END -->` → empty.
2. `Logbook — strip state tail sections`: `<details>` blocks with summaries matching the
   four tail sections (position-independent).

Both: placement = context only, `markdownOnly: false`, `promptOnly: true`, all depths.
UI keeps rendering blocks from live messages; only the outgoing prompt is cleaned.
Context ends up with exactly one state copy (the injection).

## Error Handling / Degradation Ladder

1. Valid block → update logbook.
2. Block present, sections missing → store anyway; pill shows missing canonical sections;
   next turn's template instruction ("generate every block; write 'None'") usually self-heals.
3. No block → keep last good state, amber pill. Same failure as today but state never
   regresses.

Edge cases:

- **Streaming** — parse only on finalized message.
- **`/continue`** — merged result re-parsed; hash-guard prevents double increment.
- **Impersonation / user messages** — never carry blocks; no change (canon).
- **Quiet generations** — act only on normal/first_message types.
- **Corrupted tail on bootstrap** — backward scan skips bad messages.
- **Deleted trailing messages** — logbook wins; "Reset from history" button forces re-seed.
- **New chat** — first AI message seeds at its emitted turn (typically 1).

## Non-Goals

Group chats (multi-char blocks), structured/delta merging, editable logbook UI (read-only
viewer only), server-side storage.

## Testing

TDD on the pure modules; wiring stays thin and manually smoke-tested.

Fixtures from real data (`data/default-user/chats/The Bunker/*.jsonl`) exercising:

1. Happy path — full extraction, renumber 123→124.
2. OOC-break chat — seeds 123, forces 124.
3. Whole GFX block missing, tail sections present → invalid, logbook untouched.
4. DND at top vs bottom → both parsed.
5. Nested `<details>` — inner sections don't terminate outer GFX match.
6. Swipes — only current swipe parses.
7. Renumber edges — missing label, malformed label (`Turn: twelve`), label mid-block.

Verification gate: all parser/turn tests green + one live smoke run in the real Bunker chat.
