// roles.js
// ─────────────────────────────────────────────────────────────────────────────
// User Roles Management — Super Admin only
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_META = {
    superadmin:   { label: 'Super Admin',  bg: '#dbeafe', color: '#1e40af', icon: 'fa-crown',    hint: 'Full access — can create, edit, delete everything including user roles.' },
    admin:        { label: 'Admin',        bg: '#dcfce7', color: '#15803d', icon: 'fa-user-shield', hint: 'Can create, edit and delete records and use Monitoring & Auditing. Cannot manage user roles.' },
    manager:      { label: 'Manager',      bg: '#cffafe', color: '#0e7490', icon: 'fa-user-gear',   hint: 'Can create and edit records. Cannot delete records, open Monitoring or manage user roles.' },
    receptionist: { label: 'Receptionist', bg: '#fef3c7', color: '#854d0e', icon: 'fa-user-tie',     hint: 'Can check guests in/out and create records. Cannot edit or delete records, or open Logs and Monitoring.' },
    observer:     { label: 'Observer',     bg: '#f3e8ff', color: '#6b21a8', icon: 'fa-eye',      hint: 'Read-only access. Cannot open sensitive pages (Verification, Logs, Chat, Reports, Payments, Invoice, Monitoring).' },
};

let allUsers      = [];
let pendingUsers  = [];
let lockedEmails  = new Set();
let currentUserUid = null;

// ── Pagination (10 rows per page) ────────────────────────────────────────────
const PAGE_SIZE  = 10;
const pageState  = { users: 1, clients: 1 };
let usersView    = [];   // the list (after search) currently shown in System Users
let clientsView  = [];   // the list (after search) currently shown in Clients

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(user => {
        if (user) currentUserUid = user.uid;
    });

    loadAllData();
    setupModalTriggers();
    setupAddUserForm();
    setupRoleModal();
    setupDeleteModal();
    setupResetPasswordModal();
    setupSearch();
    setupPendingModals();
    setupClientSection();
});

// ─────────────────────────────────────────────────────────────────────────────
// Load everything in one shot
// ─────────────────────────────────────────────────────────────────────────────
async function loadAllData() {
    try {
        const [usersSnap, lockedSnap] = await Promise.all([
            db.collection('users').orderBy('createdAt', 'desc').get(),
            db.collection('loginAttempts').where('locked', '==', true).get(),
        ]);

        // Build locked set
        lockedEmails = new Set();
        lockedSnap.forEach(doc => {
            const d = doc.data();
            if (d.email) lockedEmails.add(d.email.toLowerCase());
        });

        // Split into active vs pending (rejected are hidden from both tables)
        allUsers     = [];
        pendingUsers = [];
        usersSnap.forEach(doc => {
            const data = { uid: doc.id, ...doc.data() };
            if (data.status === 'rejected') return; // never show rejected users
            if (data.status === 'pending') {
                pendingUsers.push(data);
            } else {
                allUsers.push(data);
            }
        });

        renderUsersTable(allUsers);
        renderPendingTable();
        loadClients();

    } catch (e) {
        console.error('[Roles] Load error:', e);
        document.getElementById('users-table-body').innerHTML =
            `<tr><td colspan="5" style="text-align:center;padding:40px;color:#ef4444;">
                <i class="fas fa-exclamation-circle"></i> Failed to load users. Check Firestore rules.
             </td></tr>`;
    }
}

// Alias so approve/reject can trigger a full refresh
function loadUsers()  { loadAllData(); }

