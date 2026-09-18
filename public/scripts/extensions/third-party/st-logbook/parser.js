// Pure module — no SillyTavern imports. Safe to unit test.
// Extracts the Freaky Frankenstein / Bunker-family "Internal States" payload
// from an AI message: the GFX-wrapped core block plus position-independent
// tail sections (BONDS / CHEKHOV / THOUGHTS / DND).

const GFX_RE = /<!-- GFX_START -->[\s\S]*?<!-- GFX_END -->/;
const TAIL_SUMMARIES = ['💚 BONDS', "🔫 CHEKHOV'S GUN", '🧠 INTERNAL THOUGHTS', '🎲 DND TASK SIM'];
// (?:</details>|$) tolerates a truncated final section (no closing tag).
const TAIL_RE = new RegExp(
    '<details>\\s*<summary>\\s*(?:' +
    TAIL_SUMMARIES.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
    ')[\\s\\S]*?(?:</details>|$)',
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
