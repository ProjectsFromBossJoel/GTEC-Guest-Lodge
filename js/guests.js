// guests.js
let allActiveGuests = [];
let allHistoryGuests = [];

// ── Pagination state ──────────────────────────────────────────────────────
const PAGE_SIZE = 10;
let activePage  = 1;
let historyPage = 1;

// ── Encode guest ID + room into a safe base64 token ───────────────────────
function buildQRToken(guestId, room) {
    return btoa(`${guestId}|${room}`);
}

// ── Format date with time on separate line ────────────────────────────────
function formatDateTime(dateVal) {
    let d = null;
    if (!dateVal) return '—';
    if (typeof dateVal.toDate === 'function') {
        try { d = dateVal.toDate(); } catch (e) { }
    } else if (typeof dateVal === 'string') {
        d = new Date(dateVal);
    } else if (dateVal instanceof Date) {
        d = dateVal;
    }
    if (!d || isNaN(d)) return '—';
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `<span class="dt-date" style="font-weight:600;color:#1e293b;">${date}</span><br><span class="dt-time" style="color:#94a3b8;font-size:11px;">${time}</span>`;
}

// ── Shared pagination renderer ────────────────────────────────────────────
function renderPagination(containerId, total, currentPage, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end   = Math.min(currentPage * PAGE_SIZE, total);

    if (total === 0) { container.innerHTML = ''; return; }

    // build page number buttons (max 5 visible, centred around current)
    const delta = 2;
    let pStart = Math.max(1, currentPage - delta);
    let pEnd   = Math.min(totalPages, currentPage + delta);
    if (pEnd - pStart < delta * 2) {
        pStart = Math.max(1, pEnd - delta * 2);
        pEnd   = Math.min(totalPages, pStart + delta * 2);
    }

    let pageNums = '';
    if (pStart > 1)      pageNums += `<button class="pg-btn" data-p="1">1</button>${pStart > 2 ? '<span class="pg-ellipsis">…</span>' : ''}`;
    for (let p = pStart; p <= pEnd; p++) {
        pageNums += `<button class="pg-btn${p === currentPage ? ' pg-active' : ''}" data-p="${p}">${p}</button>`;
    }
    if (pEnd < totalPages) pageNums += `${pEnd < totalPages - 1 ? '<span class="pg-ellipsis">…</span>' : ''}<button class="pg-btn" data-p="${totalPages}">${totalPages}</button>`;

    container.innerHTML = `
        <div class="pg-bar">
            <span class="pg-info">Showing ${start}–${end} of ${total} record${total !== 1 ? 's' : ''}</span>
            <div class="pg-controls">
                <button class="pg-btn pg-nav" data-p="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&#8249;</button>
                ${pageNums}
                <button class="pg-btn pg-nav" data-p="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>&#8250;</button>
            </div>
        </div>
    `;

    container.querySelectorAll('.pg-btn[data-p]').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = +btn.dataset.p;
            if (p < 1 || p > totalPages || p === currentPage) return;
            onPageChange(p);
        });
    });
}

// ── Inject pagination CSS once ────────────────────────────────────────────
(function injectPaginationStyles() {
    if (document.getElementById('pg-styles')) return;
    const style = document.createElement('style');
    style.id = 'pg-styles';
    style.textContent = `
        .pg-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 4px 4px;
            flex-wrap: wrap;
            gap: 10px;
        }
        .pg-info {
            font-size: 13px;
            color: #64748b;
            font-family: 'DM Sans', sans-serif;
        }
        .pg-controls {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .pg-btn {
            width: 34px;
            height: 34px;
            border-radius: 50%;
            border: 1.5px solid #e2e8f0;
            background: white;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.18s;
            color: #374151;
            font-family: 'DM Sans', sans-serif;
        }
        .pg-btn:hover:not(:disabled):not(.pg-active) {
            background: #f0f4ff;
            border-color: #4361ee;
            color: #4361ee;
        }
        .pg-btn.pg-active {
            background: #4361ee;
            color: white;
            border-color: #4361ee;
        }
        .pg-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
        }
        .pg-nav { font-size: 16px; }
        .pg-ellipsis {
            padding: 0 4px;
            color: #94a3b8;
            font-size: 14px;
        }
    `;
    document.head.appendChild(style);
})();


