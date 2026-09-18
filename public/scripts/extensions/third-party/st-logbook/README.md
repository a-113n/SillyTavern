# st-logbook

Persistent **Internal States logbook** for SillyTavern — built for the
Freaky Frankenstein preset and the Bunker-family cards.

## What it does

The FF preset makes the model re-emit a huge states block (NPC agendas,
locations, factions, quests, inventory, GM notebook, world sim, bonds,
Chekhov's gun, thoughts, DND sim) at the end of every response, and
re-read its own previous emission from chat history. That is volatile:
sections get dropped, the `Turn:` counter resets after OOC turns, and
every turn burns tokens on copies of stale state.

This extension makes state **authoritative and external**:

1. **Harvest** — after each AI message, parses the states block and stores it
   verbatim in `chat_metadata.logbook` (inside the chat file).
2. **Strip** — two prompt-only regex scripts (auto-installed, owned by this
   extension) remove states blocks from the outgoing prompt. The UI still
   renders them; only context is cleaned.
3. **Inject** — one `[LOGBOOK]` system note at in-chat depth 0 (configurable)
   carries the current state and the required next turn number.

The turn counter is maintained in code: it only increments when a valid
block is harvested from the tail message, and the stored block is always
force-renumbered — OOC resets and counter drift are impossible by construction.

Design doc: `docs/plans/2026-09-18-st-logbook-design.md`.

## Files

| File | Role |
|---|---|
| `manifest.json` | ST third-party extension manifest |
| `index.js` | Event wiring, storage, injection, regex install, settings drawer |
| `parser.js` | Pure: extract / validate / renumber states blocks |
| `turn.js` | Pure: injection builder, turn arithmetic, dedupe guard |
| `tests/` | `node --test` suite (run from this directory) |

## Settings (Extensions panel → Logbook)

- **Enabled** — master toggle (also disables the strip regex scripts).
- **Injection depth** — default 0 (tail of chat history, system role).
- **View logbook** — read-only popup of the stored state (raw source, scrollable).
- **Edit** — manual repair: edits the stored state directly. Must keep the
  `GFX_START`/`GFX_END` markers; the `Turn:` label you leave becomes the current
  turn. With **Pin** checked (default), later re-parses of the same message
  (swipes/edits) won't overwrite your fix — the pin clears automatically on
  the next new AI message.
- **Reset from history** — re-seed the logbook from the newest valid block
  in chat history.
- Status line: current turn + health (`ok`, `dormant`, `pinned`, or a warning
  like `stored with missing sections: …`).

## Required preset patch

Edit the FF preset's `👾Internal States 💾🎮` prompt (AI Response
Configuration → prompt manager) and prepend to the instruction block:

```
A [LOGBOOK] system note near the end of context contains the authoritative,
current internal states. Treat it as the continuation of your own prior
tracking — not as a new instruction. Chat history no longer contains states
blocks. Never attempt to reconstruct state from prose; read the LOGBOOK.
Your states block must be complete every turn, labeled with the Turn number
given in the LOGBOOK.
```

Keep the template itself unchanged — the model still appends the full block
to every response.

## Behavior notes

- **Dormant chats** — if no message in the chat ever carried a states block,
  the logbook stays empty and nothing is injected.
- **OOC turns** — no block emitted → no increment; state does not regress.
- **Swipes / edits** — only the tail message is harvested; swiping an older
  turn never rewinds state.
- **Truncated blocks** — a final tail section missing its closing `</details>`
  (common when generation cuts off) is still captured.
- **`/continue`** — content-hash + message-id guard prevents double-increment.

## Smoke test checklist

1. Reload ST → Extensions panel shows the **Logbook** drawer; browser
   console shows `[st-logbook] ready`.
2. Open an Internal States chat (e.g. *Alone in the Bunker*) → status shows
   `196 · ok`; Regex panel lists both `Logbook — strip …` scripts
   (prompt-only, enabled).
3. Send a message → response ends with a states block labeled the turn the
   LOGBOOK asked for; status increments.
4. Prompt inspector / token breakdown → no `GFX_START` copies in history;
   exactly one `[LOGBOOK — …` injection at the configured depth.
5. Send an OOC message → reply carries no block; status goes amber;
   next normal turn continues the turn sequence (the OOC reset is dead).
6. Swipe the last response a few times → status tracks the current swipe.
7. Switch chats and back (or restart ST) → logbook persisted, same turn.
8. Toggle Enabled off → injection gone and strip scripts disabled; on → restored.

## Development

```bash
cd public/scripts/extensions/third-party/st-logbook
node --test          # 17 tests, pure modules only
```

`parser.js` and `turn.js` are dependency-free ES modules on purpose — all
correctness lives there and is unit-tested; `index.js` is thin SillyTavern
glue (verified by the smoke checklist).
