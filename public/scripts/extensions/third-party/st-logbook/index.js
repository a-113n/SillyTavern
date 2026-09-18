// st-logbook — Internal States logbook extension.
// Design: docs/plans/2026-09-18-st-logbook-design.md
// Stores the newest Internal States block in chat_metadata, strips states
// from the outgoing prompt (prompt-only regex scripts), and re-injects the
// authoritative logbook at in-chat depth 0 so the model reads state instead
// of reconstructing it from its own past responses.
import { extractStatesBlock, validateSections, extractTurn, renumberTurn } from './parser.js';
import { buildInjection, nextTurnFrom, isSameState } from './turn.js';

const MODULE = 'st-logbook';
const IN_CHAT = 1;      // extension_prompt_types.IN_CHAT (public/script.js)
const ROLE_SYSTEM = 0;  // extension_prompt_roles.SYSTEM
const AI_OUTPUT = 2;    // regex_placement.AI_OUTPUT (regex/engine.js)

const REGEX_TEMPLATES = [{
    scriptName: 'Logbook — strip GFX block',
    findRegex: '/<!-- GFX_START -->[\\s\\S]*?<!-- GFX_END -->/g',
}, {
    scriptName: 'Logbook — strip state tail sections',
    findRegex: '/<details>\\s*<summary>\\s*(?:\u{1F49A} BONDS|\u{1F52B} CHEKHOV\'S GUN|\u{1F9E0} INTERNAL THOUGHTS|\u{1F3B2} DND TASK SIM)[\\s\\S]*?(?:<\\/details>|$)/g',
}];

const DEFAULTS = { enabled: true, depth: 0 };
let lastError = null;

const ctx = () => SillyTavern.getContext();

function settings() {
    const es = ctx().extensionSettings;
    es[MODULE] ??= structuredClone(DEFAULTS);
    return es[MODULE];
}

function logbook() {
    return ctx().chatMetadata?.logbook ?? null;
}

/** Prompt-only context strippers, owned by this extension; idempotent upsert. */
function installRegexScripts() {
    const es = ctx().extensionSettings;
    es.regex ??= [];
    for (const tpl of REGEX_TEMPLATES) {
        let entry = es.regex.find(r => r.scriptName === tpl.scriptName);
        if (!entry) {
            entry = {};
            es.regex.push(entry);
        }
        Object.assign(entry, {
            id: entry.id ?? crypto.randomUUID(),
            scriptName: tpl.scriptName,
            findRegex: tpl.findRegex,
            replaceString: '',
            trimStrings: [],
            placement: [AI_OUTPUT],
            disabled: !settings().enabled,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: 0,
            maxDepth: -1,
        });
    }
    ctx().saveSettingsDebounced();
}

function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
}

/** Scan backwards for the newest AI message with a valid block; seed the logbook. */
function bootstrap(force = false) {
    const { chat, chatMetadata, saveMetadataDebounced } = ctx();
    if (!chat || !chatMetadata) return;
    if (!force && logbook()) return;
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m?.is_user) continue;
        const parsed = extractStatesBlock(String(m.mes ?? ''));
        if (parsed) {
            const turn = extractTurn(parsed.full) ?? 1;
            chatMetadata.logbook = {
                turn,
                raw: renumberTurn(parsed.full, turn),
                sourceMesId: i,
                contentHash: hash(parsed.full),
                updatedAt: Date.now(),
            };
            saveMetadataDebounced();
            lastError = null;
            return;
        }
    }
    // No markers anywhere → dormant chat (no logbook, no injection).
    chatMetadata.logbook = undefined;
}

function inject() {
    const value = settings().enabled ? buildInjection(logbook()) : '';
    ctx().setExtensionPrompt(MODULE, value, IN_CHAT, settings().depth, false, ROLE_SYSTEM, null);
}

/**
 * Parse the tail AI message; update the logbook only on a valid block.
 * Tail-only parsing keeps the logbook monotonic (swiping older turns never rewinds state).
 */
