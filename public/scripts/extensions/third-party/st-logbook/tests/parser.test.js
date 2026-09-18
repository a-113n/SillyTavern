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
    // inner sections all present and the match runs to the GFX_END anchor
    assert.ok(r.gfxBlock.includes('🌌 PHYSICS, ENGINE & WORLD'));
    assert.ok(r.gfxBlock.trim().endsWith('<!-- GFX_END -->'));
});

test('truncated final tail section (no closing details) is still captured', () => {
    const truncated = synthetic.slice(0, synthetic.lastIndexOf('</details>')); // cut last closer
    const r = extractStatesBlock(truncated);
    assert.equal(r.tailBlocks.length, 2);
    assert.ok(r.tailBlocks[1].includes('I held')); // partial content kept
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
