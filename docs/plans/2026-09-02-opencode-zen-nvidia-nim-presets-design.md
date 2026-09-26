# OpenCode Zen + Nvidia NIM as full Chat Completion sources

**Branch:** `feature/opencode-zen-nvidia-nim-presets` (off `release`)
**Date:** 2026-09-02
**Status:** Approved, in implementation

## Goal

Add **OpenCode Zen** and **Nvidia NIM (build.nvidia.com)** as first-class chat completion sources in SillyTavern so they appear alongside OpenAI, Claude, OpenRouter, DeepSeek, xAI, SiliconFlow, MiniMax, Workers AI, etc. in the API panel and the Connection Manager.

Both services expose an OpenAI-compatible API and require only an API key + a model selection — no endpoint variants, no extra config fields.

## Service details

| Source       | Enum (client + server) | API URL constant                                  | Notes                            |
|--------------|------------------------|---------------------------------------------------|----------------------------------|
| OpenCode Zen | `opencode_zen`         | `https://opencode.ai/zen/v1`                      | OpenAI-compatible; model list pulled from `/v1/models` |
| Nvidia NIM   | `nvidia_nim`           | `https://integrate.api.nvidia.com/v1`             | OpenAI-compatible; model list pulled from `/v1/models` |

## Decisions

- **Default models:** empty string (`''`). On first successful Connect, the existing model-fetch logic auto-picks `model_list[0].id`. Same pattern as existing OpenAI-compatible sources.
- **Endpoint variants:** none for either source. Both point to a single URL — no `GLOBAL/CN` selector like SiliconFlow / MiniMax have.
- **Settings form fields:** API key input + model `<select>` only. No extras (no Account ID, no Region, no Project ID).
- **URL visibility:** hardcoded server-side; users never see or edit the URL. (Not Custom-URL configurable.)
- **Connection Manager:** auto-included — `setupConnectAPIMap` iterates `chat_completion_sources` automatically (`slash-commands.js:215-219`).
- **Backwards compatible:** new enum entries are additive. Existing users and exported settings are unaffected.

## Files to change

| #  | File | What changes |
|----|------|-------------|
| 1  | `src/constants.js` | Add `OPENCODE_ZEN`, `NVIDIA_NIM` to `CHAT_COMPLETION_SOURCES` enum (~line 187+). |
| 2  | `src/endpoints/secrets.js` | Add `OPENCODE_ZEN: 'api_key_opencode_zen'`, `NVIDIA_NIM: 'api_key_nvidia_nim'`. |
| 3  | `src/endpoints/backends/chat-completions.js` | (a) Add `API_OPENCODE_ZEN` / `API_NVIDIA_NIM` URL constants; (b) add cases in `getEndpoint` (~line 1740+); (c) add cases in request body builder (~line 2170+); (d) add `/models` fetch + OpenAI-style response normalization (~line 1995+). |
| 4  | `public/scripts/openai.js` | Add to `chat_completion_sources` enum (~line 175+); register settings IDs `opencode_zen_model`, `nvidia_nim_model` (~line 326+); defaults `''` (~line 442+); add case in model-change context-size lookup if applicable; add getModels branches for each (~line 2265, 2304). |
| 5  | `public/scripts/secrets.js` | Mirror client API-key map. |
| 6  | `public/scripts/slash-commands.js` | Likely no manual change — `CONNECT_API_MAP` auto-populates. Verify model-id alias list and `/connect` integration. |
| 7  | `public/scripts/tool-calling.js`, `reasoning.js`, `tokenizers.js`, etc. | Case-by-case grep for `chat_completion_sources.SILICONFLOW` style references that need a matching entry for the new sources. (No changes if the existing source list is a generic capability matrix.) |
| 8  | `public/index.html` | (a) `<option value="opencode_zen">` and `<option value="nvidia_nim">` in the main API source `<select>`; (b) `<div id="opencode_zen_form" data-source="opencode_zen">` and matching `<div>` for nvidia_nim; (c) append `opencode_zen` and `nvidia_nim` to every existing `data-source="..."` range-block list that currently includes similar OpenAI-compatible sources; (d) `<select id="model_opencode_zen_select">` and `<select id="model_nvidia_nim_select">` (empty by default; populated dynamically after Connect). |

## Risks / unknowns

- Some `data-source="..."` lists in `index.html` may be capability-gated (e.g. "supports JSON schema"). Conservative policy: only add to lists that already include *all* current-generation OpenAI-compatible sources (OpenRouter, DeepSeek, xAI, Custom, etc.). Skip capability-restricted blocks.
- `tool-calling.js`, `reasoning.js`, `tokenizers.js` may have provider capability maps. If they key off `chat_completion_sources.SOMETHING` directly (excluding new sources by omission), add the new entries. If they key off generic detection, nothing to do.
- Plugin authors (Smart-Memory, Connection Manager) iterate enum keys automatically — no plugin changes needed.

## Out of scope

- No endpoint variants.
- No default model baked in.
- No new settings persistence fields beyond `opencode_zen_model` and `nvidia_nim_model`.
- No UI localization keys for the new labels (will use `data-i18n` only where the existing sources do).
- No PR upstream today — work stays on the feature branch for user-driven review.

## Verification plan

1. `npm run lint` (if present in package.json — verify before claiming done).
2. Static checks: server-side syntax validation by importing the backend (or simply running the dev server and observing console).
3. Manual smoke check (described, not run by the agent): boot server, set source to OpenCode Zen → enter API key → Connect → confirm model dropdown populates → send a test prompt → confirm reply. Same for Nvidia NIM.
4. Final report to user lists changed files + line counts + the verification evidence so they can run a manual smoke test.

## Implementation order (bottom-up, smallest blast radius first)

1. `src/constants.js` (enum) — pure data addition.
2. `src/endpoints/secrets.js` (key constants) — pure data.
3. `src/endpoints/backends/chat-completions.js` (URL + 3 switches).
4. `public/scripts/secrets.js` (client key map).
5. `public/scripts/openai.js` (enum, settings IDs, defaults, getModels branches).
6. `public/scripts/slash-commands.js` (verify auto-propagation; add manual entries only if needed).
7. Misc client files (grep for required references).
8. `public/index.html` (dropdown, form blocks, range-block source lists).
9. Lint and verify.
10. Commit and report.