document.addEventListener('DOMContentLoaded', () => {

    const tabActive  = document.getElementById('tab-active');
    const tabHistory = document.getElementById('tab-history');
    const secActive  = document.getElementById('section-active');
    const secHistory = document.getElementById('section-history');

    // ── Tab switching ─────────────────────────────────────────────────────
    tabActive.addEventListener('click', () => {
        tabActive.classList.add('active');
        tabHistory.classList.remove('active');
        secActive.classList.remove('hidden');
        secHistory.classList.add('hidden');
    });

    tabHistory.addEventListener('click', () => {
        tabHistory.classList.add('active');
        tabActive.classList.remove('active');
        secHistory.classList.remove('hidden');
        secActive.classList.add('hidden');
        if (allHistoryGuests.length === 0) loadHistoryGuests();
    });

    // ── Search active ─────────────────────────────────────────────────────
    document.getElementById('search-active').addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        activePage = 1;
        if (!val) { renderActiveTable(allActiveGuests); return; }
        renderActiveTable(allActiveGuests.filter(g =>
            (g.name || '').toLowerCase().includes(val) ||
            (g.phone || '').toLowerCase().includes(val) ||
            (g.idNumber || '').toLowerCase().includes(val) ||
            (g.roomNumber || '').toString().toLowerCase().includes(val)
        ));
    });

    // ── Search history ────────────────────────────────────────────────────
    document.getElementById('search-history').addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        historyPage = 1;
        if (!val) { renderHistoryTable(allHistoryGuests); return; }
        renderHistoryTable(allHistoryGuests.filter(g =>
            (g.name || g.guestName || '').toLowerCase().includes(val) ||
            (g.room || g.roomNumber || '').toString().toLowerCase().includes(val) ||
            (g.idNumber || '').toLowerCase().includes(val) ||
            (g.phone || '').toLowerCase().includes(val)
        ));
    });

    // ── Real-time listener for active guests ──────────────────────────────
    db.collection('guests').onSnapshot(snapshot => {
        allActiveGuests = [];
        snapshot.forEach(doc => allActiveGuests.push({ id: doc.id, ...doc.data() }));
        allActiveGuests.sort((a, b) => {
            const dA = a.checkinDate?.toDate?.() || new Date(a.checkinDateStr || 0);
            const dB = b.checkinDate?.toDate?.() || new Date(b.checkinDateStr || 0);
            return dB - dA;
        });
        const searchVal = document.getElementById('search-active').value.toLowerCase().trim();
        if (searchVal) {
            renderActiveTable(allActiveGuests.filter(g =>
                (g.name || '').toLowerCase().includes(searchVal) ||
                (g.phone || '').toLowerCase().includes(searchVal) ||
                (g.idNumber || '').toLowerCase().includes(searchVal) ||
                (g.roomNumber || '').toString().toLowerCase().includes(searchVal)
            ));
        } else {
            renderActiveTable(allActiveGuests);
        }
    }, err => {
        console.error("Error loading guests:", err);
        UI.showNotification("Failed to load guests", "error");
    });

    // ── Ensure pagination containers exist in the DOM ─────────────────────
    ensurePaginationContainers();

    // ── Inject modals into DOM ────────────────────────────────────────────
    injectModals();
});

// Add pagination <div> slots below each table if they don't exist yet
function ensurePaginationContainers() {
    ['active-pagination', 'history-pagination'].forEach(id => {
        if (!document.getElementById(id)) {
            const div = document.createElement('div');
            div.id = id;
            // Insert after the respective card
            const sectionId = id.startsWith('active') ? 'section-active' : 'section-history';
            const section = document.getElementById(sectionId);
            if (section) section.appendChild(div);
        }
    });
}


// ===== LOAD HISTORY =========================================================
async function loadHistoryGuests() {
    UI.showLoader();
    try {
        const snapshot = await db.collection('history').get();
        allHistoryGuests = [];
        snapshot.forEach(doc => allHistoryGuests.push({ id: doc.id, ...doc.data() }));
        allHistoryGuests.sort((a, b) => {
            const dA = a.checkoutDate?.toDate?.() || new Date(a.checkoutDateStr || 0);
            const dB = b.checkoutDate?.toDate?.() || new Date(b.checkoutDateStr || 0);
            return dB - dA;
        });
        historyPage = 1;
        renderHistoryTable(allHistoryGuests);
    } catch (err) {
        console.error("Error loading history:", err);
        UI.showNotification("Failed to load history", "error");
    } finally {
        UI.hideLoader();
    }
}