function harvest(messageId) {
    if (!settings().enabled) return;
    const lb = logbook();
    if (!lb) return; // dormant chat
    const { chat, chatMetadata, saveMetadataDebounced } = ctx();
    const i = messageId ?? chat.length - 1;
    const m = chat[i];
    if (!m || m.is_user || i !== chat.length - 1) return;
    const parsed = extractStatesBlock(String(m.mes ?? ''));
    if (!parsed) {
        lastError = 'tail message has no states block — logbook unchanged';
        console.warn(`[${MODULE}] ${lastError}`);
        return;
    }
    const h = hash(parsed.full);
    if (isSameState(lb, i, h)) return;
    const next = nextTurnFrom(lb);
    chatMetadata.logbook = {
        turn: next,
        raw: renumberTurn(parsed.full, next),
        sourceMesId: i,
        contentHash: h,
        updatedAt: Date.now(),
    };
    const inv = validateSections(parsed.full);
    lastError = inv.missing.length
        ? `stored with missing sections: ${inv.missing.join(', ')}`
        : null;
    if (lastError) console.warn(`[${MODULE}] ${lastError}`);
    saveMetadataDebounced();
    inject();
}

function onChatChanged() {
    bootstrap();
    lastError = null;
    inject();
    syncStatus();
}

function syncStatus() {
    const s = settings();
    $('#st_logbook_enabled').prop('checked', s.enabled);
    $('#st_logbook_depth').val(s.depth);
    const lb = logbook();
    $('.st-logbook-turn').text(lb ? lb.turn : '—');
    const state = !lb ? 'dormant (no states detected)' : (lastError ?? 'ok');
    $('.st-logbook-state').text(state).toggleClass('warn', !!lastError && !!lb);
}

const DRAWER_HTML = `
<div class="st-logbook-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Logbook</b>
            <div class="ta-right">
                <span class="st-logbook-turn"></span> · <span class="st-logbook-state"></span>
            </div>
        </div>
        <div class="inline-drawer-content">
            <label><input id="st_logbook_enabled" type="checkbox"> <span>Enabled</span></label>
            <label>Injection depth <input id="st_logbook_depth" type="number" min="0" max="16" step="1" class="text_pole" style="width:4em"></label>
            <div>
                <div class="menu_button" id="st_logbook_view">View logbook</div>
                <div class="menu_button" id="st_logbook_reset">Reset from history</div>
            </div>
            <div class="st-logbook-hint">Stores the Internal States block in chat metadata and injects it at depth <span class="st-logbook-depth"></span>; strips states from prompt history.</div>
        </div>
    </div>
</div>`;

jQuery(() => {
    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
    eventSource.on(eventTypes.GENERATION_STARTED, () => inject());
    eventSource.on(eventTypes.MESSAGE_RECEIVED, id => harvest(id));
    eventSource.on(eventTypes.MESSAGE_EDITED, id => harvest(id));
    eventSource.on(eventTypes.MESSAGE_SWIPED, id => harvest(id));
    eventSource.on(eventTypes.MESSAGE_SWIPED, () => syncStatus());
    installRegexScripts();
    onChatChanged();

    $('#extensions_settings2').append(DRAWER_HTML);
    $('#st_logbook_enabled').on('input', function () {
        settings().enabled = $(this).prop('checked');
        ctx().saveSettingsDebounced();
        installRegexScripts();
        inject();
        syncStatus();
    });
    $('#st_logbook_depth').on('input', function () {
        settings().depth = Math.max(0, Math.min(16, Number($(this).val()) || 0));
        ctx().saveSettingsDebounced();
        inject();
        $('.st-logbook-depth').text(settings().depth);
    });
    $('#st_logbook_view').on('click', async () => {
        const lb = logbook();
        const body = lb
            ? `<div class="st-logbook-view"><code>${lb.raw.replace(/</g, '&lt;')}</code></div>`
            : 'No logbook for this chat.';
        await ctx().Popup.show.text('Logbook', body, { wide: true, large: true });
    });
    $('#st_logbook_reset').on('click', () => {
        bootstrap(true);
        inject();
        syncStatus();
        toastr.info('Logbook re-seeded from chat history');
    });
    syncStatus();
    console.debug(`[${MODULE}] ready`);
});
