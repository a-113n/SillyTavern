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

// Canonical section inventory: label as it appears after <summary> → canonical name.
const SECTION_LABELS = new Map([
    ['👤 NPC AGENDAS', 'NPC AGENDAS'],
    ['👤 NPC LOCATIONS', 'NPC LOCATIONS'],
    ['🏳️ FACTIONS', 'FACTIONS'],
    ['📜 QUESTS', 'QUESTS'],
    ['🎒 INV & SKILLS', 'INV & SKILLS'],
    ["📓 GM'S NOTEBOOK", "GM'S NOTEBOOK"],
    ['🌎 WORLD SIM', 'WORLD SIM'],
    ['🌌 PHYSICS, ENGINE & WORLD', 'PHYSICS, ENGINE & WORLD'],
    ['💚 BONDS', 'BONDS'],
    ["🔫 CHEKHOV'S GUN", 'CHEKHOV'],
    ['🧠 INTERNAL THOUGHTS', 'INTERNAL THOUGHTS'],
    ['🎲 DND TASK SIM', 'DND TASK SIM'],
]);

/**
 * Inventory which canonical sections a states payload contains.
 * @param {string} full gfxBlock + tailBlocks concatenation
 * @returns {{ present: string[], missing: string[] }} canonical names
 */
export function validateSections(full) {
    // tolerate whitespace variants like '<summary> 🎒 INV & SKILLS'
    const normalized = String(full ?? '').replace(/<summary>\s+/g, '<summary>');
    const present = [];
    for (const [label, name] of SECTION_LABELS) {
        if (normalized.includes('<summary>' + label)) present.push(name);
    }
    return { present, missing: [...SECTION_LABELS.values()].filter(n => !present.includes(n)) };
}