// ===== RENDER ACTIVE TABLE ==================================================
function renderActiveTable(guests) {
    const tbody = document.getElementById('active-guests-body');
    tbody.innerHTML = '';

    if (!guests || guests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No guests found.</td></tr>';
        document.getElementById('active-pagination') && (document.getElementById('active-pagination').innerHTML = '');
        return;
    }

    const total      = guests.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (activePage > totalPages) activePage = totalPages;

    const start  = (activePage - 1) * PAGE_SIZE;
    const paged  = guests.slice(start, start + PAGE_SIZE);

    paged.forEach(guest => {
        const paymentStatus = (guest.paymentStatus || '').toLowerCase() === 'paid' ? 'paid' : 'unpaid';
        const paymentBadge = paymentStatus === 'paid'
            ? '<span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;"><i class="fas fa-check-circle"></i> Paid</span>'
            : '<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">Unpaid</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${guest.name || '—'}</strong><br>
                <small style="color:#94a3b8;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">ID: ${guest.idNumber || 'N/A'}${guest.idNumber ? `<i class="fas fa-copy" title="Copy Guest ID" onclick="navigator.clipboard.writeText('${guest.idNumber}').then(()=>{this.style.color='#16a34a';setTimeout(()=>{this.style.color='#94a3b8'},1500);})" style="cursor:pointer;color:#94a3b8;font-size:11px;"></i>` : ''}</small>
            </td>
            <td>${guest.phone || '—'}</td>
            <td><span style="display:inline-block;background:#dbeafe;color:#1d4ed8;padding:4px 12px;border-radius:8px;font-size:13px;font-weight:600;">Room ${guest.roomNumber || 'N/A'}</span></td>
            <td>${formatDateTime(guest.checkinDate || guest.checkinDateStr)}</td>
            <td>${formatDateTime(guest.checkoutDate || guest.checkoutDateStr)}</td>
            <td>${paymentBadge}</td>
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    <i class="fas fa-eye action-btn view" onclick="viewGuestProfile('${guest.id}','guests')" title="View Profile" style="cursor:pointer;color:#3b82f6;font-size:16px;"></i>
                    <i class="fas fa-trash action-btn delete" onclick="confirmDeleteGuest('${guest.id}','guests','${(guest.name || '').replace(/'/g, "\\'")}','${guest.roomNumber || ''}')" title="Delete" style="cursor:pointer;color:#ef4444;font-size:16px;"></i>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Keep reference to filtered list for pagination re-render
    renderPagination('active-pagination', total, activePage, (p) => {
        activePage = p;
        renderActiveTable(guests);
    });
}


// ===== RENDER HISTORY TABLE =================================================
function renderHistoryTable(history) {
    const tbody = document.getElementById('history-guests-body');
    tbody.innerHTML = '';

    if (!history || history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No history found.</td></tr>';
        document.getElementById('history-pagination') && (document.getElementById('history-pagination').innerHTML = '');
        return;
    }

    const total      = history.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (historyPage > totalPages) historyPage = totalPages;

    const start = (historyPage - 1) * PAGE_SIZE;
    const paged = history.slice(start, start + PAGE_SIZE);

    paged.forEach(record => {
        const paymentStatus = record.paymentStatus || 'unpaid';
        const paymentBadge = paymentStatus === 'paid'
            ? '<span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;"><i class="fas fa-check-circle"></i> Paid</span>'
            : '<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">Unpaid</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${record.name || record.guestName || '—'}</strong><br>
                <small style="color:#94a3b8;">ID: ${record.idNumber || 'N/A'}</small>
            </td>
            <td><span style="display:inline-block;background:#dbeafe;color:#1d4ed8;padding:4px 12px;border-radius:8px;font-size:13px;font-weight:600;">Room ${record.room || record.roomNumber || 'N/A'}</span></td>
            <td>${formatDateTime(record.checkinDate || record.checkinDateStr)}</td>
            <td>${formatDateTime(record.checkoutDate || record.checkoutDateStr)}</td>
            <td>${paymentBadge}</td>
            <td><span class="badge badge-success">Checked Out</span></td>
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    <i class="fas fa-eye action-btn view" onclick="viewGuestProfile('${record.id}','history')" title="View Profile" style="cursor:pointer;color:#3b82f6;font-size:16px;"></i>
                    <i class="fas fa-trash action-btn delete" onclick="confirmDeleteGuest('${record.id}','history','${(record.name || record.guestName || '').replace(/'/g, "\\'")}','${record.room || record.roomNumber || ''}')" title="Delete" style="cursor:pointer;color:#ef4444;font-size:16px;"></i>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderPagination('history-pagination', total, historyPage, (p) => {
        historyPage = p;
        renderHistoryTable(history);
    });
}


