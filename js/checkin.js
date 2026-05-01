// checkin.js

// ── Google Sheets sync ────────────────────────────────────────────────────
const SHEETS_URL = "https://script.google.com/macros/s/AKfycbwDU_27f2ivJqxztffDPJD6DFaJualYqPza4gldvYCUxo1eyV6x6b04B1SIZRpi5mMBNg/exec"; // ← paste your Web App URL here

async function syncToGoogleSheet(data) {
    try {
        await fetch(SHEETS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: data.name || '—',
                phone: data.phone || '—',
                email: data.email || '—',
                idNumber: data.idNumber || '—',
                guests: data.guestsCount || '—',
                room: data.roomNumber || '—',
                checkin: data.checkinDateStr
                    ? new Date(data.checkinDateStr).toLocaleString('en-GB')
                    : '—',
                checkout: data.checkoutDateStr
                    ? new Date(data.checkoutDateStr).toLocaleString('en-GB')
                    : '—',
                notes: data.notes || '—'
            })
        });
        console.log("[Sheets] ✅ Row synced to Google Sheet");
    } catch (err) {
        console.warn("[Sheets] ⚠️ Sync failed (non-blocking):", err);
    }
}

document.addEventListener('DOMContentLoaded', () => {

    // ===== SET DEFAULT DATES =====
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('checkin-date').value = now.toISOString().slice(0, 16);

    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    tmrw.setHours(11, 0, 0, 0);
    tmrw.setMinutes(tmrw.getMinutes() - tmrw.getTimezoneOffset());
    document.getElementById('checkout-date').value = tmrw.toISOString().slice(0, 16);

    // Load rooms
    loadAvailableRooms();

    // Form submit
    document.getElementById('checkin-form')
        .addEventListener('submit', handleCheckinSubmit);

    // ── Inject verification popup HTML into the page ──────────────────────
    injectVerificationModal();
});


// ===== LOAD AVAILABLE ROOMS =====
async function loadAvailableRooms() {
    const roomSelect = document.getElementById('room-select');

    try {
        const snapshot = await db.collection('rooms')
            .where('status', '==', 'Available')
            .get();

        roomSelect.innerHTML = '<option value="" disabled selected>Select an available room</option>';

        if (snapshot.empty) {
            roomSelect.innerHTML = '<option value="" disabled selected>No available rooms at the moment</option>';
            return;
        }

        const availableRooms = [];
        snapshot.forEach(doc => {
            availableRooms.push({ id: doc.id, ...doc.data() });
        });

        // Sort rooms numerically
        availableRooms.sort((a, b) => parseInt(a.number) - parseInt(b.number));

        availableRooms.forEach(room => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ id: room.id, number: room.number });
            opt.textContent = `Room ${room.number} (${room.type || 'Standard'})`;
            roomSelect.appendChild(opt);
        });

    } catch (error) {
        console.error("Error loading rooms:", error);
        UI.showNotification("Failed to load available rooms", "error");
    }
}


