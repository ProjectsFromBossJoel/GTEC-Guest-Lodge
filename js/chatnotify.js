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
        manager:      'linear-gradient(135deg,#15803d,#22c55e)',
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
    chatRoomChannels.forEach(channel => {
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

    // ── Bootstrap after Firebase is ready ────────────────────
    // Poll until firebase.auth and db are available (loaded async)
    function waitForFirebase() {
        if (typeof firebase === 'undefined' || typeof db === 'undefined') {
            setTimeout(waitForFirebase, 150);
            return;
        }
        firebase.auth().onAuthStateChanged(user => {
            if (user) startListeners(user.uid);
        });
    }

    waitForFirebase();

})();