// ─────────────────────────────────────────────────────────────────────────────
// Render ACTIVE users table
// ─────────────────────────────────────────────────────────────────────────────
function renderUsersTable(fullList, resetPage) {
    const tbody = document.getElementById('users-table-body');
    const countBadge = document.getElementById('users-count-badge');
    if (countBadge) countBadge.textContent = allUsers.length;

    usersView = fullList;
    if (resetPage) pageState.users = 1;
    const users = pageSlice(fullList, 'users');
    renderPager('users-pager', fullList.length, 'users');

    if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-light);">No users found.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    users.forEach(user => {
        const meta     = ROLE_META[user.role] || { label: user.role, bg: '#f1f5f9', color: '#64748b', icon: 'fa-user' };
        const isYou    = user.uid === currentUserUid;
        const isLocked = lockedEmails.has((user.email || '').toLowerCase());

        const createdAt = user.createdAt?.toDate
            ? user.createdAt.toDate().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
            : '—';

        const lockBadge = isLocked ? `
            <span title="Account locked — too many failed login attempts"
                  style="display:inline-flex;align-items:center;gap:3px;font-size:10px;
                         background:#fef2f2;color:#dc2626;padding:1px 7px;border-radius:8px;
                         margin-left:6px;font-weight:600;border:1px solid #fecaca;">
                <i class="fas fa-lock" style="font-size:9px;"></i> Locked
            </span>` : '';

        const isDisabled = user.status === 'disabled';
        const disabledBadge = isDisabled ? `
            <span title="Account deactivated by Super Admin"
                  style="display:inline-flex;align-items:center;gap:3px;font-size:10px;
                         background:#f1f5f9;color:#475569;padding:1px 7px;border-radius:8px;
                         margin-left:6px;font-weight:600;border:1px solid #cbd5e1;">
                <i class="fas fa-ban" style="font-size:9px;"></i> Deactivated
            </span>` : '';

        const tr = document.createElement('tr');
        if (isLocked) tr.style.background = '#fff8f8';
        if (isDisabled) { tr.style.background = '#f8fafc'; tr.style.opacity = '0.7'; }

        tr.innerHTML = `
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:34px;height:34px;border-radius:50%;
                                background:${isLocked ? '#fef2f2' : meta.bg};
                                display:flex;align-items:center;justify-content:center;flex-shrink:0;
                                ${isLocked ? 'border:1.5px solid #fecaca;' : ''}overflow:hidden;">
                        ${user.photoURL ? `<img src="${escHtml(user.photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : ''}
                    <i class="fas ${isLocked ? 'fa-lock' : meta.icon}"
                           style="color:${isLocked ? '#dc2626' : meta.color};font-size:13px;${user.photoURL ? 'display:none;' : ''}"></i>
                    </div>
                    <div style="font-weight:600;font-size:14px;">
                        ${escHtml(user.name || '—')}
                        ${isYou ? '<span style="font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:600;">You</span>' : ''}
                        ${lockBadge}${disabledBadge}
                    </div>
                </div>
            </td>
            <td style="font-size:13px;color:var(--text-light);">${escHtml(user.email || '—')}</td>
            <td>
                <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;
                             border-radius:20px;font-size:12px;font-weight:600;
                             background:${meta.bg};color:${meta.color};">
                    <i class="fas ${meta.icon}" style="font-size:10px;"></i> ${meta.label}
                </span>
            </td>
            <td style="font-size:13px;color:var(--text-light);">${createdAt}</td>
            <td style="text-align:center;white-space:nowrap;">
                <button class="btn btn-sm btn-outline change-role-btn"
                        data-uid="${user.uid}" data-email="${escHtml(user.email)}" data-role="${user.role}"
                        title="Change Role"
                        ${isYou ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>
                    <i class="fas fa-user-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline reset-password-btn"
                        data-email="${escHtml(user.email)}" data-name="${escHtml(user.name || user.email)}"
                        title="${isLocked ? 'Unlock & Send Password Reset Email' : 'Send Password Reset Email'}"
                        style="color:#f59e0b;margin-left:4px;${isLocked ? 'box-shadow:0 0 0 2px #fecaca;' : ''}">
                    <i class="fas ${isLocked ? 'fa-unlock' : 'fa-key'}"></i>
                </button>
                <button class="btn btn-sm btn-outline delete-user-btn"
                        data-uid="${user.uid}" data-email="${escHtml(user.email)}"
                        title="Remove User" style="color:#ef4444;margin-left:4px;"
                        ${isYou ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.change-role-btn').forEach(btn =>
        btn.addEventListener('click', () => openRoleModal(btn.dataset.uid, btn.dataset.email, btn.dataset.role)));
    document.querySelectorAll('.reset-password-btn').forEach(btn =>
        btn.addEventListener('click', () => openResetPasswordModal(btn.dataset.email, btn.dataset.name)));
    document.querySelectorAll('.delete-user-btn').forEach(btn =>
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.uid, btn.dataset.email)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Render PENDING table
// ─────────────────────────────────────────────────────────────────────────────
function renderPendingTable() {
    const section = document.getElementById('pending-section');
    const tbody   = document.getElementById('pending-table-body');
    const badge   = document.getElementById('pending-count-badge');

    badge.textContent = pendingUsers.length;

    if (!pendingUsers.length) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    tbody.innerHTML = '';

    pendingUsers.forEach(user => {
        const createdAt = user.createdAt?.toDate
            ? user.createdAt.toDate().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
            : '—';

        const methodIcon = user.registrationMethod === 'google'
            ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#3c4043;">
                   <svg viewBox="0 0 24 24" style="width:13px;height:13px;flex-shrink:0;">
                       <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                       <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                       <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                       <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                   </svg> Google
               </span>`
            : `<span style="font-size:12px;font-weight:600;color:#64748b;">
                   <i class="fas fa-envelope" style="margin-right:4px;"></i>Email
               </span>`;

        const tr = document.createElement('tr');
        tr.style.background = '#fffbeb';
        tr.innerHTML = `
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:34px;height:34px;border-radius:50%;background:#fef9ec;
                                display:flex;align-items:center;justify-content:center;flex-shrink:0;
                                border:1.5px solid #fde68a;">
                        <i class="fas fa-user-clock" style="color:#d97706;font-size:13px;"></i>
                    </div>
                    <div style="font-weight:600;font-size:14px;">${escHtml(user.name || '—')}</div>
                </div>
            </td>
            <td style="font-size:13px;color:#64748b;">${escHtml(user.email || '—')}</td>
            <td>${methodIcon}</td>
            <td style="font-size:13px;color:#64748b;">${createdAt}</td>
            <td style="text-align:center;white-space:nowrap;">
                <button class="approve-btn"
                        data-uid="${user.uid}"
                        data-name="${escHtml(user.name || '')}"
                        data-email="${escHtml(user.email || '')}">
                    <i class="fas fa-check"></i> Approve
                </button>
                <button class="reject-btn"
                        data-uid="${user.uid}"
                        data-email="${escHtml(user.email || '')}">
                    <i class="fas fa-times"></i> Reject
                </button>
            </td>`;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.approve-btn').forEach(btn =>
        btn.addEventListener('click', () => openApproveModal(btn.dataset.uid, btn.dataset.name, btn.dataset.email)));
    document.querySelectorAll('.reject-btn').forEach(btn =>
        btn.addEventListener('click', () => openRejectModal(btn.dataset.uid, btn.dataset.email)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending modals
// ─────────────────────────────────────────────────────────────────────────────
function setupPendingModals() {

    // ── Approve ───────────────────────────────────────────────────────────
    document.getElementById('confirm-approve-btn').addEventListener('click', async () => {
        const uid   = document.getElementById('approve-user-uid').value;
        const role  = document.getElementById('approve-role-select').value;
        const email = document.getElementById('approve-user-email').textContent;
        const btn   = document.getElementById('confirm-approve-btn');

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Approving…';

        try {
            await db.collection('users').doc(uid).update({
                role,
                status: 'active',
                permissions: ROLE_PERM_DEFAULTS[role] || ROLE_PERM_DEFAULTS.observer,
                pageAccess:  ROLE_PAGE_DEFAULTS[role] || ['dashboard'],
            });
            await addLog('User Approved', `${email} approved as ${ROLE_META[role]?.label || role}`);
            UI.showNotification(`✅ ${email} approved as ${ROLE_META[role]?.label || role}!`, 'success');
            closeModal('approve-modal');
            loadAllData();
        } catch (err) {
            console.error('[Roles] Approve error:', err);
            UI.showNotification('Failed to approve: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Approve & Assign Role';
        }
    });

    // ── Reject ────────────────────────────────────────────────────────────
    // ⚠️  We do NOT delete the Firestore doc.
    // Deleting it would let the user log back in and trigger the
    // "no doc found → create superadmin" fallback in auth.js.
    // Instead we mark status: 'rejected' so auth.js blocks them permanently.
    document.getElementById('confirm-reject-btn').addEventListener('click', async () => {
        const uid   = document.getElementById('reject-user-uid').value;
        const email = document.getElementById('reject-user-email').textContent;
        const btn   = document.getElementById('confirm-reject-btn');

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rejecting…';

        try {
            await db.collection('users').doc(uid).update({
                status: 'rejected',
                rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            await addLog('User Rejected', `${email} registration rejected`);
            UI.showNotification(`${email} has been rejected.`, 'success');
            closeModal('reject-modal');
            loadAllData();
        } catch (err) {
            console.error('[Roles] Reject error:', err);
            UI.showNotification('Failed to reject: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash"></i> Reject & Remove';
        }
    });
}

function openApproveModal(uid, name, email) {
    document.getElementById('approve-user-uid').value          = uid;
    document.getElementById('approve-user-name').textContent   = name;
    document.getElementById('approve-user-email').textContent  = email;
    document.getElementById('approve-role-select').value       = 'receptionist';
    openModal('approve-modal');
}

function openRejectModal(uid, email) {
    document.getElementById('reject-user-uid').value         = uid;
    document.getElementById('reject-user-email').textContent = email;
    openModal('reject-modal');
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal open/close helpers
// ─────────────────────────────────────────────────────────────────────────────
function setupModalTriggers() {
    document.getElementById('add-user-btn').addEventListener('click', () => {
        document.getElementById('add-user-form').reset();
        document.getElementById('role-hint').style.display = 'none';
        openModal('add-user-modal');
    });

    document.querySelectorAll('.close-modal').forEach(btn =>
        btn.addEventListener('click', () => closeModal('add-user-modal')));
    document.querySelectorAll('.close-role-modal').forEach(btn =>
        btn.addEventListener('click', () => closeModal('role-modal')));
    document.querySelectorAll('.close-delete-modal').forEach(btn =>
        btn.addEventListener('click', () => closeModal('delete-user-modal')));
    document.querySelectorAll('.close-reset-modal').forEach(btn =>
        btn.addEventListener('click', () => closeModal('reset-password-modal')));

    ['add-user-modal','role-modal','delete-user-modal','reset-password-modal','approve-modal','reject-modal','deactivate-modal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', e => { if (e.target.id === id) closeModal(id); });
    });

    document.getElementById('toggle-password').addEventListener('click', () => {
        const input = document.getElementById('new-user-password');
        const icon  = document.querySelector('#toggle-password i');
        input.type  = input.type === 'password' ? 'text' : 'password';
        icon.className = input.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    document.getElementById('new-user-role').addEventListener('change', function () {
        const hint = document.getElementById('role-hint');
        const meta = ROLE_META[this.value];
        if (meta) {
            hint.style.display = 'block';
            hint.innerHTML = `<i class="fas ${meta.icon}" style="color:${meta.color};margin-right:6px;"></i>
                              <span style="color:${meta.color};font-weight:600;">${meta.label}:</span>
                              <span style="color:var(--text-light);margin-left:4px;">${meta.hint}</span>`;
        } else {
            hint.style.display = 'none';
        }
    });
}

function openModal(id)  { document.getElementById(id).classList.add('active');    }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ─────────────────────────────────────────────────────────────────────────────
// Add User Form (Super Admin manually adds a user — skips pending)
// ─────────────────────────────────────────────────────────────────────────────
function setupAddUserForm() {
    document.getElementById('add-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name     = document.getElementById('new-user-name').value.trim();
        const email    = document.getElementById('new-user-email').value.trim();
        const password = document.getElementById('new-user-password').value;
        const role     = document.getElementById('new-user-role').value;

        if (!name || !email || !password || !role) {
            UI.showNotification('Please fill in all fields.', 'error');
            return;
        }

        const btn = document.getElementById('create-user-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…';

        try {
            const secondaryApp  = firebase.initializeApp(firebase.app().options, 'secondaryAuth_' + Date.now());
            const secondaryAuth = secondaryApp.auth();
            const credential    = await secondaryAuth.createUserWithEmailAndPassword(email, password);
            const newUid        = credential.user.uid;

            await credential.user.updateProfile({ displayName: name });
            await secondaryAuth.signOut();
            await secondaryApp.delete();

            // Admin-created users are active immediately — no pending
            await db.collection('users').doc(newUid).set({
                uid:    newUid,
                email,
                name,
                role,
                status: 'active',
                permissions: ROLE_PERM_DEFAULTS[role] || ROLE_PERM_DEFAULTS.observer,
                pageAccess:  ROLE_PAGE_DEFAULTS[role] || ['dashboard'],
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

            await addLog('User Created', `${email} added as ${ROLE_META[role]?.label || role}`);
            UI.showNotification(`✅ ${name} created successfully as ${ROLE_META[role]?.label || role}!`, 'success');
            closeModal('add-user-modal');
            loadAllData();

        } catch (err) {
            console.error('[Roles] Create user error:', err);
            let msg = err.message;
            if (err.code === 'auth/email-already-in-use') msg = 'That email address is already registered.';
            if (err.code === 'auth/weak-password')        msg = 'Password must be at least 6 characters.';
            if (err.code === 'auth/invalid-email')        msg = 'Please enter a valid email address.';
            UI.showNotification(msg, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-user-plus"></i> Create User';
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Change Role Modal
// ─────────────────────────────────────────────────────────────────────────────
function openRoleModal(uid, email, currentRole) {

    document.getElementById('role-modal-uid').value         = uid;
    document.getElementById('role-modal-email').textContent = email;
    document.getElementById('role-select').value            = currentRole;

    // Load saved permissions from the user object, fall back to role defaults
    const user = allUsers.find(u => u.uid === uid) || {};
    if (user.permissions) {
        setPermissions(user.permissions);
    } else {
        applyRoleDefaults(currentRole);
    }

    // Load saved page access, fall back to role defaults
    if (Array.isArray(user.pageAccess)) {
        setPageAccess(user.pageAccess);
    } else {
        applyRolePageDefaults(currentRole);
    }

    setChannelAccess(Array.isArray(user.hiddenChannels) ? user.hiddenChannels : []);
    openModal('role-modal');
}

function setupRoleModal() {

    // Auto-update permission checkboxes when role dropdown changes
    document.getElementById('role-select').addEventListener('change', function () {
        applyRoleDefaults(this.value);
        applyRolePageDefaults(this.value);
    });

    document.getElementById('save-role-btn').addEventListener('click', async () => {
        const uid     = document.getElementById('role-modal-uid').value;
        const email   = document.getElementById('role-modal-email').textContent;
        const newRole = document.getElementById('role-select').value;
        const btn     = document.getElementById('save-role-btn');

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

        try {
            const permissions = getPermissions();
            const pageAccess = newRole === 'superadmin' ? _ALL_PAGES : getPageAccess();
            const hiddenChannels = newRole === 'superadmin' ? [] : getHiddenChannels();
            await db.collection('users').doc(uid).update({ role: newRole, permissions, pageAccess, hiddenChannels });
            await addLog('Role Changed', `${email} → ${ROLE_META[newRole]?.label || newRole} | create:${permissions.canCreate} edit:${permissions.canEdit} delete:${permissions.canDelete}`);
            UI.showNotification(`Role updated to ${ROLE_META[newRole]?.label || newRole}`, 'success');
            closeModal('role-modal');
            loadAllData();
        } catch (err) {
            console.error('[Roles] Role update error:', err);
            UI.showNotification('Failed to update role: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Save Role';
        }
    });
}

// ── Permission helpers ────────────────────────────────────────────────────────
const PERM_COLORS = { create: '#3b82f6', edit: '#f59e0b', delete: '#ef4444', fullaccess: '#8b5cf6' };

const ROLE_PERM_DEFAULTS = {
    superadmin:   { canCreate: true,  canEdit: true,  canDelete: true,  fullButtonAccess: true  },
    admin:        { canCreate: true,  canEdit: true,  canDelete: true,  fullButtonAccess: false },
    manager:      { canCreate: true,  canEdit: true,  canDelete: false, fullButtonAccess: false },
    receptionist: { canCreate: true,  canEdit: false, canDelete: false, fullButtonAccess: false },
    observer:     { canCreate: false, canEdit: false, canDelete: false, fullButtonAccess: false },
};

// ── Page access ───────────────────────────────────────────────────────────────
// key = html file name without ".html"
const PAGE_LIST = [
    { key: 'dashboard',    label: 'Dashboard',       icon: 'fa-chart-pie' },
    { key: 'rooms',        label: 'Rooms',           icon: 'fa-bed' },
    { key: 'checkin',      label: 'Check-In',        icon: 'fa-sign-in-alt' },
    { key: 'checkout',     label: 'Check-Out',       icon: 'fa-sign-out-alt' },
    { key: 'guests',       label: 'Guests',          icon: 'fa-users' },
    { key: 'chatroom',     label: 'Chat Room',       icon: 'fa-comments' },
    { key: 'logs',         label: 'Logs',            icon: 'fa-clipboard-list' },
    { key: 'chat',         label: 'General Inquiries', icon: 'fa-comment' },
    { key: 'client-requests', label: 'Client Requests', icon: 'fa-concierge-bell' },
    { key: 'verification', label: 'Verification',    icon: 'fa-user-check' },
    { key: 'invoice',      label: 'Invoice',         icon: 'fa-file-invoice' },
    { key: 'payments',     label: 'Payments',        icon: 'fa-credit-card' },
    { key: 'calendar',     label: 'Calendar',        icon: 'fa-calendar-alt' },
    { key: 'filelibrary',  label: 'File Library',    icon: 'fa-folder-open' },
    { key: 'reports',      label: 'Reports',         icon: 'fa-chart-bar' },
    { key: 'monitoring',   label: 'Monitoring & Auditing', icon: 'fa-shield-halved' },
    { key: 'profile',      label: 'My Profile',      icon: 'fa-circle-user' },
    { key: 'roles',        label: 'User Roles',      icon: 'fa-shield-alt' },
];

const _ALL_PAGES = PAGE_LIST.map(p => p.key);
const _without = (...omit) => _ALL_PAGES.filter(k => !omit.includes(k));

// Adjust these defaults to match how you want each role to start out
const ROLE_PAGE_DEFAULTS = {
    superadmin:   _ALL_PAGES,
    admin:        _without('roles'),
    manager:      _without('roles', 'monitoring', 'client-requests'),
    receptionist: _without('roles', 'logs', 'monitoring', 'client-requests'),
    observer:     _without('roles', 'verification', 'logs', 'chat', 'reports', 'payments', 'filelibrary', 'chatroom', 'invoice', 'monitoring', 'client-requests'),
};

function renderPageAccessGrid() {
    const grid = document.getElementById('page-access-grid');
    if (!grid || grid.children.length) return;
    grid.innerHTML = PAGE_LIST.map(p => `
        <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid #e2e8f0;
                      border-radius:8px;background:#f8fafc;cursor:pointer;font-size:13px;color:#1e293b;user-select:none;">
            <input type="checkbox" class="page-access-cb" value="${p.key}"
                   style="width:16px;height:16px;accent-color:#3b82f6;cursor:pointer;margin:0;">
            <i class="fas ${p.icon}" style="width:14px;color:#64748b;font-size:12px;text-align:center;"></i> ${p.label}
        </label>`).join('');
}

function setPageAccess(keys) {
    renderPageAccessGrid();
    document.querySelectorAll('.page-access-cb').forEach(cb => { cb.checked = keys.includes(cb.value); });
}

function getPageAccess() {
    return [...document.querySelectorAll('.page-access-cb:checked')].map(cb => cb.value);
}

function applyRolePageDefaults(role) {
    setPageAccess(ROLE_PAGE_DEFAULTS[role] || ['dashboard']);
}

// ── Chat channel access ───────────────────────────────────────────────────────
// Add new default channels here (name must match the chatroom channel id)
const CHANNEL_LIST = ['general', 'announcements', 'housekeeping', 'front-desk'];

function renderChannelGrid() {
    const grid = document.getElementById('channel-access-grid');
    if (!grid || grid.children.length) return;
    grid.innerHTML = CHANNEL_LIST.map(c => `
        <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid #e2e8f0;
                      border-radius:8px;background:#f8fafc;cursor:pointer;font-size:13px;color:#1e293b;user-select:none;">
            <input type="checkbox" class="channel-access-cb" value="${c}"
                   style="width:16px;height:16px;accent-color:#3b82f6;cursor:pointer;margin:0;">
            <span style="color:#94a3b8;font-weight:600;">#</span> ${c}
        </label>`).join('');
}

function setChannelAccess(hidden) {
    renderChannelGrid();
    document.querySelectorAll('.channel-access-cb').forEach(cb => { cb.checked = !hidden.includes(cb.value); });
}

function getHiddenChannels() {
    return [...document.querySelectorAll('.channel-access-cb:not(:checked)')].map(cb => cb.value);
}

function setAllChannelAccess(on) {
    document.querySelectorAll('.channel-access-cb').forEach(cb => { cb.checked = on; });
}

function setAllPageAccess(on) {
    document.querySelectorAll('.page-access-cb').forEach(cb => { cb.checked = on; });
}

function togglePerm(perm) {
    const box = document.getElementById(`perm-${perm}-box`);
    if (!box) return;
    const isOn = box.dataset.checked === '1';
    _renderPerm(perm, !isOn);
}

function _renderPerm(perm, checked) {
    const box   = document.getElementById(`perm-${perm}-box`);
    const wrap  = document.getElementById(`perm-${perm}-wrap`);
    if (!box) return;
    const color = PERM_COLORS[perm] || '#64748b';
    box.dataset.checked = checked ? '1' : '0';
    if (checked) {
        box.style.cssText  = `width:20px;height:20px;border-radius:5px;border:2px solid ${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;background:${color};`;
        box.innerHTML      = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        wrap.style.borderColor = color;
        wrap.style.background  = color + '10';
    } else {
        box.style.cssText  = `width:20px;height:20px;border-radius:5px;border:2px solid #cbd5e1;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;background:white;`;
        box.innerHTML      = '';
        wrap.style.borderColor = '#e2e8f0';
        wrap.style.background  = '#f8fafc';
    }
}

function applyRoleDefaults(role) {
    const d = ROLE_PERM_DEFAULTS[role] || { canCreate: false, canEdit: false, canDelete: false };
    _renderPerm('create', d.canCreate);
    _renderPerm('edit',   d.canEdit);
    _renderPerm('delete', d.canDelete);
}

function setPermissions(perms) {
    _renderPerm('create', !!perms.canCreate);
    _renderPerm('edit',   !!perms.canEdit);
    _renderPerm('delete', !!perms.canDelete);
}

function getPermissions() {
    const getChecked = (id) => {
        const el = document.getElementById(id);
        return el ? el.dataset.checked === '1' : false;
    };
    return {
        canCreate:        getChecked('perm-create-box'),
        canEdit:          getChecked('perm-edit-box'),
        canDelete:        getChecked('perm-delete-box'),
        fullButtonAccess: getChecked('perm-fullaccess-box'),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset Password Modal
// ─────────────────────────────────────────────────────────────────────────────
function openResetPasswordModal(email, name) {
    const isLocked = lockedEmails.has((email || '').toLowerCase());
    document.getElementById('reset-password-email').textContent    = email;
    document.getElementById('reset-password-name').textContent     = name;
    document.getElementById('reset-password-uid-email').value      = email;

    const noticeEl = document.querySelector('#reset-password-modal .modal-body div[style*="fef9ec"]');
    if (noticeEl) {
        if (isLocked) {
            noticeEl.style.cssText = 'background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;font-size:13px;color:#dc2626;margin-bottom:20px;';
            noticeEl.innerHTML = `<i class="fas fa-lock" style="margin-right:6px;"></i>
                This account is <strong>locked</strong>. Sending a reset email will allow the user
                to set a new password and automatically unlock their account.`;
        } else {
            noticeEl.style.cssText = 'background:#fef9ec;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;font-size:13px;color:#854d0e;margin-bottom:20px;';
            noticeEl.innerHTML = `<i class="fas fa-info-circle" style="margin-right:6px;"></i>
                The user will receive an email with a link to set a new password. The link expires in 1 hour.`;
        }
    }
    // ── Deactivate / Reactivate button state ──
    const target    = allUsers.find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase());
    const statusBtn = document.getElementById('toggle-account-status-btn');
    const isDisabledNow = target?.status === 'disabled';

    statusBtn.dataset.uid    = target?.uid || '';
    statusBtn.dataset.email  = email;
    statusBtn.dataset.action = isDisabledNow ? 'activate' : 'deactivate';
    statusBtn.style.display  = (!target || target.uid === currentUserUid) ? 'none' : '';
    statusBtn.style.color       = isDisabledNow ? '#16a34a' : '#dc2626';
    statusBtn.style.borderColor = isDisabledNow ? '#bbf7d0' : '#fecaca';
    statusBtn.disabled  = false;
    statusBtn.innerHTML = isDisabledNow
        ? '<i class="fas fa-user-check"></i> Reactivate'
        : '<i class="fas fa-user-slash"></i> Deactivate';

    openModal('reset-password-modal');
}

function toggleAccountStatus() {
    const btn        = document.getElementById('toggle-account-status-btn');
    const uid        = btn.dataset.uid;
    const email      = btn.dataset.email;
    const deactivate = btn.dataset.action === 'deactivate';

    if (!uid) return;
    if (uid === currentUserUid) {
        UI.showNotification('You cannot deactivate your own account.', 'error');
        return;
    }

    // Deactivate asks for confirmation in a modal; Reactivate runs straight away
    if (deactivate) {
        document.getElementById('deactivate-user-uid').value         = uid;
        document.getElementById('deactivate-user-email').textContent = email;
        openModal('deactivate-modal');
        return;
    }
    runAccountStatusChange(uid, email, false);
}

async function runAccountStatusChange(uid, email, deactivate) {
    const btn = document.getElementById(deactivate ? 'confirm-deactivate-btn' : 'toggle-account-status-btn');
    const idleHtml = deactivate
        ? '<i class="fas fa-user-slash"></i> Yes, Deactivate'
        : '<i class="fas fa-user-check"></i> Reactivate';

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait…';

    try {
        await db.collection('users').doc(uid).update(
            deactivate
                ? { status: 'disabled', disabledAt: firebase.firestore.FieldValue.serverTimestamp() }
                : { status: 'active',   disabledAt: firebase.firestore.FieldValue.delete() }
        );
        await addLog(deactivate ? 'User Deactivated' : 'User Reactivated',
                     `${email} ${deactivate ? 'deactivated' : 'reactivated'}`);
        UI.showNotification(`${email} has been ${deactivate ? 'deactivated' : 'reactivated'}.`, 'success');
        closeModal('deactivate-modal');
        closeModal('reset-password-modal');
        loadAllData();
    } catch (err) {
        console.error('[Roles] Toggle status error:', err);
        UI.showNotification('Failed to update account: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = idleHtml;
    }
}

function setupResetPasswordModal() {
    document.getElementById('toggle-account-status-btn').addEventListener('click', toggleAccountStatus);
    document.getElementById('confirm-deactivate-btn').addEventListener('click', () => {
        const uid   = document.getElementById('deactivate-user-uid').value;
        const email = document.getElementById('deactivate-user-email').textContent;
        if (uid) runAccountStatusChange(uid, email, true);
    });
    document.getElementById('confirm-reset-password-btn').addEventListener('click', async () => {
        const email = document.getElementById('reset-password-uid-email').value;
        const btn   = document.getElementById('confirm-reset-password-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';

        try {
            await firebase.auth().sendPasswordResetEmail(email, {
              url: 'https://gtecguesthouse.web.app/admin.html',
            handleCodeInApp: false,
            });
            await addLog('Password Reset Sent', `Password reset email sent to ${email}`);
            UI.showNotification(`✅ Password reset email sent to ${email}`, 'success');
            closeModal('reset-password-modal');
            loadAllData();
        } catch (err) {
            console.error('[Roles] Reset password error:', err);
            let msg = err.message;
            if (err.code === 'auth/user-not-found') msg = 'No account found with that email address.';
            UI.showNotification('Failed to send reset email: ' + msg, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reset Email';
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete User Modal
// ─────────────────────────────────────────────────────────────────────────────
function openDeleteModal(uid, email) {
    document.getElementById('delete-user-uid').value         = uid;
    document.getElementById('delete-user-email').textContent = email;
    openModal('delete-user-modal');
}

function setupDeleteModal() {
    document.getElementById('confirm-delete-user-btn').addEventListener('click', async () => {
        const uid   = document.getElementById('delete-user-uid').value;
        const email = document.getElementById('delete-user-email').textContent;
        const btn   = document.getElementById('confirm-delete-user-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing…';

        try {
            await db.collection('users').doc(uid).delete();
            const safeEmail = email.replace(/\./g, '_').replace(/@/g, '_at_');
            await db.collection('loginAttempts').doc(safeEmail).delete().catch(() => {});
            await addLog('User Removed', `${email} removed from user roles`);
            UI.showNotification(`✅ ${email} removed from system.`, 'success');
            closeModal('delete-user-modal');
            loadAllData();
        } catch (err) {
            console.error('[Roles] Delete error:', err);
            UI.showNotification('Failed to remove user: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash"></i> Remove';
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Clients (guest portal accounts)
// ─────────────────────────────────────────────────────────────────────────────
let allClients   = [];
let clientAction = null;      // { type, uid, email, name }
const clientBusy = new Set(); // uids with a request in flight

const CLIENT_ACTIONS = {
    reset: {
        title: 'Reset Client Password', icon: 'fa-key', color: '#f59e0b', bg: '#fef3c7',
        noteBg: '#fef9ec', noteBorder: '#fde68a', noteColor: '#854d0e', noteIcon: 'fa-info-circle',
        lead: 'A password reset email will be sent to:',
        note: 'The client will receive an email with a link to set a new password. The link expires in 1 hour.',
        btn: 'Send Reset Email', btnIcon: 'fa-paper-plane',
    },
    deactivate: {
        title: 'Deactivate Client', icon: 'fa-user-slash', color: '#ef4444', bg: '#fef2f2',
        noteBg: '#fef2f2', noteBorder: '#fecaca', noteColor: '#b91c1c', noteIcon: 'fa-exclamation-circle',
        lead: 'Are you sure you want to deactivate',
        note: 'They lose access to the client portal immediately and cannot use it until you reactivate the account.',
        btn: 'Yes, Deactivate', btnIcon: 'fa-user-slash',
    },
    delete: {
        title: 'Delete Client', icon: 'fa-trash', color: '#ef4444', bg: '#fef2f2',
        noteBg: '#fef2f2', noteBorder: '#fecaca', noteColor: '#b91c1c', noteIcon: 'fa-exclamation-triangle',
        lead: 'Are you sure you want to delete',
        note: 'This removes their client profile. Their sign-in account is not deleted, so to block someone from the portal, deactivate them instead.',
        btn: 'Yes, Delete', btnIcon: 'fa-trash',
    },
};

async function loadClients() {
    const tbody = document.getElementById('clients-table-body');
    try {
        const snap = await db.collection('clients').orderBy('createdAt', 'desc').get();
        allClients = [];
        snap.forEach(doc => allClients.push({ uid: doc.id, ...doc.data() }));
        const term = (document.getElementById('search-clients')?.value || '').toLowerCase();
        renderClientsTable(filterClients(term));
    } catch (e) {
        console.error('[Roles] Clients load error:', e);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444;">
            <i class="fas fa-exclamation-circle"></i> Failed to load clients. Check Firestore rules.
        </td></tr>`;
    }
}

function filterClients(term) {
    if (!term) return allClients;
    return allClients.filter(c =>
        (c.name  || '').toLowerCase().includes(term) ||
        (c.email || '').toLowerCase().includes(term) ||
        (c.phone || '').toLowerCase().includes(term)
    );
}

function renderClientsTable(fullList, resetPage) {
    const tbody = document.getElementById('clients-table-body');
    const badge = document.getElementById('clients-count-badge');
    if (badge) badge.textContent = allClients.length;

    clientsView = fullList;
    if (resetPage) pageState.clients = 1;
    const clients = pageSlice(fullList, 'clients');
    renderPager('clients-pager', fullList.length, 'clients');

    if (!clients.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light);">No clients found.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    clients.forEach(c => {
        const isDisabled = c.status === 'disabled';
        const isGoogle   = /google/i.test(c.provider || '');
        const initial    = escHtml(String(c.name || c.email || '?').trim().charAt(0).toUpperCase());
        const createdAt  = c.createdAt?.toDate
            ? c.createdAt.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—';

        const disabledBadge = isDisabled ? `
            <span title="Account deactivated by Super Admin"
                  style="display:inline-flex;align-items:center;gap:3px;font-size:10px;
                         background:#f1f5f9;color:#475569;padding:1px 7px;border-radius:8px;
                         margin-left:6px;font-weight:600;border:1px solid #cbd5e1;">
                <i class="fas fa-ban" style="font-size:9px;"></i> Deactivated
            </span>` : '';

        const method = isGoogle
            ? `<span style="font-size:12px;font-weight:600;color:#3c4043;"><i class="fab fa-google" style="color:#4285f4;margin-right:5px;"></i>Google</span>`
            : `<span style="font-size:12px;font-weight:600;color:#64748b;"><i class="fas fa-envelope" style="margin-right:5px;"></i>Email</span>`;

        const resetStyle = 'color:#f59e0b;';
        const resetTitle = 'Reset password or deactivate account';

        const tr = document.createElement('tr');
        if (isDisabled) { tr.style.background = '#f8fafc'; tr.style.opacity = '0.7'; }

        tr.innerHTML = `
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:34px;height:34px;border-radius:50%;background:#e0e7ff;color:#4338ca;
                                display:flex;align-items:center;justify-content:center;flex-shrink:0;
                                font-weight:700;font-size:14px;">${initial}</div>
                    <div style="font-weight:600;font-size:14px;">${escHtml(c.name || '—')}${disabledBadge}</div>
                </div>
            </td>
            <td style="font-size:13px;color:var(--text-light);">${escHtml(c.email || '—')}</td>
            <td style="font-size:13px;color:var(--text-light);">${escHtml(c.phone || '—')}</td>
            <td>${method}</td>
            <td style="font-size:13px;color:var(--text-light);">${createdAt}</td>
            <td style="text-align:center;white-space:nowrap;">
                <button class="btn btn-sm btn-outline" data-client-act="reset" data-uid="${escHtml(c.uid)}"
                        title="${resetTitle}" style="${resetStyle}">
                    <i class="fas fa-key"></i>
                </button>
                <button class="btn btn-sm btn-outline" data-client-act="delete" data-uid="${escHtml(c.uid)}"
                        title="Delete Client" style="color:#ef4444;margin-left:4px;">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tbody.appendChild(tr);
    });
}

function openClientAction(type, uid) {
    const c = allClients.find(x => x.uid === uid);
    const a = CLIENT_ACTIONS[type];
    if (!c || !a) return;

    clientAction = { type, uid, email: c.email || '', name: c.name || c.email || '' };

    document.getElementById('client-action-title').innerHTML =
        `<i class="fas ${a.icon}" style="margin-right:8px;color:${a.color};"></i>${a.title}`;
    const wrap = document.getElementById('client-action-icon-wrap');
    wrap.style.background = a.bg;
    const icon = document.getElementById('client-action-icon');
    icon.className = 'fas ' + a.icon;
    icon.style.color = a.color;
    document.getElementById('client-action-lead').textContent  = a.lead;
    document.getElementById('client-action-name').textContent  = clientAction.name;
    document.getElementById('client-action-email').textContent = clientAction.email;

    const note = document.getElementById('client-action-note');
    note.style.background = a.noteBg;
    note.style.border     = '1px solid ' + a.noteBorder;
    note.style.color      = a.noteColor;
    note.innerHTML = `<i class="fas ${a.noteIcon}" style="margin-right:6px;"></i>${a.note}`;

    const btn = document.getElementById('client-action-confirm');
    btn.disabled = false;
    btn.style.background  = a.color;
    btn.style.borderColor = a.color;
    btn.innerHTML = `<i class="fas ${a.btnIcon}"></i> ${a.btn}`;

    // Deactivate / Reactivate button lives inside the reset popup
    const isDisabledNow = c.status === 'disabled';
    const isGoogle      = /google/i.test(c.provider || '');
    const tg = document.getElementById('client-action-toggle');
    tg.style.display     = type === 'reset' ? '' : 'none';
    tg.dataset.uid       = uid;
    tg.dataset.mode      = isDisabledNow ? 'activate' : 'deactivate';
    tg.style.color       = isDisabledNow ? '#16a34a' : '#dc2626';
    tg.style.borderColor = isDisabledNow ? '#bbf7d0' : '#fecaca';
    tg.disabled  = false;
    tg.innerHTML = isDisabledNow
        ? '<i class="fas fa-user-check"></i> Reactivate'
        : '<i class="fas fa-user-slash"></i> Deactivate';

    // Google sign-in clients have no password to reset
    btn.style.display = (type === 'reset' && isGoogle) ? 'none' : '';
    if (type === 'reset' && isGoogle) {
        note.innerHTML = '<i class="fas fa-info-circle" style="margin-right:6px;"></i>This client signs in with Google, so there is no password to reset.';
    }

    openModal('client-action-modal');
}

async function setClientStatus(uid, email, deactivate) {
    await db.collection('clients').doc(uid).update(
        deactivate
            ? { status: 'disabled', disabledAt: firebase.firestore.FieldValue.serverTimestamp() }
            : { status: 'active',   disabledAt: firebase.firestore.FieldValue.delete() }
    );
    await addLog(deactivate ? 'Client Deactivated' : 'Client Reactivated',
                 `${email} ${deactivate ? 'deactivated' : 'reactivated'}`);
    UI.showNotification(`${email} has been ${deactivate ? 'deactivated' : 'reactivated'}.`, 'success');
}

async function confirmClientAction() {
    if (!clientAction) return;
    const { type, uid, email } = clientAction;
    const a   = CLIENT_ACTIONS[type];
    const btn = document.getElementById('client-action-confirm');
    if (clientBusy.has(uid)) return;
    clientBusy.add(uid);

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait…';

    try {
        if (type === 'reset') {
            await firebase.auth().sendPasswordResetEmail(email);
            await addLog('Client Password Reset Sent', `Password reset email sent to client ${email}`);
            UI.showNotification(`✅ Password reset email sent to ${email}`, 'success');
        } else if (type === 'deactivate') {
            await setClientStatus(uid, email, true);
        } else if (type === 'delete') {
            await db.collection('clients').doc(uid).delete();
            await addLog('Client Removed', `Client ${email} deleted`);
            UI.showNotification(`✅ ${email} deleted.`, 'success');
        }
        closeModal('client-action-modal');
        loadClients();
    } catch (err) {
        console.error('[Roles] Client action error:', err);
        let msg = err.message;
        if (err.code === 'auth/user-not-found')     msg = 'No sign-in account found for that email.';
        if (err.code === 'permission-denied')       msg = 'Permission denied. Publish the updated Firestore rules.';
        UI.showNotification('Failed: ' + msg, 'error');
    } finally {
        clientBusy.delete(uid);
        btn.disabled = false;
        btn.innerHTML = `<i class="fas ${a.btnIcon}"></i> ${a.btn}`;
    }
}

function setupClientSection() {
    document.getElementById('search-clients').addEventListener('input', function () {
        renderClientsTable(filterClients(this.value.toLowerCase()), true);
    });

    document.getElementById('clients-table-body').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-client-act]');
        if (!b || b.disabled) return;
        const act = b.dataset.clientAct, uid = b.dataset.uid;

        if (act === 'activate') {
            // Reactivate runs straight away, no confirmation needed
            if (clientBusy.has(uid)) return;
            const c = allClients.find(x => x.uid === uid); if (!c) return;
            clientBusy.add(uid);
            b.disabled = true;
            try {
                await setClientStatus(uid, c.email || '', false);
                loadClients();
            } catch (err) {
                console.error('[Roles] Reactivate client error:', err);
                UI.showNotification('Failed: ' + err.message, 'error');
                b.disabled = false;
            } finally {
                clientBusy.delete(uid);
            }
            return;
        }
        openClientAction(act, uid);
    });

    document.getElementById('client-action-confirm').addEventListener('click', confirmClientAction);

    document.getElementById('client-action-toggle').addEventListener('click', async function () {
        const uid = this.dataset.uid;
        if (!uid) return;

        // Deactivate: switch this popup to the confirmation view
        if (this.dataset.mode === 'deactivate') {
            openClientAction('deactivate', uid);
            return;
        }

        // Reactivate: runs straight away
        if (clientBusy.has(uid)) return;
        const c = allClients.find(x => x.uid === uid); if (!c) return;
        clientBusy.add(uid);
        const original = this.innerHTML;
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait…';
        try {
            await setClientStatus(uid, c.email || '', false);
            closeModal('client-action-modal');
            loadClients();
        } catch (err) {
            console.error('[Roles] Reactivate client error:', err);
            UI.showNotification('Failed: ' + err.message, 'error');
            this.innerHTML = original;
        } finally {
            clientBusy.delete(uid);
            this.disabled = false;
        }
    });

    const overlay = document.getElementById('client-action-modal');
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal('client-action-modal'); });
}

// ─────────────────────────────────────────────────────────────────────────────
// Search / filter — only searches active users
// ─────────────────────────────────────────────────────────────────────────────
function setupSearch() {
    document.getElementById('search-users').addEventListener('input', function () {
        const term     = this.value.toLowerCase();
        const filtered = allUsers.filter(u =>
            (u.name  || '').toLowerCase().includes(term) ||
            (u.email || '').toLowerCase().includes(term) ||
            (u.role  || '').toLowerCase().includes(term)
        );
        renderUsersTable(filtered, true);
    });

    // Prev / Next buttons for both tables
    document.addEventListener('click', e => {
        const b = e.target.closest('button[data-pager]');
        if (!b || b.disabled) return;
        const key = b.dataset.pager;
        pageState[key] += Number(b.dataset.dir);
        if (key === 'users') renderUsersTable(usersView);
        else                 renderClientsTable(clientsView);
    });
}

// ── Pagination helpers ───────────────────────────────────────────────────────
function pageSlice(list, key) {
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    pageState[key] = Math.min(Math.max(1, pageState[key]), pages);
    const from = (pageState[key] - 1) * PAGE_SIZE;
    return list.slice(from, from + PAGE_SIZE);
}

function renderPager(id, total, key) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!total) { el.innerHTML = ''; return; }

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page  = pageState[key];
    const from  = (page - 1) * PAGE_SIZE + 1;
    const to    = Math.min(page * PAGE_SIZE, total);

    el.innerHTML = `
        <span>${from}–${to} of ${total}</span>
        <span class="pg-btns">
            <button type="button" class="btn btn-sm btn-outline" data-pager="${key}" data-dir="-1" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
            <span>Page ${page} of ${pages}</span>
            <button type="button" class="btn btn-sm btn-outline" data-pager="${key}" data-dir="1" ${page >= pages ? 'disabled' : ''}>Next ›</button>
        </span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}