// ===== INJECT VERIFICATION POPUP MODAL =====
function injectVerificationModal() {
    const modal = document.createElement('div');
    modal.id = 'verif-modal-overlay';
    modal.innerHTML = `
        <style>
            #verif-modal-overlay {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 9999;
                background: rgba(15, 23, 42, 0.55);
                backdrop-filter: blur(4px);
                align-items: center;
                justify-content: center;
            }
            #verif-modal-overlay.open {
                display: flex;
            }
            #verif-modal-box {
                background: #fff;
                border-radius: 16px;
                box-shadow: 0 24px 60px rgba(0,0,0,0.18);
                padding: 36px 32px 28px;
                width: 100%;
                max-width: 440px;
                position: relative;
                animation: verifSlideIn 0.28s cubic-bezier(.22,.68,0,1.2) forwards;
            }
            @keyframes verifSlideIn {
                from { opacity: 0; transform: translateY(24px) scale(0.97); }
                to   { opacity: 1; transform: translateY(0)    scale(1);    }
            }
            #verif-modal-box .vm-close {
                position: absolute;
                top: 14px; right: 18px;
                background: none; border: none;
                font-size: 20px; color: #94a3b8;
                cursor: pointer; line-height: 1;
                padding: 4px 6px; border-radius: 6px;
                transition: background 0.15s, color 0.15s;
            }
            #verif-modal-box .vm-close:hover {
                background: #f1f5f9; color: #334155;
            }
            #verif-modal-box .vm-icon {
                width: 52px; height: 52px;
                border-radius: 14px;
                background: #dbeafe;
                display: flex; align-items: center; justify-content: center;
                font-size: 22px; color: #1e40af;
                margin-bottom: 16px;
            }
            #verif-modal-box h3 {
                font-size: 18px; font-weight: 700;
                color: #0f172a; margin: 0 0 4px;
            }
            #verif-modal-box .vm-subtitle {
                font-size: 13px; color: #64748b; margin: 0 0 22px;
            }
            .vm-info-row {
                display: flex; align-items: center;
                justify-content: space-between;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 12px 14px;
                margin-bottom: 10px;
            }
            .vm-info-row .vm-label {
                font-size: 11px; font-weight: 600;
                text-transform: uppercase; letter-spacing: .05em;
                color: #94a3b8; margin-bottom: 2px;
            }
            .vm-info-row .vm-value {
                font-size: 15px; font-weight: 700; color: #1e293b;
            }
            .vm-copy-btn {
                display: flex; align-items: center; gap: 5px;
                background: #1f3b57; color: #fff;
                border: none; border-radius: 8px;
                padding: 7px 13px; font-size: 12px; font-weight: 600;
                cursor: pointer; transition: background 0.15s, transform 0.1s;
                white-space: nowrap; flex-shrink: 0;
            }
            .vm-copy-btn:hover  { background: #2d5480; }
            .vm-copy-btn:active { transform: scale(0.95); }
            .vm-copy-btn.copied {
                background: #16a34a;
            }
            .vm-divider {
                border: none; border-top: 1px solid #e2e8f0;
                margin: 20px 0 18px;
            }
            .vm-action-row {
                display: flex; gap: 10px;
            }
            .vm-btn-secondary {
                flex: 1;
                background: #f1f5f9; color: #475569;
                border: none; border-radius: 10px;
                padding: 11px 0; font-size: 13px; font-weight: 600;
                cursor: pointer; transition: background 0.15s;
            }
            .vm-btn-secondary:hover { background: #e2e8f0; }
            .vm-btn-primary {
                flex: 2;
                background: #1f3b57; color: #fff;
                border: none; border-radius: 10px;
                padding: 11px 0; font-size: 13px; font-weight: 600;
                cursor: pointer; transition: background 0.15s;
                display: flex; align-items: center; justify-content: center; gap: 7px;
            }
            .vm-btn-primary:hover { background: #2d5480; }
            .vm-notice {
                display: flex; align-items: flex-start; gap: 8px;
                background: #fffbeb; border: 1px solid #fde68a;
                border-radius: 8px; padding: 10px 12px;
                font-size: 12px; color: #92400e; margin-top: 14px;
                line-height: 1.5;
            }
            .vm-notice i { flex-shrink: 0; margin-top: 1px; color: #d97706; }
        </style>

        <div id="verif-modal-box">
            <button class="vm-close" id="vm-close-btn" title="Close">&times;</button>

            <div class="vm-icon"><i class="fas fa-user-check"></i></div>
            <h3>Booking Registered!</h3>
            <p class="vm-subtitle">Share the Guest ID with the guest for verification at check-in.</p>

            <div class="vm-info-row">
                <div>
                    <div class="vm-label">Guest Name</div>
                    <div class="vm-value" id="vm-guest-name">—</div>
                </div>
            </div>

            <div class="vm-info-row">
                <div>
                    <div class="vm-label">Guest ID</div>
                    <div class="vm-value" id="vm-guest-id">—</div>
                </div>
                <button class="vm-copy-btn" id="vm-copy-id-btn">
                    <i class="fas fa-copy"></i> Copy ID
                </button>
            </div>

            <div class="vm-info-row">
                <div>
                    <div class="vm-label">Assigned Room</div>
                    <div class="vm-value" id="vm-guest-room">—</div>
                </div>
                <button class="vm-copy-btn" id="vm-copy-room-btn">
                    <i class="fas fa-copy"></i> Copy
                </button>
            </div>

            <hr class="vm-divider">

            <div class="vm-action-row">
                <button class="vm-btn-secondary" id="vm-later-btn">Later</button>
                <button class="vm-btn-primary" id="vm-verify-now-btn">
                    <i class="fas fa-shield-alt"></i> Verify &amp; Check In Now
                </button>
            </div>

            <div class="vm-notice">
                <i class="fas fa-exclamation-triangle"></i>
                <span>The room will only be marked <strong>Occupied</strong> after verification is completed on the Verification page.</span>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // ── Close button ──────────────────────────────────────────────────────
    document.getElementById('vm-close-btn').addEventListener('click', closeVerifModal);
    document.getElementById('vm-later-btn').addEventListener('click', closeVerifModal);

    // ── Close when clicking outside the box ──────────────────────────────
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeVerifModal();
    });

    // ── Copy Guest ID ─────────────────────────────────────────────────────
    document.getElementById('vm-copy-id-btn').addEventListener('click', () => {
        const id = document.getElementById('vm-guest-id').textContent;
        copyToClipboard(id, document.getElementById('vm-copy-id-btn'));
    });

    // ── Copy Room ─────────────────────────────────────────────────────────
    document.getElementById('vm-copy-room-btn').addEventListener('click', () => {
        const room = document.getElementById('vm-guest-room').textContent;
        copyToClipboard(room, document.getElementById('vm-copy-room-btn'));
    });

    // ── Go to Verification page ───────────────────────────────────────────
    document.getElementById('vm-verify-now-btn').addEventListener('click', () => {
        const id = document.getElementById('vm-guest-id').textContent;
        const room = document.getElementById('vm-guest-room').textContent.replace('Room ', '');
        window.location.href = `verification.html?id=${encodeURIComponent(id)}&room=${encodeURIComponent(room)}`;
    });
}

function openVerifModal(guestName, guestId, roomNumber) {
    document.getElementById('vm-guest-name').textContent = guestName;
    document.getElementById('vm-guest-id').textContent = guestId;
    document.getElementById('vm-guest-room').textContent = `Room ${roomNumber}`;

    // Reset copy buttons
    resetCopyBtn(document.getElementById('vm-copy-id-btn'), 'Copy ID');
    resetCopyBtn(document.getElementById('vm-copy-room-btn'), 'Copy');

    document.getElementById('verif-modal-overlay').classList.add('open');
}

function closeVerifModal() {
    document.getElementById('verif-modal-overlay').classList.remove('open');
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => {
            btn.classList.remove('copied');
            resetCopyBtn(btn, btn.id === 'vm-copy-id-btn' ? 'Copy ID' : 'Copy');
        }, 2000);
    }).catch(() => {
        // Fallback for browsers without clipboard API
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        btn.classList.add('copied');
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => {
            btn.classList.remove('copied');
            resetCopyBtn(btn, btn.id === 'vm-copy-id-btn' ? 'Copy ID' : 'Copy');
        }, 2000);
    });
}

function resetCopyBtn(btn, label) {
    btn.innerHTML = `<i class="fas fa-copy"></i> ${label}`;
}


// ===== HANDLE CHECK-IN =====
async function handleCheckinSubmit(e) {
    e.preventDefault();
    UI.showLoader();

    try {
        const roomDataJson = document.getElementById('room-select').value;

        if (!roomDataJson) {
            UI.hideLoader();
            UI.showNotification("Please select a valid room", "error");
            return;
        }

        const selectedRoom = JSON.parse(roomDataJson);
        const idNumber = `GH-${Math.floor(Math.random() * 100000)}`;

        // ── Collect form values ─────────────────────────────────────────────
        const name = document.getElementById('guest-name').value.trim();
        const phone = document.getElementById('guest-phone').value.trim();
        const email = document.getElementById('guest-email').value.trim();
        const guestsCount = document.getElementById('guest-count').value;
        const notes = document.getElementById('notes').value.trim();
        const checkinInput = document.getElementById('checkin-date').value;
        const checkoutInput = document.getElementById('checkout-date').value;

        const checkinDateObj = new Date(checkinInput + ":00");
        const checkoutDateObj = new Date(checkoutInput + ":00");

        // ── Build Firestore payload ─────────────────────────────────────────
        // ✅ Room status stays "Available" until verification is complete.
        //    Guest status is "Pending Verification" — not yet "Checked In".
        const guestData = {
            name,
            phone,
            email,
            idNumber,
            guestsCount,
            roomId: selectedRoom.id,
            roomNumber: selectedRoom.number,
            checkinDate: firebase.firestore.Timestamp.fromDate(checkinDateObj),
            checkinDateStr: checkinDateObj.toISOString(),
            checkoutDate: firebase.firestore.Timestamp.fromDate(checkoutDateObj),
            checkoutDateStr: checkoutDateObj.toISOString(),
            notes,
            status: "Pending Verification",
            verified: false,
            paymentStatus: 'unpaid',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        // ── Save to Firestore ───────────────────────────────────────────────
        const guestRef = await db.collection('guests').add(guestData);
console.log("[Firestore] Guest saved ✅ (Pending Verification)");

// Auto-create unpaid invoice placeholder
await db.collection('invoices').add({
    invoiceNumber: `#PENDING-${idNumber}`,
    guestName: name,
    guestPhone: phone,
    guestEmail: email,
    guestId: idNumber,
    room: selectedRoom.number,
    guestsCount: parseInt(guestsCount),
    paymentMethod: 'momo',
    paymentStatus: 'unpaid',
    subtotal: 0,
    notes: notes || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
});
console.log("[Firestore] Placeholder invoice created ✅");
        await syncToGoogleSheet(guestData);


        // ✅ Room stays "Available" — only changes to "Occupied" after verification
        console.log("[Firestore] Room stays Available until verification ✅");

        // ── Log action ──────────────────────────────────────────────────────
        await addLog(
            "Guest Booking Registered",
            `${name} — Room ${selectedRoom.number} | ID: ${idNumber} | Pending Verification`
        );

        // ── EmailJS — send after Firestore succeeds ─────────────────────────
        const formattedCheckin = checkinDateObj.toLocaleString("en-GB", {
            weekday: "short", year: "numeric", month: "short",
            day: "numeric", hour: "2-digit", minute: "2-digit"
        });
        const formattedCheckout = checkoutDateObj.toLocaleString("en-GB", {
            weekday: "short", year: "numeric", month: "short",
            day: "numeric", hour: "2-digit", minute: "2-digit"
        });
        const formattedTime = new Date().toLocaleString("en-GB", {
            weekday: "short", year: "numeric", month: "short",
            day: "numeric", hour: "2-digit", minute: "2-digit"
        });


        // 🆕 CALCULATE NUMBER OF NIGHTS