// ===== INJECT MODALS ========================================================
function injectModals() {

    // ── Inject jsPDF if not already loaded ────────────────────────────────
    if (!window.jspdf) {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        document.head.appendChild(s);
    }

    // ── Delete confirmation modal ──────────────────────────────────────────
    const deleteModal = document.createElement('div');
    deleteModal.id = 'deleteConfirmModal';
    deleteModal.style.cssText = `
        display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5);
        align-items:center; justify-content:center; z-index:99999;
    `;
    deleteModal.innerHTML = `
        <div style="background:white;border-radius:16px;padding:32px;width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
            <div style="width:56px;height:56px;background:#fef2f2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                <i class="fas fa-trash" style="color:#ef4444;font-size:22px;"></i>
            </div>
            <h3 style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:8px;">Delete Guest?</h3>
            <p id="deleteModalMsg" style="font-size:14px;color:#64748b;margin-bottom:24px;">This action cannot be undone.</p>
            <div style="display:flex;gap:12px;justify-content:center;">
                <button onclick="closeDeleteModal()" style="flex:1;padding:10px;border:1px solid #e2e8f0;background:white;border-radius:8px;font-size:14px;font-weight:600;color:#64748b;cursor:pointer;">Cancel</button>
                <button id="deleteConfirmBtn" style="flex:1;padding:10px;border:none;background:#ef4444;border-radius:8px;font-size:14px;font-weight:600;color:white;cursor:pointer;">Delete</button>
            </div>
        </div>
    `;
    document.body.appendChild(deleteModal);

    // ── Guest profile modal ────────────────────────────────────────────────
    const profileModal = document.createElement('div');
    profileModal.id = 'guestProfileModal';
    profileModal.style.cssText = `
        display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5);
        align-items:center; justify-content:center; z-index:99999;
    `;
    profileModal.innerHTML = `
        <div style="background:white;border-radius:16px;width:520px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
            <!-- Header -->
            <div style="background:linear-gradient(135deg,#1a2942,#3b82f6);padding:28px;border-radius:16px 16px 0 0;display:flex;align-items:center;gap:18px;">
                <div id="profileAvatar" style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:white;flex-shrink:0;"></div>
                <div>
                    <div id="profileName" style="font-size:20px;font-weight:700;color:white;"></div>
                    <div id="profileIdBadge" style="display:inline-block;background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.9);padding:3px 10px;border-radius:20px;font-size:12px;margin-top:4px;"></div>
                </div>
                <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
                    <button id="profileEditBtn" onclick="toggleProfileEdit()" title="Edit guest details"
                        style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:white;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all 0.2s;">
                        <i class="fas fa-pen" style="font-size:11px;"></i> Edit
                    </button>
                    <button onclick="closeGuestProfile()" style="background:rgba(255,255,255,0.15);border:none;color:white;width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&times;</button>
                </div>
            </div>

            <!-- Body -->
            <div style="padding:24px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Full Name</div>
                        <div id="profileName-view" style="font-size:14px;font-weight:600;color:#1e293b;"></div>
                        <input id="profileName-edit" type="text" style="display:none;width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;font-size:14px;outline:none;" oninput="markDirty()">
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Phone</div>
                        <div id="profilePhone-view" style="font-size:14px;font-weight:600;color:#1e293b;"></div>
                        <input id="profilePhone-edit" type="tel" style="display:none;width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;font-size:14px;outline:none;" oninput="markDirty()">
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Email</div>
                        <div id="profileEmail-view" style="font-size:14px;font-weight:600;color:#1e293b;word-break:break-all;"></div>
                        <input id="profileEmail-edit" type="email" style="display:none;width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;font-size:14px;outline:none;" oninput="markDirty()">
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Room</div>
                        <div id="profileRoom-view" style="font-size:14px;font-weight:600;color:#1d4ed8;"></div>
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Status</div>
                        <div id="profileStatus" style="font-size:14px;font-weight:600;"></div>
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Check-in</div>
                        <div id="profileCheckin" style="font-size:14px;font-weight:600;color:#1e293b;"></div>
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;grid-column:span 2;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Expected Checkout</div>
                        <div id="profileCheckout" style="font-size:14px;font-weight:600;color:#1e293b;"></div>
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">No. of Nights</div>
                        <div id="profileNights" style="font-size:14px;font-weight:600;color:#1e293b;">—</div>
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">No. of Guests</div>
                        <div id="profileGuestsCount" style="font-size:14px;font-weight:600;color:#1e293b;">—</div>
                    </div>

                    <div style="background:#f8fafc;border-radius:10px;padding:14px;grid-column:span 2;">
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Payment Status</div>
                        <div id="profilePaymentStatus" style="font-size:14px;font-weight:600;">—</div>
                    </div>

                </div>

                <div style="background:#f8fafc;border-radius:10px;padding:14px;">
                    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Notes</div>
                    <div id="profileNotes-view" style="font-size:14px;color:#475569;"></div>
                    <textarea id="profileNotes-edit" rows="3" style="display:none;width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;font-size:14px;outline:none;resize:vertical;" oninput="markDirty()"></textarea>
                </div>
            </div>

            <!-- Footer -->
            <div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                <button id="profileDownloadBtn" onclick="downloadGuestProfilePDF()"
                    style="padding:9px 18px;border:1px solid #e2e8f0;background:white;border-radius:8px;font-size:13px;font-weight:600;color:#1a2942;cursor:pointer;display:flex;align-items:center;gap:7px;transition:all 0.2s;"
                    onmouseover="this.style.background='#1a2942';this.style.color='white';this.style.borderColor='#1a2942';"
                    onmouseout="this.style.background='white';this.style.color='#1a2942';this.style.borderColor='#e2e8f0';">
                    <i class="fas fa-file-pdf" style="color:#ef4444;font-size:14px;"></i> Download PDF
                </button>
                <div style="display:flex;gap:10px;">
                    <button onclick="closeGuestProfile()" style="padding:9px 20px;border:1px solid #e2e8f0;background:white;border-radius:8px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;">Close</button>
                    <button id="profileSaveBtn" onclick="saveGuestProfile()"
                        style="padding:9px 20px;border:none;background:#3b82f6;border-radius:8px;font-size:13px;font-weight:600;color:white;cursor:not-allowed;opacity:0.35;transition:all 0.25s;display:none;align-items:center;gap:6px;"
                        disabled>
                        <i class="fas fa-save" style="margin-right:6px;"></i> Save Changes
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(profileModal);
}


// ===== DELETE WITH NICE MODAL ===============================================
let _pendingDeleteId = null;
let _pendingDeleteCollection = null;

function confirmDeleteGuest(id, collection, name, room) {
    _pendingDeleteId = id;
    _pendingDeleteCollection = collection;
    const msg = document.getElementById('deleteModalMsg');
    if (msg) msg.textContent = `Delete ${name || 'this guest'} from Room ${room || 'N/A'}? This cannot be undone.`;

    const modal = document.getElementById('deleteConfirmModal');
    modal.style.display = 'flex';

    document.getElementById('deleteConfirmBtn').onclick = async () => {
        modal.style.display = 'none';
        await executeDelete(_pendingDeleteId, _pendingDeleteCollection);
    };
}

function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
}

async function executeDelete(id, collection) {
    try {
        await db.collection(collection).doc(id).delete();
        UI.showNotification("Guest deleted successfully", "success");
        if (typeof addLog === "function") {
            await addLog("Guest Deleted", `Guest ID: ${id} removed from ${collection}`);
        }

        // ── Instantly remove from local cache and re-render ──
        if (collection === 'history') {
            allHistoryGuests = allHistoryGuests.filter(g => g.id !== id);
            historyPage = Math.min(historyPage, Math.max(1, Math.ceil(allHistoryGuests.length / PAGE_SIZE)));
            renderHistoryTable(allHistoryGuests);
        }
        // Active guests use a real-time listener so they vanish automatically

    } catch (err) {
        console.error("Delete error:", err);
        UI.showNotification("Delete failed", "error");
    }
}

async function deleteGuest(id, collection = 'guests') {
    confirmDeleteGuest(id, collection, '', '');
}


// ===== VIEW GUEST PROFILE ===================================================
let _currentProfileId = null;
let _currentProfileCollection = null;
let _profileIsDirty = false;
let _isEditMode = false;

async function viewGuestProfile(id, collection = 'guests') {
    try {
        const doc = await db.collection(collection).doc(id).get();
        if (!doc.exists) { UI.showNotification("Guest not found", "error"); return; }

        _currentProfileId = id;
        _currentProfileCollection = collection;
        _profileIsDirty = false;
        _isEditMode = false;

        const g = doc.data();
        const name = g.name || g.guestName || '—';
        const initials = name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();

        document.getElementById('profileAvatar').textContent = initials;
        document.getElementById('profileName').textContent = name;
        document.getElementById('profileIdBadge').textContent = g.idNumber ? `ID: ${g.idNumber}` : '';

        document.getElementById('profileName-view').textContent = name;
        document.getElementById('profilePhone-view').textContent = g.phone || '—';
        document.getElementById('profileEmail-view').textContent = g.email || '—';
        document.getElementById('profileRoom-view').textContent = `Room ${g.roomNumber || g.room || '—'}`;
        document.getElementById('profileCheckin').innerHTML = formatDateTime(g.checkinDate || g.checkinDateStr);
        document.getElementById('profileCheckout').innerHTML = formatDateTime(g.checkoutDate || g.checkoutDateStr);
        document.getElementById('profileNotes-view').textContent = g.notes || '—';

        const ciD  = g.checkinDate?.toDate?.()  || (g.checkinDateStr  ? new Date(g.checkinDateStr)  : null);
        const coD  = g.checkoutDate?.toDate?.() || (g.checkoutDateStr ? new Date(g.checkoutDateStr) : null);
        const nights = ciD && coD
            ? Math.max(0, Math.round((coD - ciD) / (1000 * 60 * 60 * 24)))
            : null;
        document.getElementById('profileNights').textContent =
            nights !== null ? `${nights} night${nights !== 1 ? 's' : ''}` : '—';

        document.getElementById('profileGuestsCount').textContent =
            g.guestsCount ? `${g.guestsCount} guest${g.guestsCount != 1 ? 's' : ''}` : '—';

        const payEl  = document.getElementById('profilePaymentStatus');
        const isPaid = (g.paymentStatus || '').toLowerCase() === 'paid';
        payEl.textContent = isPaid ? '✅ Paid' : '❌ Unpaid';
        payEl.style.color = isPaid ? '#16a34a' : '#b91c1c';

        document.getElementById('profileName-edit').value  = g.name || g.guestName || '';
        document.getElementById('profilePhone-edit').value = g.phone || '';
        document.getElementById('profileEmail-edit').value = g.email || '';
        document.getElementById('profileNotes-edit').value = g.notes || '';

        const statusEl = document.getElementById('profileStatus');
        if (collection === 'history') {
            statusEl.textContent = 'Checked Out';
            statusEl.style.color = '#64748b';
        } else {
            const rawStatus  = g.status || 'checkedin';
            const statusLower = rawStatus.toLowerCase();
            if (statusLower === 'checked in') {
                statusEl.textContent = 'Checked In';
                statusEl.style.color = '#16a34a';
            } else if (statusLower === 'checkedin') {
                statusEl.textContent = 'Reserved / Pending Check-in';
                statusEl.style.color = '#d97706';
            } else if (statusLower === 'reserved') {
                statusEl.textContent = 'Reserved';
                statusEl.style.color = '#1d4ed8';
            } else {
                statusEl.textContent = rawStatus;
                statusEl.style.color = '#64748b';
            }
        }

        setEditMode(false);

        const editBtn = document.getElementById('profileEditBtn');
        if (editBtn) editBtn.style.display = collection === 'guests' ? 'flex' : 'none';

        document.getElementById('guestProfileModal').style.display = 'flex';

    } catch (err) {
        console.error("Error loading guest profile:", err);
        UI.showNotification("Failed to load profile", "error");
    }
}

function toggleProfileEdit() {
    _isEditMode = !_isEditMode;
    setEditMode(_isEditMode);
}

function setEditMode(on) {
    _isEditMode = on;
    const fields = ['profileName', 'profilePhone', 'profileEmail', 'profileNotes'];
    fields.forEach(f => {
        const view = document.getElementById(`${f}-view`);
        const edit = document.getElementById(`${f}-edit`);
        if (view) view.style.display = on ? 'none' : 'block';
        if (edit) edit.style.display = on ? 'block' : 'none';
    });

    const editBtn = document.getElementById('profileEditBtn');
    if (editBtn) {
        editBtn.innerHTML = on
            ? '<i class="fas fa-times" style="font-size:11px;"></i> Cancel'
            : '<i class="fas fa-pen" style="font-size:11px;"></i> Edit';
        editBtn.style.background = on ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.15)';
    }

    const saveBtn = document.getElementById('profileSaveBtn');
    if (saveBtn) {
        saveBtn.style.display = on ? 'inline-flex' : 'none';
        if (!on) { _profileIsDirty = false; }
        updateSaveBtn();
    }
}

function markDirty() {
    _profileIsDirty = true;
    updateSaveBtn();
}

function updateSaveBtn() {
    const saveBtn = document.getElementById('profileSaveBtn');
    if (!saveBtn) return;
    if (_profileIsDirty) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
    } else {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.35';
        saveBtn.style.cursor = 'not-allowed';
    }
}

async function saveGuestProfile() {
    if (!_currentProfileId || !_profileIsDirty) return;

    const saveBtn = document.getElementById('profileSaveBtn');
    const origHTML = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i> Saving...';
    saveBtn.disabled = true;

    try {
        const updates = {
            name:  document.getElementById('profileName-edit').value.trim(),
            phone: document.getElementById('profilePhone-edit').value.trim(),
            email: document.getElementById('profileEmail-edit').value.trim(),
            notes: document.getElementById('profileNotes-edit').value.trim(),
        };

        await db.collection(_currentProfileCollection).doc(_currentProfileId).update(updates);

        document.getElementById('profileName-view').textContent  = updates.name  || '—';
        document.getElementById('profilePhone-view').textContent = updates.phone || '—';
        document.getElementById('profileEmail-view').textContent = updates.email || '—';
        document.getElementById('profileNotes-view').textContent = updates.notes || '—';
        document.getElementById('profileName').textContent = updates.name || '—';
        document.getElementById('profileAvatar').textContent =
            updates.name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

        if (typeof addLog === "function") {
            await addLog("Guest Updated", `${updates.name} — profile edited`);
        }

        UI.showNotification("Guest profile updated ✅", "success");
        _profileIsDirty = false;
        setEditMode(false);

    } catch (err) {
        console.error("Save error:", err);
        UI.showNotification("Save failed: " + err.message, "error");
        saveBtn.innerHTML = origHTML;
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
    }
}

function closeGuestProfile() {
    document.getElementById('guestProfileModal').style.display = 'none';
    _profileIsDirty = false;
    _isEditMode = false;
}


// ===== DOWNLOAD GUEST PROFILE AS PDF ========================================
async function downloadGuestProfilePDF() {
    const btn = document.getElementById('profileDownloadBtn');
    const origHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    btn.disabled = true;

    try {
        let attempts = 0;
        while (!window.jspdf && attempts < 20) {
            await new Promise(r => setTimeout(r, 150));
            attempts++;
        }
        if (!window.jspdf) throw new Error("jsPDF not loaded");

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const W = pdf.internal.pageSize.getWidth();
        const H = pdf.internal.pageSize.getHeight();
        const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        const name     = document.getElementById('profileName').textContent || '—';
        const idBadge  = document.getElementById('profileIdBadge').textContent || '';
        const phone    = document.getElementById('profilePhone-view').textContent || '—';
        const email    = document.getElementById('profileEmail-view').textContent || '—';
        const room     = document.getElementById('profileRoom-view').textContent || '—';
        const status   = document.getElementById('profileStatus').textContent || '—';
        // Helper to get date + time with a line break
            function getDateTimeWithBreak(element) {
                const dateEl = element?.querySelector('.dt-date');
                const timeEl = element?.querySelector('.dt-time');
                const date = dateEl?.textContent || '—';
                const time = timeEl?.textContent || '';
                return time ? `${date}\n${time}` : date;
            }
            const checkin  = getDateTimeWithBreak(document.getElementById('profileCheckin'));
            const checkout = getDateTimeWithBreak(document.getElementById('profileCheckout'));
        const notes    = document.getElementById('profileNotes-view').textContent || '—';
        const initials = name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
        const isCheckedIn = status === 'Checked In';

        const guestId = idBadge.replace('ID:', '').trim();
        const roomNum = room.replace('Room', '').trim();

        function drawRect(x, y, w, h, r, fill) {
            pdf.setFillColor(...fill);
            pdf.roundedRect(x, y, w, h, r, r, 'F');
        }
        function txt(text, x, y, size, color, style = 'normal', align = 'left') {
            pdf.setFontSize(size);
            pdf.setFont('helvetica', style);
            pdf.setTextColor(...color);
            pdf.text(String(text), x, y, { align });
        }

        drawRect(0, 0, W, 52, 0, [26, 41, 66]);
        try {
            const logoImg = await new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = img.width; c.height = img.height;
                    c.getContext('2d').drawImage(img, 0, 0);
                    resolve(c.toDataURL('image/png'));
                };
                img.onerror = () => resolve(null);
                img.src = 'img/logo1.jpg';
            });
            if (logoImg) pdf.addImage(logoImg, 'PNG', 8, 8, 36, 36);
        } catch (e) { }

        txt('GTEC Guest Lodge', 50, 18, 14, [255, 255, 255], 'bold');
        txt('Guest Profile Record', 50, 26, 9, [147, 197, 253]);
        txt(`${date}  •  ${time}`, W - 10, 22, 8, [200, 220, 240], 'normal', 'right');

        const avatarX = W / 2, avatarY = 52;
        pdf.setFillColor(59, 130, 246);
        pdf.circle(avatarX, avatarY + 18, 18, 'F');
        txt(initials, avatarX, avatarY + 22, 16, [255, 255, 255], 'bold', 'center');

        txt(name, W / 2, avatarY + 46, 16, [26, 41, 66], 'bold', 'center');
        if (idBadge) {
            drawRect(W / 2 - 22, avatarY + 49, 44, 8, 3, [239, 246, 255]);
            txt(idBadge, W / 2, avatarY + 55, 8, [29, 78, 216], 'normal', 'center');
        }

        const pillClr = isCheckedIn ? [220, 252, 231] : [241, 245, 249];
        const pillTxt = isCheckedIn ? [22, 163, 74] : [100, 116, 139];
        drawRect(W / 2 - 18, avatarY + 60, 36, 8, 3, pillClr);
        txt(status, W / 2, avatarY + 66, 8, pillTxt, 'bold', 'center');

        let y = avatarY + 80;

        const tileW = (W - 28) / 2;
        const tileH = 20;
        const tileGap = 4;

        const tiles = [
            { label: 'PHONE', value: phone },
            { label: 'EMAIL', value: email },
            { label: 'ROOM', value: room, blue: true },
            { label: 'STATUS', value: status },
            { label: 'CHECK-IN', value: checkin },
            { label: 'EXPECTED CHECKOUT', value: checkout },
        ];

        tiles.forEach((tile, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const tx = 10 + col * (tileW + tileGap);
            const ty = y + row * (tileH + tileGap);
            drawRect(tx, ty, tileW, tileH, 3, [248, 250, 252]);
            txt(tile.label, tx + 4, ty + 6, 6.5, [148, 163, 184], 'bold');
            txt((tile.value || '—').slice(0, 34), tx + 4, ty + 13, 8,
                tile.blue ? [29, 78, 216] : [30, 41, 59], 'bold');
        });

        y += Math.ceil(tiles.length / 2) * (tileH + tileGap) + 6;

        const notesLines = pdf.splitTextToSize(notes || '—', W - 28);
        const notesH = Math.max(18, notesLines.length * 5 + 10);
        drawRect(10, y, W - 20, notesH, 3, [248, 250, 252]);
        txt('NOTES', 14, y + 6, 6.5, [148, 163, 184], 'bold');
        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(71, 85, 105);
        pdf.text(notesLines, 14, y + 13);
        y += notesH + 8;

        if (guestId && typeof QRCode !== 'undefined') {
            const token = buildQRToken(guestId, roomNum);
            const qrUrl = `https://guesthousesystem-86fdc.web.app/cardverification.html?t=${token}`;

            txt('VERIFICATION QR CODE', W / 2, y + 4, 7, [148, 163, 184], 'bold', 'center');
            txt('Scan to verify guest at reception', W / 2, y + 10, 8, [100, 116, 139], 'normal', 'center');
            y += 14;

            const qrCanvas = document.createElement('canvas');
            qrCanvas.width = 120; qrCanvas.height = 120;
            qrCanvas.style.display = 'none';
            document.body.appendChild(qrCanvas);
            try {
                await new Promise(resolve => {
                    new QRCode(qrCanvas, {
                        text: qrUrl,
                        width: 120,
                        height: 120,
                        correctLevel: QRCode.CorrectLevel.M
                    });
                    setTimeout(resolve, 400);
                });
                const qrImg = qrCanvas.toDataURL('image/png');
                pdf.addImage(qrImg, 'PNG', W / 2 - 18, y, 36, 36);
                y += 42;
            } catch (e) {
                console.warn('QR embed failed', e);
            } finally {
                document.body.removeChild(qrCanvas);
            }
        }

        pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.3);
        pdf.line(10, H - 14, W - 10, H - 14);
        txt('GTEC Guest Lodge — Confidential', 10, H - 8, 7, [148, 163, 184]);
        txt(`Generated: ${date} ${time}`, W - 10, H - 8, 7, [148, 163, 184], 'normal', 'right');

        const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        pdf.save(`GTEC_Guest_${safeName}.pdf`);

    } catch (err) {
        console.error('Profile PDF error:', err);
        UI.showNotification('PDF generation failed: ' + err.message, 'error');
    } finally {
        btn.innerHTML = origHTML;
        btn.disabled = false;
    }
}

function printGuestProfile() {
    const content = document.querySelector("#guestProfileModal");
    if (!content) return;
    const win = window.open("", "PrintGuest", "width=600,height=700");
    win.document.write(content.innerHTML);
    win.document.close();
    win.focus(); win.print(); win.close();
}