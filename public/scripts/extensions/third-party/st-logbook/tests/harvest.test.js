// Regression tests for the index.js harvest glue.
// index.js is browser glue; we stub the SillyTavern/jQuery globals it touches
// so the harvest control flow itself can be unit tested in node.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const block = readFileSync(join(fixtures, 'bunker-real-block.html'), 'utf8');
const turnOf = (text) => Number(text.match(/Turn:\s*(\d+)/)[1]);

// --- global stubs recorded per-test ---
const ui = { textCalls: [] };
const makeCtx = (chat, chatMetadata) => ({
    chat, chatMetadata,
    extensionSettings: { 'st-logbook': { enabled: true, depth: 0 } },
    saveMetadataDebounced: () => {},
    setExtensionPrompt: () => {},
});

before(() => {
    globalThis.SillyTavern = { getContext: () => globalThis.__ctx };
    // jQuery(cb): never invoke cb — skips all DOM wiring at import time.
    globalThis.jQuery = () => {};
    // $ used by syncStatus(); record turn-counter writes.
    globalThis.$ = (sel) => ({
        prop() { return { prop() {} }; },
        val() { return { val() {} }; },
        text(v) { if (sel === '.st-logbook-turn') ui.textCalls.push(String(v)); return this; },
        toggleClass() { return this; },
    });
});

const load = (ctx) => {
    globalThis.__ctx = ctx;
    // re-import fresh module state per call
    delete globalThis.__stLogbook;
    return import('../index.js?' + Math.random());
};

test('dormant chat activates when the model first emits a states block', async () => {
    const chat = [
        { is_user: false, mes: 'Welcome to the bunker. (greeting — no states)' },
        { is_user: true, mes: 'I try the door.' },
        { is_user: false, mes: block.replace(/Turn:\s*\d+/, 'Turn: 1') },
    ];
    const chatMetadata = {};
    const mod = await load(makeCtx(chat, chatMetadata));
    await mod.harvest(2);
    assert.ok(chatMetadata.logbook, 'logbook should have been seeded from the tail message');
    assert.equal(chatMetadata.logbook.sourceMesId, 2);
    assert.equal(chatMetadata.logbook.turn, 1);
    // no double-increment: seeding and harvest describe the same message
    assert.equal(chatMetadata.logbook.turn, 1);
});

test('active logbook updates and refreshes the drawer turn counter on harvest', async () => {
    const seededRaw = block.replace(/Turn:\s*\d+/, 'Turn: 5');
    const chat = [
        { is_user: false, mes: 'greeting' },
        { is_user: false, mes: seededRaw },
        { is_user: true, mes: 'go' },
        { is_user: false, mes: block.replace(/Turn:\s*\d+/, 'Turn: 6') },
    ];
    const chatMetadata = { logbook: { turn: 5, raw: seededRaw, sourceMesId: 1, contentHash: 'x', updatedAt: 0 } };
    const mod = await load(makeCtx(chat, chatMetadata));
    ui.textCalls.length = 0;
    await mod.harvest(3);
    assert.equal(chatMetadata.logbook.turn, 6, 'turn should advance');
    assert.equal(chatMetadata.logbook.sourceMesId, 3);
    assert.ok(ui.textCalls.includes('6'), `drawer turn counter should show 6, got [${ui.textCalls}]`);
});

test('dormant chat whose tail has no block stays dormant (no stale seeding)', async () => {
    const chat = [
        { is_user: false, mes: 'greeting without states' },
        { is_user: false, mes: 'plain reply, no block either' },
    ];
    const chatMetadata = {};
    const mod = await load(makeCtx(chat, chatMetadata));
    await mod.harvest(1);
    assert.equal(chatMetadata.logbook, undefined);
});