// ─────────────────────────────────────────────────────────
const oneDay = 1000 * 60 * 60 * 24;

function normalizeToNoon(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}

const checkin = normalizeToNoon(checkinDateObj);
const checkout = normalizeToNoon(checkoutDateObj);

const nights = Math.round((checkout - checkin) / oneDay);


        // Admin payload
        const adminPayload = {
            name,
            phone,
            email,
            room: selectedRoom.number,
            checkin: formattedCheckin,
            checkout: formattedCheckout,
            nights:   nights,
            notes: notes || "None",
            time: formattedTime
        };

        // Guest payload
        const guestPayload = {
            title: `Booking Confirmed — Room ${selectedRoom.number}`,
            name,
            phone,
            email,
            room: selectedRoom.number,
            checkin: formattedCheckin,
            checkout: formattedCheckout,
            nights:   nights,
            idNumber,
            time: formattedTime
        };

        // ── Resolve EmailJS safely ─────────────────────────────────────────
        const ejs = window.emailjs
            ? (window.emailjs.default || window.emailjs)
            : null;

        if (ejs) {
            try {
                const adminRes = await ejs.send("service_muxt9dr", "template_ejmyipp", adminPayload);
                console.log("[EmailJS] ✅ Admin email sent:", adminRes.status, adminRes.text);
            } catch (adminErr) {
                console.error("[EmailJS] ❌ Admin email FAILED:", adminErr.status, adminErr.text);
            }

            try {
                const userRes = await ejs.send("service_muxt9dr", "template_zbbfaym", guestPayload);
                console.log("[EmailJS] ✅ Guest email sent:", userRes.status, userRes.text);
            } catch (guestErr) {
                console.error("[EmailJS] ❌ Guest email FAILED:", guestErr.status, guestErr.text);
            }
        } else {
            console.warn("[EmailJS] ⚠️ SDK not loaded — emails not sent.");
        }

        // ── Success: hide loader, show verification popup ───────────────────
        UI.hideLoader();
        openVerifModal(name, idNumber, selectedRoom.number);

        // Reset form
        document.getElementById('checkin-form').reset();

        // Reset default dates
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('checkin-date').value = now.toISOString().slice(0, 16);

        const tmrw = new Date();
        tmrw.setDate(tmrw.getDate() + 1);
        tmrw.setHours(11, 0, 0, 0);
        tmrw.setMinutes(tmrw.getMinutes() - tmrw.getTimezoneOffset());
        document.getElementById('checkout-date').value = tmrw.toISOString().slice(0, 16);

        loadAvailableRooms();

    } catch (error) {
        console.error("Error during checkin:", error);
        UI.hideLoader();
        UI.showNotification("Check-in failed: " + error.message, "error");
    }
}