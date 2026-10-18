/**
 * chatnotify.js — Global chat pop-up notification (Telegram-style)
 * Include this on every admin page AFTER firebase.js and auth.js.
 * It will NOT show on chatroom.html (user is already there).
 */

(function () {
    'use strict';



    const ALL_CHANNELS = ['general', 'announcements', 'housekeeping', 'front-desk'];
    const STORAGE_KEY  = 'cr-notify-last-seen'; // { channel: timestampMillis }

    // ── Inject styles ─────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        /* ── Notification stack container ── */
        #cr-notif-stack {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 99999;
            display: flex;
            flex-direction: column-reverse;
            gap: 10px;
            pointer-events: none;
        }

        /* ── Single notification card ── */
        .cr-notif-card {
            pointer-events: all;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-left: 4px solid #1f3b57;
            border-radius: 14px;
            padding: 13px 16px 13px 13px;
            width: 320px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08);
            cursor: pointer;
            transform: translateX(360px);
            opacity: 0;
            transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease;
            position: relative;
            user-select: none;
        }

        .cr-notif-card.show {
            transform: translateX(0);
            opacity: 1;
        }

        .cr-notif-card.hide {
            transform: translateX(360px);
            opacity: 0;
        }

        .cr-notif-card:hover {
            border-left-color: #c9a84c;
            box-shadow: 0 12px 40px rgba(0,0,0,0.18);
        }

        /* ── Avatar ── */
        .cr-notif-avatar {
            width: 40px;
            height: 40px;
            border-radius: 11px;
            background: linear-gradient(135deg, #1f3b57, #2a5180);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: 700;
            flex-shrink: 0;
            letter-spacing: -0.5px;
        }

        /* ── Body ── */
        .cr-notif-body {
            flex: 1;
            min-width: 0;
        }

        .cr-notif-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 3px;
        }

        .cr-notif-app {
            font-size: 10px;
            font-weight: 700;
            color: #1f3b57;
            text-transform: uppercase;
            letter-spacing: 0.8px;
        }

        .cr-notif-channel {
            font-size: 10px;
            color: #94a3b8;
            font-weight: 500;
        }

        .cr-notif-name {
            font-size: 13px;
            font-weight: 700;
            color: #0f1923;
            margin-bottom: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .cr-notif-text {
            font-size: 12px;
            color: #475569;
            line-height: 1.45;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .cr-notif-time {
            font-size: 10px;
            color: #cbd5e1;
            margin-top: 5px;
        }

        /* ── Close button ── */
        .cr-notif-close {
            position: absolute;
            top: 8px;
            right: 8px;
            background: none;
            border: none;
            cursor: pointer;
            color: #cbd5e1;
            font-size: 13px;
            padding: 2px 5px;
            border-radius: 5px;
            transition: color 0.15s, background 0.15s;
            line-height: 1;
        }

        .cr-notif-close:hover {
            color: #64748b;
            background: #f1f5f9;
        }

        /* ── Reply hint ── */
        .cr-notif-reply {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-top: 7px;
            font-size: 11px;
            font-weight: 600;
            color: #1f3b57;
            background: #eff6ff;
            border-radius: 6px;
            padding: 3px 8px;
            transition: background 0.15s;
        }

        .cr-notif-card:hover .cr-notif-reply {
            background: #dbeafe;
        }
            /* ── Live Chat sidebar badge (global) ── */
        .nav-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: #ef4444;
            color: white;
            font-size: 10px;
            font-weight: 700;
            min-width: 18px;
            height: 18px;
            border-radius: 10px;
            padding: 0 5px;
            margin-left: auto;
            line-height: 1;
        }
    `;
    document.head.appendChild(style);

    // ── Create stack container ────────────────────────────────
    const stack = document.createElement('div');
    stack.id = 'cr-notif-stack';
    document.body.appendChild(stack);

    // ── Load last-seen timestamps from localStorage ───────────
    function getLastSeen() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
    }

    function setLastSeen(channel, millis) {
        const data = getLastSeen();
        data[channel] = millis;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    // ── Format time ───────────────────────────────────────────
    function fmtTime(ts) {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }

    // ── Get initials from name ────────────────────────────────
    function initials(name) {
        return (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    }

    // ── Avatar background colours per role ────────────────────
    const ROLE_COLORS = {
        superadmin:   'linear-gradient(135deg,#1e40af,#3b82f6)',
        admin:        'linear-gradient(135deg,#15803d,#22c55e)',
        manager:      'linear-gradient(135deg,#0e7490,#22d3ee)',
        receptionist: 'linear-gradient(135deg,#92400e,#f59e0b)',
        observer:     'linear-gradient(135deg,#6b21a8,#a855f7)',
        staff:        'linear-gradient(135deg,#0891b2,#22d3ee)',
    };

    function roleColor(role) {
        return ROLE_COLORS[role] || ROLE_COLORS.staff;
    }

    // ── Show a notification card ──────────────────────────────
    let _notifCount = 0;
    const MAX_STACK = 4; // max visible at once

    function showNotification(channel, senderName, text, role, ts, hasAttachment) {
        // Limit stack size — remove oldest if needed
        const existing = stack.querySelectorAll('.cr-notif-card');
        if (existing.length >= MAX_STACK) {
            dismissCard(existing[existing.length - 1], true);
        }

        const id = 'notif-' + (++_notifCount);

        const card = document.createElement('div');
        card.className = 'cr-notif-card';
        card.id = id;

        card.innerHTML = `
            <div class="cr-notif-avatar" style="background:${roleColor(role)}">
                ${initials(senderName)}
            </div>
            <div class="cr-notif-body">
                <div class="cr-notif-header">
                    <span class="cr-notif-app">Chat Room</span>
                    <span class="cr-notif-channel">· #${channel}</span>
                </div>
                <div class="cr-notif-name">${escHtml(senderName)}</div>
                <div class="cr-notif-text">
                    ${hasAttachment ? `<span style="display:inline-flex;align-items:center;gap:4px;color:#1d4ed8;font-weight:600;font-size:11px;margin-bottom:2px;"><i class="fas fa-paperclip" style="font-size:10px;"></i> Attachment</span>${text ? '<br>' : ''}` : ''}
                    ${escHtml(text)}
                </div>
                <div class="cr-notif-time">${fmtTime(ts)}</div>
                <span class="cr-notif-reply">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    Tap to reply
                </span>
            </div>
            <button class="cr-notif-close" title="Dismiss">✕</button>
        `;

        // Click card → go to chatroom
        card.addEventListener('click', (e) => {
            if (e.target.closest('.cr-notif-close')) return;
            dismissCard(card, false);
            window.location.href = 'chatroom.html';
        });

        // Close button
        card.querySelector('.cr-notif-close').addEventListener('click', (e) => {
            e.stopPropagation();
            dismissCard(card, false);
        });

        stack.prepend(card);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => card.classList.add('show'));
        });

        // Auto-dismiss after 6 seconds
        const timer = setTimeout(() => dismissCard(card, false), 6000);
        card._dismissTimer = timer;
    }

    function dismissCard(card, instant) {
        clearTimeout(card._dismissTimer);
        if (instant) {
            card.remove();
            return;
        }
        card.classList.add('hide');
        card.classList.remove('show');
        setTimeout(() => card.remove(), 380);
    }

    function escHtml(str) {
        return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Wait for Firebase auth then start listeners ───────────
    function startListeners(currentUid) {
        const lastSeen = getLastSeen();
        // Seed last-seen to now for any channel not yet tracked
        // so we don't flood with old messages on first load
        const now = Date.now();

        // ── Chat Room unread badge (sidebar) ──────────────────────
// ─────────────────────────────────────────────────────
// Chat Room unread badge (Firestore‑synced)
// ─────────────────────────────────────────────────────
const chatRoomChannels = ['general', 'announcements', 'housekeeping', 'front-desk'];
const unreadRef = db.collection('chatUnread').doc(currentUid);
const latestMsgs = {};

// Keep a local copy of readTimes updated in real time
let readTimes = {};

unreadRef.onSnapshot(userDoc => {
    readTimes = userDoc.exists ? userDoc.data() : {};
    updateChatRoomBadge();
});

// Start per‑channel listeners for latest message timestamps
chatRoomChannels.forEach(channel => {
    db.collection('chatrooms').doc(channel).collection('messages')
        .orderBy('time', 'desc').limit(1)
        .onSnapshot(snap => {
            if (!snap.empty) {
                const ts = snap.docs[0].data().time;
                latestMsgs[channel] = ts ? (ts.toMillis ? ts.toMillis() : 0) : 0;
            } else {
                latestMsgs[channel] = 0;
            }
            updateChatRoomBadge();  // just use the local readTimes
        }, err => {
            console.warn(`Chatroom badge error [${channel}]:`, err);
        });
});

function updateChatRoomBadge() {
    let unreadChannels = 0;
    const isChatRoom = window.location.pathname.endsWith('chatroom.html');
    const activeChannel = sessionStorage.getItem('cr_active_channel') || '';

    chatRoomChannels.forEach(channel => {
        // If we’re on the chatroom page and the user is viewing this channel, skip it
        if (isChatRoom && channel === activeChannel) return;

        const lastSeen = readTimes[`lastSeen_${channel}`];
        const lastSeenMillis = lastSeen
            ? (lastSeen.seconds ? lastSeen.seconds * 1000 : 0)
            : 0;
        const latestMillis = latestMsgs[channel] || 0;
        if (latestMillis > lastSeenMillis) {
            unreadChannels++;
        }
    });

    const badge = document.getElementById('nav-chatroom-count');
    if (badge) {
        if (unreadChannels > 0) {
            badge.textContent = unreadChannels;
            badge.style.display = 'inline-flex';
        } else {
            badge.textContent = '';
            badge.style.display = 'none';
        }
    }
};

        if (!window.location.pathname.endsWith('chatroom.html')) {
        ALL_CHANNELS.forEach(channel => {
            // If never seen, mark as now so old messages don't fire
            if (!lastSeen[channel]) {
                setLastSeen(channel, now);
            }

            db.collection('chatrooms')
                .doc(channel)
                .collection('messages')
                .orderBy('time', 'desc')
                .limit(1)
                .onSnapshot(snap => {
                    snap.forEach(doc => {
                        const data = doc.data();
                        if (!data.time) return;

                        const msgMillis = data.time.toMillis ? data.time.toMillis() : 0;
                        const seen      = getLastSeen()[channel] || 0;

                        // Only show if: newer than last seen, and not sent by current user
                        if (msgMillis > seen && data.uid !== currentUid) {
                            setLastSeen(channel, msgMillis);
                            showNotification(
                                channel,
                                data.senderName || 'Staff',
                                data.text       || '',
                                data.role       || 'staff',
                                data.time,
                                !!data.attachment
                            );
                        }
                    });
                });
        });
    }
        // ── Live Chat unread badge (sidebar & anywhere with #nav-chat-count) ──
db.collection('liveChats')
    .where('adminRead', '==', false)
    .onSnapshot(function (snapshot) {
        var badge = document.getElementById('nav-chat-count');
        if (!badge) return;
        var count = snapshot.size;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'inline-flex';
        } else {
            badge.textContent = '';
            badge.style.display = 'none';
        }
    }, function (err) {
        console.warn('chatnotify: live chat badge error', err);
    });

    }

    // ── Live access watcher: reacts instantly when the superadmin
    //    changes this user's role / permissions / page access ─────
    let _accessUnsub = null;
    let _accessUid   = null;
    const KNOWN_PAGES = ['dashboard','rooms','checkin','checkout','guests','chatroom','logs','chat',
                         'verification','invoice','payments','calendar','filelibrary','reports',
                         'monitoring','profile','roles'];

    function currentPageKey() {
        const file = (window.location.pathname.split('/').pop() || '').replace('.html', '');
        return file.toLowerCase();
    }

    function startAccessWatcher(uid) {
        if (_accessUid === uid) return;            // already watching this user
        if (_accessUnsub) _accessUnsub();
        _accessUid = uid;

        let baseline = null;

        _accessUnsub = db.collection('users').doc(uid).onSnapshot(snap => {
            if (!snap.exists) return;
            const d = snap.data();

            const signature = JSON.stringify({
                role:        d.role || null,
                status:      d.status || 'active',
                permissions: d.permissions || null,
                pageAccess:  Array.isArray(d.pageAccess) ? [...d.pageAccess].sort() : null,
            });

            if (baseline === null) { baseline = signature; return; }   // first load
            if (signature === baseline) return;                        // nothing relevant changed
            baseline = signature;

            const notify = (msg, type) => {
                if (window.UI && UI.showNotification) UI.showNotification(msg, type);
            };

            // 1) Deactivated / rejected -> sign out
            if ((d.status || 'active') !== 'active') {
                notify('Your account access has been removed.', 'error');
                setTimeout(() => firebase.auth().signOut().then(() => { window.location.href = 'index.html'; }), 1200);
                return;
            }

            // 2) Clear any cached role/permission data so auth.js re-reads fresh values
            [sessionStorage, localStorage].forEach(store => {
                Object.keys(store).forEach(k => {
                    if (/(role|permission|pageaccess|userprofile)/i.test(k)) store.removeItem(k);
                });
            });

            // 3) Current page no longer allowed? -> redirect
            const page = currentPageKey();
            if (d.role !== 'superadmin' && Array.isArray(d.pageAccess)
                && KNOWN_PAGES.includes(page) && !d.pageAccess.includes(page)) {
                const target = d.pageAccess.includes('dashboard') ? 'dashboard' : d.pageAccess[0];
                notify('Your page access was updated by an administrator.', 'error');
                setTimeout(() => {
                    if (target) window.location.href = target + '.html';
                    else firebase.auth().signOut().then(() => { window.location.href = 'index.html'; });
                }, 1200);
                return;
            }

            // 4) Same page, new permissions/role -> reload so buttons & sidebar re-apply
            notify('Your permissions were updated. Applying changes…', 'success');
            setTimeout(() => window.location.reload(), 1000);
        }, err => console.warn('chatnotify: access watcher error', err));
    }

    // ── Bootstrap after Firebase is ready ────────────────────
    // Poll until firebase.auth and db are available (loaded async)
    // ══════════════════════════════════════════════════════════
    //  CLIENT REQUESTS: fault reports, laundry, feedback (+ guest replies)
    //  Pop-up on every admin page + red badge on the "Client Requests" menu item
    // ══════════════════════════════════════════════════════════
    const REQ_ROLES = ['superadmin', 'admin'];     // keep in sync with ALLOWED_ROLES in client-requests.js
    const REQ_KEY   = 'cr-notify-requests';       // localStorage: last-seen timestamps
    const REQ_SOURCES = {
        faults:   { coll: 'faultReports',    label: 'Fault Report',    icon: 'fa-screwdriver-wrench', bg: 'linear-gradient(135deg,#b91c1c,#f97316)', fresh: ['new'] },
        laundry:  { coll: 'laundryRequests', label: 'Laundry Request', icon: 'fa-shirt',              bg: 'linear-gradient(135deg,#0e7490,#22d3ee)', fresh: ['requested'] },
        feedback: { coll: 'feedback',        label: 'Feedback',        icon: 'fa-star',               bg: 'linear-gradient(135deg,#b45309,#f59e0b)', fresh: ['draft'] }
    };
    const reqCounts = { faults: 0, laundry: 0, feedback: 0 };
    let reqStarted = false;

    function reqSeen() { try { return JSON.parse(localStorage.getItem(REQ_KEY)) || {}; } catch (e) { return {}; } }
    function reqSetSeen(k, millis) { const d = reqSeen(); d[k] = millis; localStorage.setItem(REQ_KEY, JSON.stringify(d)); }
    function tsMs(ts) { return ts && ts.toMillis ? ts.toMillis() : 0; }
    function reqAllowed() {                              // same rule as auth.js / Page Access
        const role = window._userRole;
        if (!role) return false;
        if (role === 'superadmin') return true;
        const access = window._userPageAccess;
        if (Array.isArray(access)) return access.indexOf('client-requests') !== -1;
        return REQ_ROLES.indexOf(role) !== -1;           // no saved Page Access: role defaults
    }
    function onRequestsPage() { return window.location.pathname.endsWith('client-requests.html'); }

    function hasNewGuestReply(d) {      // same rule as client-requests.js
        const g = tsMs(d.guestReplyAt), u = tsMs(d.updatedAt);
        return !!(d.guestReply && g && (!u || g >= u));
    }

    function reqSummary(kind, d) {
        if (kind === 'faults') return [d.category, d.description].filter(Boolean).join(' – ');
        if (kind === 'laundry') {
            const n = (d.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);
            return n + ' piece' + (n === 1 ? '' : 's') + (d.service ? ' · ' + d.service : '');
        }
        return (d.rating ? '★'.repeat(d.rating) + ' ' : '') + (d.comment || '(no comment)');
    }

    function showRequestNotification(kind, d, isReply) {
        const S = REQ_SOURCES[kind];
        const existing = stack.querySelectorAll('.cr-notif-card');
        if (existing.length >= MAX_STACK) dismissCard(existing[existing.length - 1], true);

        const card = document.createElement('div');
        card.className = 'cr-notif-card';
        card.id = 'notif-' + (++_notifCount);
        card.style.borderLeftColor = '#b91c1c';

        const tag  = isReply ? 'Guest replied' : (kind === 'faults' && d.urgency === 'Urgent' ? 'New · URGENT' : 'New');
        const text = isReply ? d.guestReply : reqSummary(kind, d);
        const where = d.room ? ' · ' + d.room : '';

        card.innerHTML = `
            <div class="cr-notif-avatar" style="background:${S.bg}"><i class="fas ${S.icon}"></i></div>
            <div class="cr-notif-body">
                <div class="cr-notif-header">
                    <span class="cr-notif-app">${S.label}</span>
                    <span class="cr-notif-channel">· ${tag}</span>
                </div>
                <div class="cr-notif-name">${escHtml(d.name || 'Guest')}${escHtml(where)}</div>
                <div class="cr-notif-text">${escHtml(text)}</div>
                <div class="cr-notif-time">${fmtTime(isReply ? d.guestReplyAt : d.createdAt)}</div>
                <span class="cr-notif-reply"><i class="fas fa-concierge-bell" style="font-size:10px;"></i> View request</span>
            </div>
            <button class="cr-notif-close" title="Dismiss">✕</button>`;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.cr-notif-close')) return;
            dismissCard(card, false);
            try { sessionStorage.setItem('cr_open_tab', kind); } catch (err) {}
            window.location.href = 'client-requests.html';
        });
        card.querySelector('.cr-notif-close').addEventListener('click', (e) => { e.stopPropagation(); dismissCard(card, false); });

        stack.prepend(card);
        requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('show')));
        card._dismissTimer = setTimeout(() => dismissCard(card, false), 8000);
    }

    function updateReqBadge() {
        const link = document.querySelector('a.menu-item[href="client-requests.html"]');
        if (!link) return;
        let b = document.getElementById('nav-requests-count');
        if (!b) {
            b = document.createElement('span');
            b.className = 'nav-badge';
            b.id = 'nav-requests-count';
            b.style.display = 'none';
            link.appendChild(b);
        }
        const n = reqAllowed() ? reqCounts.faults + reqCounts.laundry + reqCounts.feedback : 0;
        b.textContent = n > 99 ? '99+' : (n || '');
        b.style.display = n ? 'inline-flex' : 'none';
    }

    function attachRequestListeners() {
        const saved = reqSeen(), seed = Date.now();
        Object.keys(REQ_SOURCES).forEach(function (kind) {
            const S = REQ_SOURCES[kind];
            // first run: start from "now" so old requests don't flood the screen
            if (!saved[kind])            reqSetSeen(kind, seed);
            if (!saved[kind + 'Reply'])  reqSetSeen(kind + 'Reply', seed);

            db.collection(S.coll).orderBy('createdAt', 'desc').limit(100).onSnapshot(function (snap) {
                const docs = [], news = [], replies = [];
                const seenNew = reqSeen()[kind] || 0, seenReply = reqSeen()[kind + 'Reply'] || 0;

                snap.forEach(function (x) { docs.push(x.data()); });
                snap.docChanges().forEach(function (c) {
                    if (c.type === 'removed') return;
                    const d = c.doc.data(), created = tsMs(d.createdAt), replied = tsMs(d.guestReplyAt);
                    if (c.type === 'added' && created > seenNew) news.push({ d: d, t: created });
                    if (replied > seenReply) replies.push({ d: d, t: replied });
                });
                news.sort((a, b) => a.t - b.t);
                replies.sort((a, b) => a.t - b.t);

                // sidebar badge: items still waiting for staff
                reqCounts[kind] = docs.filter(d => S.fresh.indexOf(d.status) !== -1 || hasNewGuestReply(d)).length;
                updateReqBadge();

                if (!reqAllowed()) return;
                if (news.length)    reqSetSeen(kind, news[news.length - 1].t);
                if (replies.length) reqSetSeen(kind + 'Reply', replies[replies.length - 1].t);
                if (onRequestsPage()) return;          // already on the page, it updates live

                news.slice(-3).forEach(n => showRequestNotification(kind, n.d, false));       // max 3 at once
                replies.slice(-3).forEach(r => showRequestNotification(kind, r.d, true));
            }, function (err) {
                console.warn('chatnotify: ' + S.coll + ' listener error', err.code || err);
            });
        });
    }

    function startRequestListeners() {
        if (reqStarted) return;
        reqStarted = true;
        let tries = 0;
        const t = setInterval(function () {               // wait until auth.js has resolved the role
            tries++;
            if (window._userRole && reqAllowed()) { clearInterval(t); attachRequestListeners(); }
            else if (tries > 100 && !window._userRole) clearInterval(t);
        }, 100);
    }

    // ══════════════════════════════════════════════════════════
    //  WEATHER CHIP (Accra): top bar of every admin page
    //  Skipped on Check-In, which already has its own full weather card.
    // ══════════════════════════════════════════════════════════
    (function weatherChip() {
        const GW_URL = 'https://api.open-meteo.com/v1/forecast?latitude=5.6037&longitude=-0.1870' +
            '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
            '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
            '&timezone=Africa%2FAccra&forecast_days=1';
        const GW_KEY = 'gw-weather-cache';
        const GW_TTL = 15 * 60 * 1000;            // refresh every 15 minutes

        function wx(code) {
            if (code === 0) return { text: 'Clear sky',     icon: 'fa-sun',                 color: '#f59e0b' };
            if (code === 1) return { text: 'Mostly clear',  icon: 'fa-sun',                 color: '#f59e0b' };
            if (code === 2) return { text: 'Partly cloudy', icon: 'fa-cloud-sun',           color: '#f59e0b' };
            if (code === 3) return { text: 'Overcast',      icon: 'fa-cloud',               color: '#64748b' };
            if (code === 45 || code === 48) return { text: 'Foggy',        icon: 'fa-smog',                color: '#64748b' };
            if (code >= 51 && code <= 57)   return { text: 'Drizzle',      icon: 'fa-cloud-rain',          color: '#3b82f6' };
            if (code >= 61 && code <= 67)   return { text: 'Rain',         icon: 'fa-cloud-showers-heavy', color: '#3b82f6' };
            if (code >= 71 && code <= 77)   return { text: 'Snow',         icon: 'fa-snowflake',           color: '#0ea5e9' };
            if (code >= 80 && code <= 82)   return { text: 'Rain showers', icon: 'fa-cloud-showers-heavy', color: '#3b82f6' };
            if (code === 85 || code === 86) return { text: 'Snow showers', icon: 'fa-snowflake',           color: '#0ea5e9' };
            if (code >= 95)                 return { text: 'Thunderstorm', icon: 'fa-bolt',                color: '#7c3aed' };
            return { text: 'Weather', icon: 'fa-cloud', color: '#64748b' };
        }

        function render(els, d) {
            const c = d.current, day = d.daily || {}, info = wx(c.weather_code);
            const hi   = day.temperature_2m_max ? Math.round(day.temperature_2m_max[0]) : '\u2014';
            const lo   = day.temperature_2m_min ? Math.round(day.temperature_2m_min[0]) : '\u2014';
            const rain = day.precipitation_probability_max ? day.precipitation_probability_max[0] : null;
            els.icon.innerHTML   = '<i class="fas ' + info.icon + '"></i>';
            els.icon.style.color = info.color;
            els.temp.textContent = Math.round(c.temperature_2m) + '\u00B0C';
            els.desc.textContent = info.text;
            els.meta.textContent = 'Feels ' + Math.round(c.apparent_temperature) + '\u00B0 \u00B7 H ' + hi + '\u00B0 \u00B7 L ' + lo + '\u00B0' +
                                   (rain !== null ? ' \u00B7 Rain ' + rain + '%' : '');
            els.root.title = 'Humidity ' + Math.round(c.relative_humidity_2m) + '% \u00B7 Wind ' + Math.round(c.wind_speed_10m) + ' km/h';
        }

        function load(els, force) {
            try {                                            // reuse the last reading while navigating between pages
                const cached = JSON.parse(sessionStorage.getItem(GW_KEY));
                if (!force && cached && Date.now() - cached.t < GW_TTL) { render(els, cached.d); return; }
            } catch (e) {}
            fetch(GW_URL)
                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                .then(d => {
                    try { sessionStorage.setItem(GW_KEY, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
                    render(els, d);
                })
                .catch(err => {
                    console.warn('chatnotify: weather unavailable', err);
                    els.icon.innerHTML   = '<i class="fas fa-cloud"></i>';
                    els.icon.style.color = '#94a3b8';
                    els.temp.textContent = '\u2014';
                    els.desc.textContent = 'Weather unavailable';
                    els.meta.textContent = '';
                });
        }

        function build() {
            if (document.getElementById('ci-weather') || document.getElementById('gw-chip')) return;
            const bar = document.querySelector('.header .header-right');
            if (!bar) return;

            const css = document.createElement('style');
            css.textContent = `
                .gw-chip { display:flex; align-items:center; gap:10px; padding:6px 12px; margin-right:6px; border-radius:12px;
                           background:linear-gradient(135deg,#eff6ff,#e0f2fe); border:1px solid #bfdbfe; }
                .gw-icon { width:34px; height:34px; border-radius:10px; flex-shrink:0; background:#fff;
                           box-shadow:0 1px 4px rgba(0,0,0,.06); display:flex; align-items:center; justify-content:center;
                           font-size:16px; color:#f59e0b; }
                .gw-body { min-width:0; }
                .gw-top  { display:flex; align-items:baseline; gap:6px; }
                .gw-temp { font-size:18px; font-weight:800; color:#1f3b57; line-height:1; }
                .gw-desc { font-size:11px; font-weight:600; color:#475569; white-space:nowrap; }
                .gw-meta { font-size:10px; color:#64748b; margin-top:3px; white-space:nowrap; }
                .gw-loc  { align-self:flex-start; font-size:9px; font-weight:700; color:#3b82f6; text-transform:uppercase; letter-spacing:.06em; }
                @media (max-width:1100px) { .gw-meta, .gw-loc { display:none; } }
                @media (max-width:700px)  { .gw-chip { display:none; } }`;
            document.head.appendChild(css);

            const chip = document.createElement('div');
            chip.id = 'gw-chip';
            chip.className = 'gw-chip';
            chip.setAttribute('aria-label', 'Weather in Accra');
            chip.innerHTML =
                '<div class="gw-icon" id="gw-icon"><i class="fas fa-cloud-sun"></i></div>' +
                '<div class="gw-body"><div class="gw-top"><span class="gw-temp" id="gw-temp">\u2014</span>' +
                '<span class="gw-desc" id="gw-desc">Loading\u2026</span></div><div class="gw-meta" id="gw-meta"></div></div>' +
                '<div class="gw-loc">Accra</div>';
            bar.insertBefore(chip, bar.firstChild);

            const els = {
                root: chip, icon: document.getElementById('gw-icon'), temp: document.getElementById('gw-temp'),
                desc: document.getElementById('gw-desc'), meta: document.getElementById('gw-meta')
            };
            load(els, false);
            setInterval(function () { load(els, true); }, GW_TTL);
        }

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
        else build();
    })();

    function waitForFirebase() {
        if (typeof firebase === 'undefined' || typeof db === 'undefined') {
            setTimeout(waitForFirebase, 150);
            return;
        }
        firebase.auth().onAuthStateChanged(user => {
            if (user) { startListeners(user.uid); startRequestListeners(); }
        });
    }

    waitForFirebase();

})();
