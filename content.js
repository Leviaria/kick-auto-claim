// Copyright (c) 2026 Leviaria. MIT License.
(function () {
    'use strict';
 
    let settings = { enabled: true, daily: true, events: true, drops: true };
    const moduleEnabled = name => settings.enabled && settings[name];
    const API = 'https://web.kick.com/api/v1';
    const EP_CHALLENGES  = API + '/gamification/challenges';
    const EP_CH_CLAIM    = (id) => `${API}/gamification/challenges/${encodeURIComponent(id)}/claim`;
    const EP_DROPS       = API + '/drops/progress';
    const EP_DROPS_CLAIM = API + '/drops/claim';
 
    const LOG = '[Leviaria Auto-Claim]';
    const log = (...a) => console.log(LOG, ...a);
    const TAB_ID = Math.random().toString(36).slice(2);
    const REQUEST_TIMEOUT_MS = 20_000;
    let currentSessionToken = null;
    let currentSessionKey = null;
 
    function sessionToken() {
        const m = document.cookie.match(/(?:^|;\s*)session_token=([^;]+)/);
        try { return m ? decodeURIComponent(m[1]) : null; }
        catch (e) { return null; }
    }
    async function prepareSession() {
        const token = sessionToken();
        if (!token) { currentSessionToken = null; currentSessionKey = null; return null; }
        if (token !== currentSessionToken) {
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
            if (sessionToken() !== token) return null;
            currentSessionKey = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
            currentSessionToken = token;
        }
        return token;
    }
    function apiHeaders(extra, tok) {
        const h = Object.assign({ 'Accept': 'application/json', 'x-app-platform': 'web' }, extra || {});
        if (tok) h['Authorization'] = 'Bearer ' + tok;
        return h;
    }
    async function apiRequest(url, method, body) {
        const token = sessionToken();
        if (!token) throw new Error('No Kick session');
        const controller = new AbortController();
        let timeout;
        try {
            return await Promise.race([
                (async () => {
                    const r = await fetch(url, {
                        method, credentials: 'include', signal: controller.signal,
                        headers: apiHeaders(method === 'POST' ? { 'Content-Type': 'application/json' } : {}, token),
                        ...(method === 'POST' ? { body: body ? JSON.stringify(body) : null } : {}),
                    });
                    let data = null;
                    try { data = await r.json(); }
                    catch (e) { if (r.ok && method === 'GET') throw new Error('Invalid JSON response'); }
                    if (sessionToken() !== token) throw new Error('Kick session changed during request');
                    return { ok: r.ok, status: r.status, headers: r.headers, json: async () => data };
                })(),
                new Promise((_, reject) => {
                    timeout = setTimeout(() => {
                        controller.abort();
                        reject(new Error('API request timed out after 20 seconds'));
                    }, REQUEST_TIMEOUT_MS);
                }),
            ]);
        } finally { clearTimeout(timeout); }
    }
    const apiGet = (url) => apiRequest(url, 'GET');
    const apiPost = (url, body) => {
        if (!settings.enabled) throw new Error('Auto-claim is paused');
        if (url === EP_DROPS_CLAIM && !settings.drops) throw new Error('Drops are paused');
        return apiRequest(url, 'POST', body);
    };
 
    const readState = (key) => {
        try {
            const s = JSON.parse(localStorage.getItem(key));
            return s && !Array.isArray(s) && currentSessionKey && sessionToken() === currentSessionToken && s.sessionKey === currentSessionKey ? s : {};
        }
        catch (e) { return {}; }
    };
    const writeState = (key, patch) => {
        const next = Object.assign({}, readState(key), patch, { sessionKey: currentSessionKey });
        try { localStorage.setItem(key, JSON.stringify(next)); }
        catch (e) { log('Unable to save local state.'); }
        return next;
    };
    const inBackoff  = (key) => { const s = readState(key); return typeof s.backoffUntil === 'number' && Date.now() < s.backoffUntil; };
    const setBackoff = (key, ms) => writeState(key, { backoffUntil: Date.now() + ms });
 
    const LOCK_TTL_MS = 60_000;
    const readLock = (key) => { try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; } };
    const ownsLock = (key) => { const l = readLock(key); return !!l && l.tab === TAB_ID && Date.now() - l.ts < LOCK_TTL_MS; };
    function acquireLock(key) {
        const now = Date.now();
        const held = readLock(key);
        if (held && held.tab !== TAB_ID && now - held.ts < LOCK_TTL_MS) return false;
        try { localStorage.setItem(key, JSON.stringify({ ts: now, tab: TAB_ID })); } catch (e) { return false; }
        return ownsLock(key);
    }
    const refreshLock = (key) => { if (ownsLock(key)) { try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), tab: TAB_ID })); } catch (e) {} } };
    const releaseLock = (key) => { const l = readLock(key); if (l && l.tab === TAB_ID) { try { localStorage.removeItem(key); } catch (e) {} } };
 
    async function withModuleLock(key, run, retry) {
        try {
            if (navigator.locks && typeof navigator.locks.request === 'function') {
                return await navigator.locks.request(key, { ifAvailable: true }, lock => lock ? run() : retry());
            }
            return await run();
        } catch (e) { log('Module lock error:', e.message); retry(); }
    }
 
    const timers = {};
    const nextChecks = {};
    function scheduleNext(name, fn, ms, minMs, maxMs) {
        if (!moduleEnabled(name)) return;
        const delay = Math.max(minMs, Math.min(Number.isFinite(ms) ? ms : maxMs, maxMs));
        if (timers[name]) clearTimeout(timers[name]);
        nextChecks[name] = Date.now() + delay;
        timers[name] = setTimeout(() => { delete timers[name]; delete nextChecks[name]; void fn(); }, delay);
    }
 
    async function refreshRewardUI() { return false; }
    function watchRewardCache() {}

    const D_STATE = 'psKickDailyReward';
    const D_LOCK  = 'psKickDailyRewardLock';
    const D_POLL_IDLE_MS   = 15 * 60_000;
    const D_POLL_NEAR_MS   = 30_000;
    const D_ERROR_BACKOFF_MS = 30 * 60_000;
    const D_FALLBACK_RESET = { h: 0, m: 2 };
    let dailyRunning = false;
 
    const dailyClaimedNow = () => { const s = readState(D_STATE); return typeof s.claimedUntil === 'number' && Date.now() < s.claimedUntil; };
    const dailySchedule = (ms) => scheduleNext('daily', dailyCycle, ms, 1000, 6 * 60 * 60_000);
 
    function fallbackResetMs(from = Date.now()) {
        const d = new Date(from);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, D_FALLBACK_RESET.h, D_FALLBACK_RESET.m, 0, 0);
    }
    function dailyResetMs(ch) {
        const ends = ch && ch.window && ch.window.ends_at;
        const t = ends ? Date.parse(ends) : NaN;
        return Number.isFinite(t) ? t + 60_000 : fallbackResetMs();
    }
    const dailyRewardName = (o) => {
        try {
            const w = o && (o.winner || o.reward || (o.data && (o.data.winner || o.data.reward)));
            if (!w) return null;
            const name = w.name || w.title || w.emote_name || w.label;
            if (typeof name === 'string' && name.trim()) return name.trim();
            const match = String(w.card_url || '').match(/\/cards\/([^/?#]+?)_[A-Za-z]+_card_/);
            return match ? decodeURIComponent(match[1]).replace(/_/g, ' ') : null;
        }
        catch (e) { return null; }
    };
 
    function recordDailyClaim(ch, claimedAt) {
        const reset = dailyResetMs(ch);
        const prior = readState(D_STATE);
        const sameChallenge = prior.challengeId === ch.id;
        const winner = ch.winner || (sameChallenge ? prior.lastWinner : null) || null;
        const next = writeState(D_STATE, {
            challengeId: ch.id, claimedUntil: reset, backoffUntil: 0,
            lastReward: dailyRewardName({ winner }), lastRewardRarity: winner && winner.rarity || null,
            lastWinner: winner,
            lastClaimAt: claimedAt || (sameChallenge ? prior.lastClaimAt : null) || null,
        });
        void refreshRewardUI();
        return next;
    }
 
    const challengeList = (j) => {
        const list = Array.isArray(j) ? j : j && (j.data || j.challenges);
        return Array.isArray(list) ? list : null;
    };
    const isEventChallenge = (c) => !!(c && (c.featured || c.active_period));
    function pickDaily(list) {
        const daily = list.filter(c => c && c.recurrence === 'daily');
        return daily.find(c => !isEventChallenge(c)) || daily[0] || null;
    }
    const pickEvents = (list, main) => list.filter(c => c && c.id && !(main && c.id === main.id));
 
    async function getChallengeList() {
        const r = await apiGet(EP_CHALLENGES);
        if (!r.ok) throw new Error('challenges HTTP ' + r.status);
        const list = challengeList(await r.json());
        if (!list) throw new Error('Unknown challenge response format');
        return list;
    }
    async function getDailyChallenge() {
        return pickDaily(await getChallengeList());
    }
 
    async function dailyCycle() {
        if (!moduleEnabled('daily')) return;
        return withModuleLock(D_LOCK, runDailyCycle, () => dailySchedule(D_POLL_NEAR_MS));
    }
    async function runDailyCycle() {
        if (dailyRunning) return;
        dailyRunning = true;
        let token = sessionToken();
        try {
            token = await prepareSession();
            if (!token) return dailySchedule(D_POLL_IDLE_MS);
            watchRewardCache();
            if (dailyClaimedNow()) return dailySchedule(readState(D_STATE).claimedUntil - Date.now());
            if (inBackoff(D_STATE)) return dailySchedule(readState(D_STATE).backoffUntil - Date.now());
            if (!acquireLock(D_LOCK)) return dailySchedule(D_POLL_NEAR_MS);
            const ch = await getDailyChallenge();
 
            if (!ch) { log('[daily] No daily reward found. Checking again in 15 minutes.'); return dailySchedule(D_POLL_IDLE_MS); }
            const reset = dailyResetMs(ch);
 
            if (ch.status === 'claimed') {
                recordDailyClaim(ch);
                return dailySchedule(reset - Date.now());
            }
            if (ch.status === 'claimable') {
                if (!moduleEnabled('daily')) return;
                const expires = Date.parse(ch.window && ch.window.ends_at);
                if (!ch.id || !Number.isFinite(expires) || expires <= Date.now()) return dailySchedule(D_POLL_NEAR_MS);
                if (dailyClaimedNow()) return dailySchedule(readState(D_STATE).claimedUntil - Date.now());
                if (!ownsLock(D_LOCK)) return dailySchedule(D_POLL_NEAR_MS);
                if (sessionToken() !== token) return dailySchedule(3000);
                refreshLock(D_LOCK);
                try {
                    const cr = await apiPost(EP_CH_CLAIM(ch.id));
                    if (!cr.ok) {
                        const latest = await getDailyChallenge();
                        if (sessionToken() !== token) return dailySchedule(3000);
                        if (latest && latest.id === ch.id && latest.status === 'claimed') {
                            recordDailyClaim(latest);
                            return dailySchedule(dailyResetMs(latest) - Date.now());
                        }
                        throw new Error('claim HTTP ' + cr.status);
                    }
                    const claimedAt = Date.now();
                    recordDailyClaim(ch, claimedAt);
                    try {
                        const ch2 = await getDailyChallenge();
                        if (ch2 && ch2.id === ch.id && ch2.status === 'claimed' && sessionToken() === token) {
                            recordDailyClaim(ch2, claimedAt);
                        }
                    } catch (e) { log('[daily] Claim saved; reward details unavailable.'); }
                    if (sessionToken() !== token) return dailySchedule(3000);
                    const s = readState(D_STATE);
                    return dailySchedule(reset - Date.now());
                } catch (e) {
                    if (sessionToken() !== token) return dailySchedule(3000);
                    setBackoff(D_STATE, D_ERROR_BACKOFF_MS);
                    return dailySchedule(D_ERROR_BACKOFF_MS);
                }
            }
            if (ch.status !== 'in_progress') throw new Error('Unknown daily reward status');
            const cond = ch.condition || {};
            if (!Number.isFinite(cond.threshold) || !Number.isFinite(cond.progress)) throw new Error('Missing daily progress');
            const remaining = Math.max(0, (cond.threshold || 0) - (cond.progress || 0));
            return dailySchedule(Math.min(D_POLL_IDLE_MS, Math.max(D_POLL_NEAR_MS, remaining * 60_000)));
        } catch (e) {
            if (sessionToken() !== token) return dailySchedule(3000);
            setBackoff(D_STATE, D_ERROR_BACKOFF_MS);
            return dailySchedule(D_ERROR_BACKOFF_MS);
        } finally {
            dailyRunning = false;
            releaseLock(D_LOCK);
        }
    }
 
    const DR_STATE = 'psKickDrops';
    const DR_LOCK  = 'psKickDropsLock';
    const DR_POLL_ACTIVE_MS = 8 * 60_000;
    const DR_POLL_IDLE_MS   = 60 * 60_000;
    const DR_ERROR_BACKOFF_MS = 30 * 60_000;
    let dropsRunning = false;
 
    const dropsSchedule = (ms) => scheduleNext('drops', dropsCycle, ms, 1000, 6 * 60 * 60_000);
    const isActiveCampaign = (c) => {
        if (!c || !c.id || typeof c.status !== 'string' || ['expired', 'ended'].includes(c.status)) return false;
        if (Date.parse(c.starts_at) > Date.now() || Date.parse(c.ends_at) <= Date.now()) return false;
        return !(c.connect_url && c.user_app_connected !== true);
    };
    const rewardEarned = (c, rw) => {
        if (!rw || !rw.id || rw.claimed !== false) return false;
        if (Number.isFinite(rw.required_units) && Number.isFinite(c.progress_units)) {
            return rw.required_units >= 0 && c.progress_units >= rw.required_units;
        }
        return typeof rw.progress === 'number' && rw.progress >= 1;
    };
    function retryAfterMs(response, fallback) {
        const value = response.headers && response.headers.get('Retry-After');
        if (!value) return fallback;
        const ms = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
        return Number.isFinite(ms) ? Math.max(1000, ms) : fallback;
    }
 
    async function dropsCycle() {
        if (!moduleEnabled('drops')) return;
        return withModuleLock(DR_LOCK, runDropsCycle, () => dropsSchedule(D_POLL_NEAR_MS));
    }
    async function runDropsCycle() {
        if (dropsRunning) return;
        dropsRunning = true;
        let token = sessionToken();
        try {
            token = await prepareSession();
            if (!token) return dropsSchedule(DR_POLL_IDLE_MS);
            if (inBackoff(DR_STATE)) return dropsSchedule(readState(DR_STATE).backoffUntil - Date.now());
            if (!acquireLock(DR_LOCK)) return dropsSchedule(D_POLL_NEAR_MS);
            const r = await apiGet(EP_DROPS);
            if (!r.ok) throw new Error('drops HTTP ' + r.status);
            const j = await r.json();
            const campaigns = j && j.data;
            if (!Array.isArray(campaigns)) throw new Error('Unknown drops response format');
            const active = campaigns.filter(isActiveCampaign);
 
            let anyClaimed = false;
 
            for (const c of active) {
                for (const rw of (Array.isArray(c.rewards) ? c.rewards : [])) {
                    if (!moduleEnabled('drops')) return;
                    if (!rewardEarned(c, rw) || !isActiveCampaign(c)) continue;
                    if (!ownsLock(DR_LOCK)) return dropsSchedule(D_POLL_NEAR_MS);
                    if (sessionToken() !== token) return dropsSchedule(3000);
                    refreshLock(DR_LOCK);
                    try {
                        const cr = await apiPost(EP_DROPS_CLAIM, { reward_id: rw.id, campaign_id: c.id });
                        if (cr.ok) { anyClaimed = true; log('[drops] Reward claimed.'); }
                        else {
                            if ([401, 403, 429].includes(cr.status) || cr.status >= 500) {
                                const delay = retryAfterMs(cr, DR_ERROR_BACKOFF_MS);
                                setBackoff(DR_STATE, delay);
                                return dropsSchedule(delay);
                            }
                        }
                    } catch (e) {
                        if (sessionToken() !== token) return dropsSchedule(3000);
                        setBackoff(DR_STATE, DR_ERROR_BACKOFF_MS);
                        return dropsSchedule(DR_ERROR_BACKOFF_MS);
                    }
                }
            }
 
            if (anyClaimed) writeState(DR_STATE, { backoffUntil: 0 });
            return dropsSchedule(active.length ? DR_POLL_ACTIVE_MS : DR_POLL_IDLE_MS);
        } catch (e) {
            if (sessionToken() !== token) return dropsSchedule(3000);
            setBackoff(DR_STATE, DR_ERROR_BACKOFF_MS);
            return dropsSchedule(DR_ERROR_BACKOFF_MS);
        } finally {
            dropsRunning = false;
            releaseLock(DR_LOCK);
        }
    }
 
    const E_STATE = 'psKickEventRewards';
    const E_LOCK  = 'psKickEventRewardsLock';
    const E_POLL_ACTIVE_MS = 15 * 60_000;
    const E_POLL_QUIET_MS  = 60 * 60_000;
    const E_KEEP_MS = 7 * 24 * 60 * 60_000;
    let eventsRunning = false;
    let lastEventCacheWake = 0;
 
    const eventsSchedule = (ms) => scheduleNext('events', eventsCycle, ms, 1000, 6 * 60 * 60_000);
    const eventLabel = (ch) => `"${ch.name || ch.id}"`;
    const eventClaims = () => readState(E_STATE).claims || {};
    function eventFailUntil(id) {
        const until = (readState(E_STATE).failUntil || {})[id];
        return typeof until === 'number' ? until : 0;
    }
    function setEventFail(id) {
        const now = Date.now();
        const failUntil = {};
        for (const [key, until] of Object.entries(readState(E_STATE).failUntil || {})) {
            if (typeof until === 'number' && until > now) failUntil[key] = until;
        }
        failUntil[id] = now + D_ERROR_BACKOFF_MS;
        writeState(E_STATE, { failUntil });
    }
    function recordEventClaim(ch, claimedAt) {
        const prior = eventClaims();
        const before = prior[ch.id];
        const sameWindow = !!before && before.claimedUntil === dailyResetMs(ch);
        const winner = ch.winner || (sameWindow ? before.winner : null) || null;
        const entry = {
            name: ch.name || null, claimedUntil: dailyResetMs(ch),
            reward: dailyRewardName({ winner }), rarity: winner && winner.rarity || null, winner,
            claimedAt: claimedAt || (sameWindow ? before.claimedAt : null) || null,
        };
        if (before && JSON.stringify(before) === JSON.stringify(entry)) return false;
        const claims = {};
        for (const [key, value] of Object.entries(prior)) {
            if (value && value.claimedUntil > Date.now() - E_KEEP_MS) claims[key] = value;
        }
        claims[ch.id] = entry;
        writeState(E_STATE, { claims });
        void refreshRewardUI();
        return true;
    }
 
    async function eventsCycle() {
        if (!moduleEnabled('events')) return;
        return withModuleLock(E_LOCK, runEventsCycle, () => eventsSchedule(D_POLL_NEAR_MS));
    }
    async function runEventsCycle() {
        if (eventsRunning) return;
        eventsRunning = true;
        let token = sessionToken();
        try {
            token = await prepareSession();
            if (!token) return eventsSchedule(E_POLL_QUIET_MS);
            if (inBackoff(E_STATE)) return eventsSchedule(readState(E_STATE).backoffUntil - Date.now());
            if (!acquireLock(E_LOCK)) return eventsSchedule(D_POLL_NEAR_MS);
            const list = await getChallengeList();
            if (sessionToken() !== token) return eventsSchedule(3000);
            let next = E_POLL_QUIET_MS;
            for (const ch of pickEvents(list, pickDaily(list))) {
                if (ch.status === 'claimed') { recordEventClaim(ch); continue; }
                if (ch.status === 'in_progress') {
                    const cond = ch.condition || {};
                    const known = Number.isFinite(cond.threshold) && Number.isFinite(cond.progress);
                    const remaining = known ? Math.max(0, cond.threshold - cond.progress) : null;
                    if (known) log(`[events] ${eventLabel(ch)} — ~${remaining} minutes of watch time remaining.`);
                    next = Math.min(next, known ? Math.min(E_POLL_ACTIVE_MS, Math.max(D_POLL_NEAR_MS, remaining * 60_000)) : E_POLL_ACTIVE_MS);
                    continue;
                }
                if (!moduleEnabled('events')) return;
                if (ch.status !== 'claimable') continue;
                const expires = Date.parse(ch.window && ch.window.ends_at);
                if (!Number.isFinite(expires) || expires <= Date.now()) continue;
                const recorded = eventClaims()[ch.id];
                if (recorded && recorded.claimedUntil === dailyResetMs(ch)) continue;
                const failUntil = eventFailUntil(ch.id);
                if (failUntil > Date.now()) { next = Math.min(next, failUntil - Date.now()); continue; }
                if (!ownsLock(E_LOCK)) return eventsSchedule(D_POLL_NEAR_MS);
                if (sessionToken() !== token) return eventsSchedule(3000);
                refreshLock(E_LOCK);
                let claimed = false, failure = '';
                try {
                    const cr = await apiPost(EP_CH_CLAIM(ch.id));
                    claimed = cr.ok;
                    failure = 'HTTP ' + cr.status;
                } catch (e) { failure = e.message; }
                if (sessionToken() !== token) return eventsSchedule(3000);
                if (!claimed) {
                    let latest = null;
                    try { latest = (await getChallengeList()).find(c => c && c.id === ch.id) || null; }
                    catch (e) { latest = null; }
                    if (sessionToken() !== token) return eventsSchedule(3000);
                    if (latest && latest.status === 'claimed') { recordEventClaim(latest); continue; }
                    setEventFail(ch.id);
                    next = Math.min(next, D_ERROR_BACKOFF_MS);
                    continue;
                }
                const claimedAt = Date.now();
                recordEventClaim(ch, claimedAt);
                try {
                    const after = (await getChallengeList()).find(c => c && c.id === ch.id);
                    if (after && after.status === 'claimed' && sessionToken() === token) recordEventClaim(after, claimedAt);
                } catch (e) { log('[events] Claim saved; reward details unavailable.'); }
                if (sessionToken() !== token) return eventsSchedule(3000);
                const entry = eventClaims()[ch.id] || {};
            }
            return eventsSchedule(next);
        } catch (e) {
            if (sessionToken() !== token) return eventsSchedule(3000);
            setBackoff(E_STATE, D_ERROR_BACKOFF_MS);
            return eventsSchedule(D_ERROR_BACKOFF_MS);
        } finally {
            eventsRunning = false;
            releaseLock(E_LOCK);
        }
    }
 
    window.addEventListener('storage', (ev) => {
        if (ev.key === D_STATE && ev.newValue) {
            try {
                const s = readState(D_STATE);
                if (s.claimedUntil && Date.now() < s.claimedUntil) {
                    dailySchedule(s.claimedUntil - Date.now());
                    void refreshRewardUI();
                }
            }
            catch (e) {}
        }
    });
 
    const getStatus = () => {
        const sameSession = sessionToken() === currentSessionToken;
        const s = sameSession ? readState(D_STATE) : {};
        const ev = sameSession ? readState(E_STATE) : {};
        const date = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
        return {
            version: '1.0.1', settings: { ...settings }, loggedIn: !!sessionToken(), dailyRunning, dropsRunning, eventsRunning,
            daily: { claimed: Date.now() < (s.claimedUntil || 0), nextCheck: date(nextChecks.daily),
                claimedUntil: date(s.claimedUntil), lastClaimAt: date(s.lastClaimAt),
                reward: s.lastReward || null, rarity: s.lastRewardRarity || null },
            events: { nextCheck: date(nextChecks.events),
                claims: Object.values(ev.claims || {}).map(c => ({
                    name: c.name || null, claimed: Date.now() < (c.claimedUntil || 0), claimedUntil: date(c.claimedUntil),
                    lastClaimAt: date(c.claimedAt), reward: c.reward || null, rarity: c.rarity || null,
                })) },
            drops: { nextCheck: date(nextChecks.drops) },
        };
    };
 
    function wakeAfterResume() {
        if (document.visibilityState === 'hidden') return;
        watchRewardCache();
        if (!dailyRunning) dailySchedule(1000);
        if (!dropsRunning) dropsSchedule(3000);
        if (!eventsRunning) eventsSchedule(5000);
    }
    document.addEventListener('visibilitychange', wakeAfterResume);
    window.addEventListener('online', wakeAfterResume);
    window.addEventListener('pageshow', wakeAfterResume);
 
    let started = false;
    async function start() {
        if (started) return;
        started = true;
        try { settings = { ...settings, ...(await chrome.storage.local.get('settings')).settings }; }
        catch { settings.enabled = false; return; }
        try { await prepareSession(); }
        catch (e) { log('Unable to read session:', e.message); }
        watchRewardCache();
        const s = readState(D_STATE);
        if (s.claimedUntil && Date.now() < s.claimedUntil) {
            void refreshRewardUI();
            dailySchedule(s.claimedUntil - Date.now());
        } else {
            dailySchedule(3000 + Math.floor(Math.random() * 3000));
        }
        dropsSchedule(6000 + Math.floor(Math.random() * 4000));
        eventsSchedule(9000 + Math.floor(Math.random() * 4000));
    }
 
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.settings) return;
        settings = { enabled: true, daily: true, events: true, drops: true, ...changes.settings.newValue };
        for (const name of ['daily', 'events', 'drops']) {
            clearTimeout(timers[name]); delete timers[name]; delete nextChecks[name];
        }
        dailySchedule(1000); dropsSchedule(3000); eventsSchedule(5000);
    });
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.type === 'status') respond(getStatus());
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else void start();
})();
