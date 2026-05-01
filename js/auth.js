// auth.js
// ─────────────────────────────────────────────────────────────────────────────
// Authentication + Role-Based Access Control (RBAC)
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_PAGES = {
    superadmin:   [],
    manager:      ['roles.html'],
    receptionist: ['roles.html', 'logs.html'],
    observer:     ['roles.html', 'verification.html', 'logs.html', 'chat.html', 'reports.html', 'payments.html', 'invoice.html', 'filelibrary.html', 'chatroom.html'],
};

const WRITE_RESTRICTED_ROLES = ['manager', 'receptionist'];

window._userRole = null;

// ─────────────────────────────────────────────────────────────────────────────
// ✅ INACTIVITY AUTO-LOGOUT — 10 minutes
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    const TIMEOUT_MS = 10 * 60 * 1000;
    const WARN_MS    =  9 * 60 * 1000;
    let inactivityTimer, warnTimer;

    function createWarnBanner() {
        if (document.getElementById('inactivity-banner')) return;
        const b = document.createElement('div');
        b.id = 'inactivity-banner';
        b.style.cssText = `
            position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
            background:#1a2942; color:white; padding:14px 24px; border-radius:12px;
            font-size:14px; font-weight:600; z-index:999999;
            box-shadow:0 8px 32px rgba(0,0,0,0.25);
            display:flex; align-items:center; gap:12px;`;
        b.innerHTML = `
            <i class="fas fa-clock" style="color:#f59e0b;font-size:16px;"></i>
            <span>You will be logged out in <strong id="inactivity-countdown">60</strong> seconds due to inactivity.</span>
            <button onclick="window._resetInactivity()" style="
                background:#3b82f6; border:none; color:white; padding:6px 14px;
                border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; margin-left:4px;">
                Stay Logged In
            </button>`;
        document.body.appendChild(b);
        let seconds = 60;
        const countEl = document.getElementById('inactivity-countdown');
        const iv = setInterval(() => {
            seconds--;
            if (countEl) countEl.textContent = seconds;
            if (seconds <= 0) clearInterval(iv);
        }, 1000);
        b._interval = iv;
    }

    function removeWarnBanner() {
        const b = document.getElementById('inactivity-banner');
        if (b) { clearInterval(b._interval); b.remove(); }
    }

    async function doLogout() {
        removeWarnBanner();
        const user = firebase.auth().currentUser;
        if (user) {
            try {
                await _writeLog(user.email, "Auto Logged Out", "Session expired due to inactivity");
            } catch (e) { console.error('[Auth] Auto logout log failed:', e); }
        }
        sessionStorage.clear();
        await firebase.auth().signOut();
        window.location.replace('admin.html');
    }

    function resetTimers() {
        clearTimeout(inactivityTimer);
        clearTimeout(warnTimer);
        removeWarnBanner();
        warnTimer       = setTimeout(createWarnBanner, WARN_MS);
        inactivityTimer = setTimeout(doLogout, TIMEOUT_MS);
    }

    window._resetInactivity = resetTimers;

    ['mousemove','mousedown','keydown','touchstart','scroll','click'].forEach(evt =>
        document.addEventListener(evt, resetTimers, { passive: true })
    );

    document.addEventListener('DOMContentLoaded', () => {
        if (!_isLoginPage())
            firebase.auth().onAuthStateChanged(u => { if (u) resetTimers(); });
        else {
            clearTimeout(inactivityTimer);
            clearTimeout(warnTimer);
        }
    });
})();

