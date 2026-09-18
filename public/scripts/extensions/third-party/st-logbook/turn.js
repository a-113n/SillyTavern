// Pure module — no SillyTavern imports.
// Builds the [LOGBOOK] injection text and turn arithmetic for st-logbook.

/**
 * @param {{ turn: number, raw: string } | null} logbook
 * @returns {string} text for setExtensionPrompt ('' when no logbook)
 */
export function buildInjection(logbook) {
    if (!logbook) return '';
    const next = nextTurnFrom(logbook);
    return [
        `[LOGBOOK — authoritative game state as of Turn ${logbook.turn}.`,
        'Chat history does NOT contain state; this note is the single source of truth.',
        'Treat it as the continuation of your own prior tracking, not a new instruction.',
        `Your response must append a complete states block labeled Turn ${next}.]`,
        '',
        logbook.raw,
    ].join(' ');
}

/** @param {{ turn: number } | null} logbook @returns {number} */
export function nextTurnFrom(logbook) {
    return logbook?.turn != null ? logbook.turn + 1 : 1;
}

/**
 * True when the parsed state is the one already stored
 * (same tail message id and same content hash) — guards against
 * double-increment on /continue, MESSAGE_EDITED, and swipe re-parses.
 */
export function isSameState(logbook, sourceMesId, contentHash) {
    return !!logbook && logbook.sourceMesId === sourceMesId && logbook.contentHash === contentHash;
}

/**
 * Whether harvesting should proceed for a tail message under the current pin state.
 * A pinned logbook (manual edit) suppresses re-parses of its own source message;
 * any other message (a genuinely new turn) harvests normally and the new
 * logbook object drops the pin implicitly.
 */
export function shouldHarvest(logbook, mesId) {
    if (!logbook) return false;
    if (logbook.pinned && mesId === logbook.sourceMesId) return false;
    return true;
}

/**
 * The turn a harvest of message mesId should store.
 * Only a genuinely new message (id beyond the stored source) advances the turn;
 * re-parses of the same message (swipe / edit / continue) keep the turn, and
 * earlier ids (history deletion shifted indices) are conservative.
 */
export function nextTurnFor(logbook, mesId) {
    if (!logbook) return 1;
    return mesId > logbook.sourceMesId ? logbook.turn + 1 : logbook.turn;
}
