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
