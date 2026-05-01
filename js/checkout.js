// checkout.js
// ✅ Module-scope so search and renderGuestsTable share the same array
let activeGuests = [];

document.addEventListener('DOMContentLoaded', () => {

    loadActiveGuests();

    // Search
    document.getElementById('search-guests').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (!term) { renderGuestsTable(activeGuests); return; }

        const filtered = activeGuests.filter(g =>
            (g.name       || '').toLowerCase().includes(term) ||
            (g.roomNumber || '').toString().toLowerCase().includes(term) ||
            (g.idNumber   || '').toLowerCase().includes(term) ||
            (g.phone      || '').toLowerCase().includes(term)
        );

        renderGuestsTable(filtered);
    });

    // Close modal
    document.querySelectorAll('.close-modal, #cancel-checkout-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('checkout-modal').classList.remove('active');
        });
    });

    document.getElementById('confirm-checkout-btn')
        .addEventListener('click', handleGuestCheckout);
});


// ===== SAFE DATE HELPER =====
function getSafeDate(dateField, dateStr) {
    if (dateField && typeof dateField.toDate === "function") {
        return dateField.toDate();
    }
    if (dateStr) {
        return new Date(dateStr);
    }
    return null;
}


// ===== LOAD GUESTS (real-time listener) =====
function loadActiveGuests() {
    UI.showLoader();

    db.collection('guests').onSnapshot(snapshot => {
        let guests = [];

        snapshot.forEach(doc => {
            guests.push({ id: doc.id, ...doc.data() });
        });

        // Sort by check-in date descending
        guests.sort((a, b) => {
            const dateA = getSafeDate(a.checkinDate, a.checkinDateStr);
            const dateB = getSafeDate(b.checkinDate, b.checkinDateStr);
            return dateB - dateA;
        });

        // ✅ Assign to module-scope array so search filter works
        activeGuests = guests;

        // Re-apply search if user is currently typing
        const searchTerm = document.getElementById('search-guests').value.toLowerCase().trim();
        if (searchTerm) {
            const filtered = activeGuests.filter(g =>
                (g.name       || '').toLowerCase().includes(searchTerm) ||
                (g.roomNumber || '').toString().toLowerCase().includes(searchTerm) ||
                (g.idNumber   || '').toLowerCase().includes(searchTerm) ||
                (g.phone      || '').toLowerCase().includes(searchTerm)
            );
            renderGuestsTable(filtered);
        } else {
            renderGuestsTable(activeGuests);
        }
        UI.hideLoader();

    }, error => {
        console.error("Error loading guests:", error);
        UI.showNotification("Error loading active guests", "error");
        UI.hideLoader();
    });
}


// ===== RENDER TABLE =====
function renderGuestsTable(guests) {
    const tbody = document.getElementById('checkout-table-body');
    tbody.innerHTML = '';

    if (guests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No active guests found.</td></tr>';
        return;
    }

    guests.forEach(guest => {
        const tr = document.createElement('tr');

        const checkin  = getSafeDate(guest.checkinDate,  guest.checkinDateStr);
        const checkout = getSafeDate(guest.checkoutDate, guest.checkoutDateStr);

        const isVerified  = guest.verified === true;
        const isCheckedIn = guest.status === "Checked In";

        // ── Verification badge — turns green as soon as verified: true ──────
        const verificationBadge = isVerified
            ? `<span style="
                display: inline-block;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                background-color: #d4edda;
                color: #1a7a3c;
               ">Verified</span>`
            : `<span style="
                display: inline-block;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                background-color: #fde8e8;
                color: #c0392b;
               ">Not Verified</span>`;

        // ── Checkout button — only active after Check In (status = Checked In)
        const checkoutBtn = isCheckedIn
            ? `<button class="btn btn-sm btn-primary checkout-btn" data-id="${guest.id}">
                   Checkout
               </button>`
            : `<button class="btn btn-sm btn-primary checkout-btn" data-id="${guest.id}"
                   disabled
                   title="${isVerified ? 'Guest verified — awaiting check-in' : 'Guest must be verified and checked in before checkout'}"
                   style="opacity: 0.35; cursor: not-allowed; pointer-events: none;">
                   Checkout
               </button>`;

        tr.innerHTML = `
            <td>
                <strong>${guest.name}</strong><br>
                <small>ID: ${guest.idNumber || 'N/A'}</small>
            </td>
            <td>${guest.phone}</td>
            <td><span class="badge badge-info">Room ${guest.roomNumber || 'N/A'}</span></td>
            <td>${UI.formatDate(checkin)}</td>
            <td>${UI.formatDate(checkout)}</td>
            <td>${verificationBadge}</td>
            <td>${checkoutBtn}</td>
        `;

        tbody.appendChild(tr);
    });

    // Attach click events only to enabled checkout buttons
    document.querySelectorAll('.checkout-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const guestId = e.currentTarget.getAttribute('data-id');
            const guest   = activeGuests.find(g => g.id === guestId);

            if (guest) {
                document.getElementById('checkout-guest-id').value    = guest.id;
                document.getElementById('checkout-room-id').value     = guest.roomId;
                document.getElementById('checkout-guest-name').textContent  = guest.name;
                document.getElementById('checkout-room-number').textContent = guest.roomNumber;

                document.getElementById('checkout-modal').classList.add('active');
            }
        });
    });
}


// ===== HANDLE CHECKOUT =====
async function handleGuestCheckout() {
    UI.showLoader();

    const guestId = document.getElementById('checkout-guest-id').value;
    const roomId  = document.getElementById('checkout-room-id').value;

    if (!guestId) {
        UI.hideLoader();
        return;
    }

    try {
        const guestDoc = await db.collection('guests').doc(guestId).get();

        if (!guestDoc.exists) {
            throw new Error("Guest not found");
        }

        const guestData = guestDoc.data();
        const now = new Date();

        // ===== HISTORY DATA =====
        const historyData = {
            name:                guestData.name,
            phone:               guestData.phone,
            idNumber:            guestData.idNumber,
            room:                guestData.roomNumber,
            roomId:              guestData.roomId,
            guestsCount:         guestData.guestsCount,
            checkinDate:         guestData.checkinDate,
            checkinDateStr:      guestData.checkinDateStr,
            expectedCheckout:    guestData.checkoutDate,
            expectedCheckoutStr: guestData.checkoutDateStr,
            checkoutDate:        firebase.firestore.Timestamp.fromDate(now),
            checkoutDateStr:     now.toISOString(),
            notes:               guestData.notes,
            timestamp:           firebase.firestore.FieldValue.serverTimestamp(),
            paymentStatus:       guestData.paymentStatus || 'unpaid'
        };

        // Save to history
        await db.collection('history').add(historyData);

        // Delete active guest
        await db.collection('guests').doc(guestId).delete();

        // Update room status
        if (roomId) {
            await db.collection('rooms').doc(roomId).update({ status: 'Available' });
        }

        // Log
        await addLog(
            "Guest Checked Out",
            `${guestData.name} from Room ${guestData.roomNumber}`
        );

        UI.hideLoader();
        document.getElementById('checkout-modal').classList.remove('active');
        UI.showNotification("Guest Checkout Successful!", "success");

    } catch (error) {
        console.error("Checkout error:", error);
        UI.hideLoader();
        UI.showNotification("Checkout failed: " + error.message, "error");
    }
}