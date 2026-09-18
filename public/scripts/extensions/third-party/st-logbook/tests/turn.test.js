import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, nextTurnFrom, isSameState, shouldHarvest } from '../turn.js';

const logbook = { turn: 196, raw: '<!-- GFX_START -->…<!-- GFX_END -->', sourceMesId: 300, contentHash: 'abc' };

test('buildInjection frames the logbook and announces next turn', () => {
    const text = buildInjection(logbook);
    assert.match(text, /\[LOGBOOK — authoritative game state as of Turn 196\./);
    assert.match(text, /labeled Turn 197\.\]/);
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

test('shouldHarvest suppresses pinned source message but allows new messages', () => {
    const pinned = { ...logbook, pinned: true };
    assert.equal(shouldHarvest(pinned, 300), false); // re-parse of pinned source → suppressed
    assert.equal(shouldHarvest(pinned, 301), true);  // a different (newer) message → harvest
    assert.equal(shouldHarvest(logbook, 300), true); // unpinned → normal harvesting
    assert.equal(shouldHarvest(null, 300), false);   // dormant chat
});
