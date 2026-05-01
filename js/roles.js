// roles.js
// ─────────────────────────────────────────────────────────────────────────────
// User Roles Management — Super Admin only
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_META = {
    superadmin:   { label: 'Super Admin',  bg: '#dbeafe', color: '#1e40af', icon: 'fa-crown',    hint: 'Full access — can create, edit, delete everything including user roles.' },
    manager:      { label: 'Admin',      bg: '#dcfce7', color: '#15803d', icon: 'fa-user-shield', hint: 'Can check-in and check-out guests. Cannot create, edit, or delete records.' },
    receptionist: { label: 'Receptionist', bg: '#fef3c7', color: '#854d0e', icon: 'fa-user-tie',     hint: 'Can check-in and check-out guests. Cannot create, edit, or delete records.' },
    observer:     { label: 'Observer',     bg: '#f3e8ff', color: '#6b21a8', icon: 'fa-eye',      hint: 'Read-only access. Cannot see Verification, Logs, or Chat pages.' },
};

let allUsers      = [];
let pendingUsers  = [];
let lockedEmails  = new Set();
let currentUserUid = null;

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
function renderUsersTable(users) {
    const tbody = document.getElementById('users-table-body');

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

        const tr = document.createElement('tr');
        if (isLocked) tr.style.background = '#fff8f8';

        tr.innerHTML = `
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:34px;height:34px;border-radius:50%;
                                background:${isLocked ? '#fef2f2' : meta.bg};
                                display:flex;align-items:center;justify-content:center;flex-shrink:0;
                                ${isLocked ? 'border:1.5px solid #fecaca;' : ''}">
                        <i class="fas ${isLocked ? 'fa-lock' : meta.icon}"
                           style="color:${isLocked ? '#dc2626' : meta.color};font-size:13px;"></i>
                    </div>
                    <div style="font-weight:600;font-size:14px;">
                        ${escHtml(user.name || '—')}
                        ${isYou ? '<span style="font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:600;">You</span>' : ''}
                        ${lockBadge}
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
            await db.collection('users').doc(uid).update({ role, status: 'active' });
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

    ['add-user-modal','role-modal','delete-user-modal','reset-password-modal','approve-modal','reject-modal'].forEach(id => {
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
    document.getElementById('role-modal-uid').value        = uid;
    document.getElementById('role-modal-email').textContent = email;
    document.getElementById('role-select').value           = currentRole;
    openModal('role-modal');
}

function setupRoleModal() {
    document.getElementById('save-role-btn').addEventListener('click', async () => {
        const uid     = document.getElementById('role-modal-uid').value;
        const email   = document.getElementById('role-modal-email').textContent;
        const newRole = document.getElementById('role-select').value;
        const btn     = document.getElementById('save-role-btn');

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

        try {
            await db.collection('users').doc(uid).update({ role: newRole });
            await addLog('Role Changed', `${email} role changed to ${ROLE_META[newRole]?.label || newRole}`);
            UI.showNotification(`✅ Role updated to ${ROLE_META[newRole]?.label || newRole}`, 'success');
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
    openModal('reset-password-modal');
}

function setupResetPasswordModal() {
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
        renderUsersTable(filtered);
    });
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