// ─────────────────────────────────────────────────────────────────────────────
// ✅ RECORD LOG when device goes to sleep / browser is closed
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    if (_isLoginPage()) return;

    let hiddenTimer = null;
    let logWritten  = false;
    const HIDDEN_MS = 5 * 60 * 1000;

    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden') {
            hiddenTimer = setTimeout(async () => {
                if (logWritten) return;
                const user = firebase.auth().currentUser;
                if (!user) return;
                logWritten = true;
                try {
                    await _writeLog(user.email, "User Logged Out",
                        `${user.email} — browser closed or device went to sleep`);
                } catch (e) {
                    try {
                        const projectId = firebase.app().options.projectId;
                        const url  = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/logs`;
                        const body = JSON.stringify({ fields: {
                            user:    { stringValue: user.email },
                            action:  { stringValue: "User Logged Out" },
                            details: { stringValue: `${user.email} — browser closed or device went to sleep` },
                            time:    { stringValue: new Date().toISOString() },
                        }});
                        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
                    } catch (beaconErr) {
                        console.warn('[Auth] Beacon fallback also failed:', beaconErr);
                    }
                }
            }, HIDDEN_MS);
        } else if (document.visibilityState === 'visible') {
            clearTimeout(hiddenTimer);
            logWritten = false;
        }
    });
})();

// ─────────────────────────────────────────────────────────────────────────────
// ✅ PREVENT BACK BUTTON after logout
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    if (!_isLoginPage()) {
        history.pushState(null, '', window.location.href);
        window.addEventListener('popstate', () => {
            firebase.auth().onAuthStateChanged(u => {
                if (!u) window.location.replace('admin.html');
                else history.pushState(null, '', window.location.href);
            });
        });
    }
})();

// ─────────────────────────────────────────────────────────────────────────────
// ✅ ACCESS DENIED OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function showAccessDenied(redirectTo = 'dashboard.html') {
    if (document.getElementById('access-denied-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'access-denied-overlay';
    overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(13,17,23,0.88);
        display:flex; align-items:center; justify-content:center;
        z-index:999999; backdrop-filter:blur(8px);`;
    overlay.innerHTML = `
        <div style="background:white; border-radius:20px; padding:48px 40px;
            text-align:center; max-width:380px; width:90%;
            box-shadow:0 32px 80px rgba(0,0,0,0.3);
            animation:adPop 0.4s cubic-bezier(0.34,1.56,0.64,1) both;">
            <style>@keyframes adPop{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}</style>
            <div style="width:72px;height:72px;border-radius:50%;background:#fef2f2;
                display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
                <i class="fas fa-lock" style="color:#ef4444;font-size:28px;"></i>
            </div>
            <h2 style="font-size:22px;font-weight:700;color:#1e293b;margin-bottom:10px;">Access Denied</h2>
            <p style="font-size:14px;color:#64748b;line-height:1.6;margin-bottom:6px;">
                You don't have permission to access this page.</p>
            <p style="font-size:13px;color:#94a3b8;margin-bottom:20px;">Redirecting to Dashboard...</p>
            <div style="height:4px;background:#f1f5f9;border-radius:4px;overflow:hidden;">
                <div id="ad-progress-bar" style="height:100%;background:#ef4444;width:0%;
                    transition:width 2s linear;border-radius:4px;"></div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => { const b = document.getElementById('ad-progress-bar'); if (b) b.style.width = '100%'; }, 100);
    setTimeout(() => window.location.href = redirectTo, 2300);
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ LOAD USER ROLE
// ─────────────────────────────────────────────────────────────────────────────
async function loadUserRole(uid) {
    try {
        console.log(`[Auth] Looking up UID: ${uid}`);
        const docRef = db.collection('users').doc(uid);
        const doc    = await docRef.get();

        if (doc.exists) {
            const data = doc.data();

            // ── Block pending users ───────────────────────────────────────
            if (data.status === 'pending') {
                console.warn('[Auth] User is pending approval — signing out');
                sessionStorage.clear();
                await firebase.auth().signOut();
                window.location.replace('admin.html?status=pending');
                return null;
            }

            // ── Block rejected users ──────────────────────────────────────
            if (data.status === 'rejected') {
                console.warn('[Auth] User is rejected — signing out');
                sessionStorage.clear();
                await firebase.auth().signOut();
                window.location.replace('admin.html?status=rejected');
                return null;
            }

            const role = (data.role || 'observer').trim().toLowerCase();
            window._userRole = role;
            console.log(`[Auth] ✅ Role resolved: "${role}"`);

        } else {
            // ── ⚠️ NO FIRESTORE DOC FOUND ────────────────────────────────
            // This happens when:
            //   1. A rejected user's doc was deleted but their Auth account remains
            //   2. Someone signed up via Firebase Auth without going through register.html
            //
            // NEVER auto-promote. Always block and sign out.
            console.warn('[Auth] No Firestore doc for this UID — blocking access');
            sessionStorage.clear();
            await firebase.auth().signOut();
            window.location.replace('admin.html?status=unregistered');
            return null;
        }

    } catch (e) {
        console.error('[Auth] ❌ Firestore read failed:', e.code, e.message);
        // On error, default to observer — never superadmin
        window._userRole = 'observer';
    }
    return window._userRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ ENFORCE PAGE ACCESS
// ─────────────────────────────────────────────────────────────────────────────
function enforceAccess(role) {
    if (!role) return false; // loadUserRole returned null — already redirecting

    const page           = _currentPage();
    const normalisedRole = BLOCKED_PAGES.hasOwnProperty(role) ? role : 'observer';
    const blocked        = BLOCKED_PAGES[normalisedRole];

    console.log(`[Auth] Enforcing — role: "${normalisedRole}", page: "${page}"`);

    if (blocked.includes(page)) {
        showAccessDenied('dashboard.html');
        return false;
    }

    _applyNavVisibility(normalisedRole);
    _showRoleBadge(normalisedRole);

    if (normalisedRole === 'observer') {
        const fn = () => _applyObserverMode();
        fn();
        new MutationObserver(fn).observe(document.body, { childList: true, subtree: true });
    }

    if (WRITE_RESTRICTED_ROLES.includes(normalisedRole)) {
        const fn = () => _applyWriteRestrictedMode();
        fn();
        new MutationObserver(fn).observe(document.body, { childList: true, subtree: true });
    }

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nav visibility
// ─────────────────────────────────────────────────────────────────────────────
function _applyNavVisibility(role) {
    const blocked = BLOCKED_PAGES[role] || [];
    blocked.forEach(blockedPage => {
        document.querySelectorAll(`a[href="${blockedPage}"]`).forEach(el => el.style.display = 'none');
    });

    if (role !== 'superadmin') {
        document.querySelectorAll('a[href="roles.html"]').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.menu-label').forEach(label => {
            if (label.textContent.trim() === 'Administration') label.style.display = 'none';
        });
    }

    document.querySelectorAll('.sidebar-menu').forEach(el => { el.style.visibility = 'visible'; });
}

function _applyObserverMode() {
    _lockButtons([
        '#add-room-btn','#add-guest-btn',
        '#submitBookingBtn','#confirm-checkout-btn','#confirm-delete-btn',
        'button[onclick*="delete"]','button[onclick*="Delete"]',
        'button[onclick*="edit"]','button[onclick*="Edit"]',
        'button[onclick*="openAdd"]','button[onclick*="confirm"]',
        '.action-btn.delete','.edit-btn','.delete-btn',
        '.btn-primary[type="submit"]',
    ], 'observerLocked', 'You have read-only access');
}

function _applyWriteRestrictedMode() {
    _lockButtons([
        '#add-room-btn','#add-guest-btn',
        '#confirm-delete-btn','#confirm-delete-guest-btn',
        'button[onclick*="deleteRoom"]','button[onclick*="deleteGuest"]',
        'button[onclick*="editRoom"]','button[onclick*="openEdit"]',
        '.edit-btn','.delete-btn',
        '.edit-room-btn','.delete-room-btn',
        '.edit-guest-btn','.delete-guest-btn',
    ], 'writeLocked', 'Only Super Admin can perform this action');
}

function _lockButtons(selectors, lockKey, tooltip) {
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (el.dataset[lockKey]) return;
            el.dataset[lockKey] = '1';
            el.disabled = true;
            el.style.opacity = '0.4';
            el.style.cursor = 'not-allowed';
            el.style.pointerEvents = 'none';
            el.title = tooltip;
        });
    });
}

function _showRoleBadge(role) {
    const emailEl = document.getElementById('user-email-display');
    if (!emailEl) return;
    const meta = {
        superadmin:   { label: 'Super Admin',  bg: '#dbeafe', color: '#1e40af' },
        manager:      { label: 'Admin',      bg: '#dcfce7', color: '#15803d' },
        receptionist: { label: 'Receptionist', bg: '#fef3c7', color: '#854d0e' },
        observer:     { label: 'Observer',     bg: '#f3e8ff', color: '#6b21a8' },
    };
    const m = meta[role] || { label: role, bg: '#f1f5f9', color: '#64748b' };
    if (document.getElementById('role-badge-display')) return;
    const badge = document.createElement('span');
    badge.id = 'role-badge-display';
    badge.style.cssText = `
        display:inline-block; padding:2px 8px; border-radius:10px;
        font-size:11px; font-weight:600; margin-left:6px;
        background:${m.bg}; color:${m.color};`;
    badge.textContent = m.label;
    emailEl.parentNode.insertBefore(badge, emailEl.nextSibling);
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ MAIN DOMContentLoaded
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // Hide page instantly to prevent flash of protected content after logout
    if (!_isLoginPage()) {
        document.body.style.visibility = 'hidden';
        document.body.style.opacity = '0';
    }

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            if (_isLoginPage()) {
                return;
            } else {
                // Auth confirmed — reveal the page
                document.body.style.visibility = 'visible';
                document.body.style.opacity = '1';

                const emailEl = document.getElementById('user-email-display');
                if (emailEl) emailEl.textContent = adminEmailName(user.email);
                loadDisplayName(user.uid);

                const role = await loadUserRole(user.uid);
                if (role) enforceAccess(role);
            }
        } else {
            if (!_isLoginPage()) window.location.replace('admin.html');
        }
    });

    // ── Logout button ─────────────────────────────────────────────────────
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (logoutBtn.dataset.loggingOut) return;
            logoutBtn.dataset.loggingOut = '1';

            const original = logoutBtn.innerHTML;
            logoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing out…';
            logoutBtn.style.opacity = '0.6';
            logoutBtn.style.pointerEvents = 'none';

            try {
                const user = firebase.auth().currentUser;
                if (user) await _writeLog(user.email, "User Logged Out", `${user.email} signed out`);
                sessionStorage.removeItem("gtec_logged_in");
                await auth.signOut();
            } catch (error) {
                logoutBtn.innerHTML = original;
                logoutBtn.style.opacity = '';
                logoutBtn.style.pointerEvents = '';
                delete logoutBtn.dataset.loggingOut;
                UI.showNotification('Error signing out', 'error');
            }
        });
    }

    // ── Mobile sidebar toggle ─────────────────────────────────────────────
    const toggleBtn = document.getElementById('toggle-sidebar');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            document.querySelector('.sidebar')?.classList.toggle('show');
        });
    }

    setCurrentNavActive();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function _isLoginPage() {
    return window.location.pathname.endsWith('admin.html')
        || window.location.pathname.endsWith('admin')
        || window.location.pathname.endsWith('register.html')
        || window.location.pathname.endsWith('register')
        || window.location.pathname === '/'
        || window.location.pathname.endsWith('GuestHouseSystem/');
}

function _currentPage() {
    return window.location.pathname.split('/').pop() || 'dashboard.html';
}

function adminEmailName(email) {
    if (!email) return "Admin";
    return email.split('@')[0];
}

// Call this after role loads to swap email prefix with real name
async function loadDisplayName(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
            const name = doc.data().name;
                if (name) {
        const el = document.getElementById('user-email-display');
        if (el) el.textContent = name; // Full name
    }
        }
    } catch(e) { console.warn('[Auth] Could not load display name:', e); }
}

function setCurrentNavActive() {
    const current = window.location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.menu-item').forEach(link => {
        link.getAttribute('href') === current
            ? link.classList.add('active')
            : link.classList.remove('active');
    });
}

function _writeLog(email, action, details = "") {
    return db.collection("logs").add({
        user:    email || "unknown",
        action:  action,
        details: details,
        time:    firebase.firestore.FieldValue.serverTimestamp(),
    })
    .then(() => console.log(`[Log] ✅ ${action}`))
    .catch(err => console.error("[Log] ❌ Failed:", err));
}

function addLog(action, details = "") {
    const user = firebase.auth().currentUser;
    if (!user) { console.warn("[Log] Skipped — no authenticated user"); return Promise.resolve(); }
    return _writeLog(user.email, action, details);
}