// dashboard.js

function getSafeDateString(dateValue) {
    if (!dateValue) return "";
    if (typeof dateValue === 'string') return dateValue;
    if (typeof dateValue.toDate === 'function') {
        try { return dateValue.toDate().toISOString(); } catch (e) { return ""; }
    }
    try { return new Date(dateValue).toISOString(); } catch (e) { return ""; }
}

document.addEventListener('DOMContentLoaded', () => {

    // Set current date in header
    const dateElement = document.getElementById('current-date');
    if (dateElement) {
        dateElement.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    loadDashboardData();

    // ── Live Activity Feed — wait for role before starting ────────────────
    const activityFeed = document.getElementById("activity-feed");
    if (activityFeed && typeof db !== 'undefined') {
        const waitForRole = setInterval(() => {
            if (window._userRole) {
                clearInterval(waitForRole);
                startActivityFeed(window._userRole);
            }
        }, 100);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ✅ getMs — converts any time format to milliseconds
// Handles Firestore Timestamp, ISO string, and raw ms (same as logs.html)
// ─────────────────────────────────────────────────────────────────────────────
function getMs(t) {
    if (!t) return 0;
    if (t.seconds) return t.seconds * 1000;
    if (typeof t === 'string') return new Date(t).getTime();
    return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ formatLogTime — full date + time, same as logs.html
// ─────────────────────────────────────────────────────────────────────────────
function formatLogTime(time) {
    if (!time) return '—';
    try {
        return new Date(getMs(time)).toLocaleString('en-US', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    } catch { return '—'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ getActionStyle — same badge logic as logs.html
// Specific actions checked BEFORE general ones to avoid mismatches
// ─────────────────────────────────────────────────────────────────────────────
function getActionStyle(action) {
    const a = (action || '').toLowerCase();

    // ── Specific first ────────────────────────────────────────────────────
    if (a.includes('auto logged out'))
        return { icon: 'fa-clock', color: '#dc2626', bg: '#fee2e2' };
    if (a.includes('account locked'))
        return { icon: 'fa-lock', color: '#dc2626', bg: '#fef2f2' };
    if (a.includes('password reset') || a.includes('reset sent'))
        return { icon: 'fa-key', color: '#9a3412', bg: '#fff7ed' };
    if (a.includes('role changed'))
        return { icon: 'fa-user-edit', color: '#0369a1', bg: '#e0f2fe' };
    if (a.includes('user created') || a.includes('created'))
        return { icon: 'fa-user-plus', color: '#6b21a8', bg: '#f3e8ff' };
    if (a.includes('user removed') || a.includes('removed') || a.includes('deleted'))
        return { icon: 'fa-trash', color: '#991b1b', bg: '#fef2f2' };

    // ── General ───────────────────────────────────────────────────────────
    if (a.includes('logged in') || a.includes('login'))
        return { icon: 'fa-sign-in-alt', color: '#15803d', bg: '#dcfce7' };
    if (a.includes('logged out') || a.includes('logout'))
        return { icon: 'fa-sign-out-alt', color: '#dc2626', bg: '#fee2e2' };
    if (a.includes('checked in') || a.includes('check-in'))
        return { icon: 'fa-plane-arrival', color: '#1e40af', bg: '#dbeafe' };
    if (a.includes('checked out') || a.includes('checkout'))
        return { icon: 'fa-plane-departure', color: '#854d0e', bg: '#fef3c7' };

    return { icon: 'fa-circle-dot', color: '#94a3b8', bg: '#f1f5f9' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Activity Feed — role-based filtering
// ─────────────────────────────────────────────────────────────────────────────
function startActivityFeed(role) {
    const currentUser = firebase.auth().currentUser;
    const me = currentUser ? currentUser.email.toLowerCase() : '';

    if (role === 'manager') {
        db.collection('users').where('role', '==', 'superadmin').get().then(snap => {
            const superadminEmails = [];
            snap.forEach(doc => {
                superadminEmails.push((doc.data().email || '').toLowerCase());
            });
            attachActivitySnapshot(role, me, superadminEmails);
        });
    } else {
        attachActivitySnapshot(role, me, []);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Attach Firestore snapshot for activity feed
// ─────────────────────────────────────────────────────────────────────────────
function attachActivitySnapshot(role, me, superadminEmails) {
    const feed = document.getElementById("activity-feed");

    db.collection("logs")
        .orderBy("time", "desc")
        .limit(50)
        .onSnapshot(snapshot => {

            // ── Collect all matching logs first ───────────────────────────
            const matchedLogs = [];

            snapshot.forEach(doc => {
                const log = doc.data() || {};
                const action = (log.action || "").toLowerCase();
                const logUser = (log.user || "").toLowerCase();

                let show = false;

                if (role === 'superadmin') {
                    show = true;

                } else if (role === 'manager') {
                    const isAllowedAction =
                        action.includes('logged in') ||
                        action.includes('logged out') ||
                        action.includes('checked in') ||
                        action.includes('checked out');
                    const isSuperAdmin = superadminEmails.includes(logUser);
                    show = isAllowedAction && !isSuperAdmin;

                } else if (role === 'receptionist') {
                    const isAllowedAction =
                        action.includes('logged in') ||
                        action.includes('logged out') ||
                        action.includes('checked in') ||
                        action.includes('checked out');
                    show = isAllowedAction && logUser === me;
                }

                if (show) matchedLogs.push(log);
            });

            // ── Sort by time descending (same fix as logs.html) ───────────
            // Mixed Firestore Timestamp + ISO string requires client-side sort
            matchedLogs.sort((a, b) => getMs(b.time) - getMs(a.time));

            // ── Render top 10 ─────────────────────────────────────────────
            feed.innerHTML = "";
            const top10 = matchedLogs.slice(0, 10);

            if (top10.length === 0) {
                feed.innerHTML = `
                    <li style="list-style:none;text-align:center;padding:20px;
                                color:#94a3b8;font-size:13px;">
                        <i class="fas fa-clipboard-list"
                           style="display:block;font-size:24px;margin-bottom:8px;"></i>
                        No activity to show.
                    </li>`;
                return;
            }

            top10.forEach(log => {
                const style = getActionStyle(log.action || '');
                const timeStr = formatLogTime(log.time);
                const initials = (log.user || 'U').split('@')[0].substring(0, 2).toUpperCase();

                const li = document.createElement("li");
                li.style.cssText = `
                    display:flex; align-items:flex-start; gap:12px;
                    padding:10px 0; border-bottom:1px solid #f1f5f9; list-style:none;
                `;
                li.innerHTML = `
                    <div style="width:34px;height:34px;border-radius:50%;
                                background:${style.bg};display:flex;align-items:center;
                                justify-content:center;flex-shrink:0;margin-top:2px;">
                        <i class="fas ${style.icon}"
                           style="color:${style.color};font-size:13px;"></i>
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:600;color:#1e293b;
                                    display:flex;align-items:center;gap:6px;">
                            <!-- Action badge — matches logs.html style -->
                            <span style="display:inline-flex;align-items:center;gap:4px;
                                         padding:2px 8px;border-radius:20px;font-size:11px;
                                         font-weight:600;background:${style.bg};color:${style.color};">
                                <i class="fas ${style.icon}" style="font-size:10px;"></i>
                                ${log.action || '—'}
                            </span>
                        </div>
                        <div style="font-size:12px;color:#64748b;margin-top:3px;">
                            ${log.user || '—'}
                        </div>
                        <div style="font-size:12px;color:#94a3b8;margin-top:2px;
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            ${log.details || ''}
                        </div>
                    </div>
                    <div style="font-size:11px;color:#94a3b8;white-space:nowrap;
                                margin-top:3px;text-align:right;min-width:80px;">
                        ${timeStr}
                    </div>
                `;
                feed.appendChild(li);
            });

        }, error => console.error("Activity feed error:", error));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dashboard data loader
// ─────────────────────────────────────────────────────────────────────────────
async function loadDashboardData() {
    if (typeof UI !== 'undefined' && UI.showLoader) UI.showLoader();

    try {
        if (typeof db === 'undefined') throw new Error("Firebase db is not initialized");

        // ── Rooms ─────────────────────────────────────────────────────────
        const roomsSnapshot = await db.collection('rooms').get();
        const roomsList = [];
        let rAvailable = 0, rOccupied = 0, rCleaning = 0;
        roomsSnapshot.forEach(doc => {
            const room = { id: doc.id, ...doc.data() };
            roomsList.push(room);
            const status = (room.status || '').toLowerCase();
            if (status === 'available') rAvailable++;
            else if (status === 'occupied') rOccupied++;
            else if (status === 'cleaning') rCleaning++;
        });

        // ── Guests ────────────────────────────────────────────────────────
        const guestsSnapshot = await db.collection('guests').get();
        const guestsCount = guestsSnapshot.size;
        const todayStr = new Date().toISOString().split('T')[0];
        let checkinsToday = 0;
        const allGuests = [];

        guestsSnapshot.forEach(doc => {
            const data = doc.data() || {};
            allGuests.push(data);
            const dateStr = getSafeDateString(data.checkinDateStr || data.checkinDate);
            if (dateStr && dateStr.startsWith(todayStr)) checkinsToday++;
        });

        // ── History (checkouts) ───────────────────────────────────────────
        const historySnapshot = await db.collection('history').get();
        let checkoutsToday = 0;
        const allHistory = [];

        historySnapshot.forEach(doc => {
            const data = doc.data() || {};
            allHistory.push(data);
            const dateStr = getSafeDateString(data.checkoutDateStr || data.checkoutDate);
            if (dateStr && dateStr.startsWith(todayStr)) checkoutsToday++;
        });

        // ── Update stat cards ─────────────────────────────────────────────
        const setStat = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setStat('stat-total-rooms', roomsList.length);
        setStat('stat-available-rooms', rAvailable);
        setStat('stat-occupied-rooms', rOccupied);
        setStat('stat-cleaning-rooms', rCleaning);
        setStat('stat-current-guests', guestsCount);
        setStat('stat-checkins', checkinsToday);
        setStat('stat-checkouts', checkoutsToday);

        renderRoomGrid(roomsList);
        renderWeekCalendar(allGuests, allHistory);

    } catch (error) {
        console.error("Dashboard load error:", error);
        if (typeof UI !== 'undefined' && UI.showNotification)
            UI.showNotification("Error loading dashboard: " + error.message, "error");
    } finally {
        if (typeof UI !== 'undefined' && UI.hideLoader) UI.hideLoader();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7-Day Calendar Strip
// ─────────────────────────────────────────────────────────────────────────────
function renderWeekCalendar(guests, history) {
    const strip = document.getElementById('week-strip');
    if (!strip) return;

    strip.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const checkinMap = {};
    const checkoutMap = {};

    guests.forEach(g => {
        const raw = getSafeDateString(g.checkinDateStr || g.checkinDate);
        if (!raw) return;
        const key = raw.split('T')[0];
        if (!checkinMap[key]) checkinMap[key] = [];
        checkinMap[key].push(g.name || g.guestName || 'Guest');
    });

    history.forEach(h => {
        const raw = getSafeDateString(h.checkoutDateStr || h.checkoutDate || h.expectedCheckout);
        if (!raw) return;
        const key = raw.split('T')[0];
        if (!checkoutMap[key]) checkoutMap[key] = [];
        checkoutMap[key].push(h.name || h.guestName || 'Guest');
    });

    guests.forEach(g => {
        const raw = getSafeDateString(g.expectedCheckout || g.checkoutDate);
        if (!raw) return;
        const key = raw.split('T')[0];
        const name = g.name || g.guestName || 'Guest';
        if (!checkoutMap[key]) checkoutMap[key] = [];
        if (!checkoutMap[key].includes(name)) checkoutMap[key].push(name);
    });

    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateKey = date.toISOString().split('T')[0];
        const isToday = i === 0;

        const ins = checkinMap[dateKey] || [];
        const outs = checkoutMap[dateKey] || [];

        const col = document.createElement('div');
        col.className = `day-col${isToday ? ' today' : ''}`;

        col.innerHTML = `
            <div class="day-header">
                <div class="day-name">${isToday ? 'Today' : DAY_NAMES[date.getDay()]}</div>
                <div class="day-number">${date.getDate()}</div>
                <div class="day-month">${MON_NAMES[date.getMonth()]}</div>
            </div>
        `;

        const body = document.createElement('div');
        body.className = 'day-body';
        const MAX_SHOW = 3;
        let pillCount = 0;

        ins.slice(0, MAX_SHOW).forEach(name => {
            if (pillCount >= MAX_SHOW) return;
            const pill = document.createElement('div');
            pill.className = 'event-pill checkin';
            pill.innerHTML = `<i class="fas fa-plane-arrival"></i> ${truncate(name, 10)}`;
            pill.title = name;
            body.appendChild(pill);
            pillCount++;
        });

        outs.slice(0, MAX_SHOW - pillCount).forEach(name => {
            if (pillCount >= MAX_SHOW) return;
            const pill = document.createElement('div');
            pill.className = 'event-pill checkout';
            pill.innerHTML = `<i class="fas fa-plane-departure"></i> ${truncate(name, 10)}`;
            pill.title = name;
            body.appendChild(pill);
            pillCount++;
        });

        const total = ins.length + outs.length;
        if (total > MAX_SHOW) {
            const more = document.createElement('div');
            more.style.cssText = 'font-size:11px;color:#94a3b8;text-align:center;margin-top:2px;font-weight:600;';
            more.textContent = `+${total - MAX_SHOW} more`;
            body.appendChild(more);
        }

        if (total === 0) {
            const empty = document.createElement('div');
            empty.className = 'day-empty';
            empty.textContent = 'No activity';
            body.appendChild(empty);
        }

        col.appendChild(body);

        const summary = document.createElement('div');
        summary.className = 'day-summary';

        if (ins.length > 0)
            summary.innerHTML += `<span class="summary-badge in"><i class="fas fa-arrow-down" style="font-size:8px;"></i> ${ins.length}</span>`;
        if (outs.length > 0)
            summary.innerHTML += `<span class="summary-badge out"><i class="fas fa-arrow-up" style="font-size:8px;"></i> ${outs.length}</span>`;
        if (ins.length === 0 && outs.length === 0)
            summary.innerHTML = `<span class="summary-badge zero">—</span>`;

        col.appendChild(summary);
        strip.appendChild(col);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Room Grid
// ─────────────────────────────────────────────────────────────────────────────
function renderRoomGrid(rooms) {
    const gridContainer = document.getElementById('visual-room-grid');
    if (!gridContainer) return;
    gridContainer.innerHTML = '';

    rooms.sort((a, b) => parseInt(a.number || 0) - parseInt(b.number || 0));

    if (rooms.length === 0) {
        gridContainer.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-light);">No rooms found.</p>';
        return;
    }

    rooms.forEach(room => {
        const statusStr = (room.status || 'available').toLowerCase();
        const card = document.createElement('div');
        card.className = `room-card status-${statusStr}`;
        card.innerHTML = `
            <div class="room-number">${room.number || 'N/A'}</div>
            <div class="room-type">${room.type || 'Standard'}</div>
            <div class="room-status-badge status-badge-${statusStr}">${room.status || 'Available'}</div>
        `;
        gridContainer.appendChild(card);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────
function truncate(str, len) {
    return str.length > len ? str.substring(0, len) + '…' : str;
}