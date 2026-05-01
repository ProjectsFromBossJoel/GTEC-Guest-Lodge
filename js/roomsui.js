// roomsui.js
// ─────────────────────────────────────────────────────────────────────────────
// 1. EmailJS init
// 2. Greeting
// 3. Room grid (Firestore real-time)
// 4. Booking modal open/close
// 5. Booking form submit → Firestore → EmailJS
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════
// VERSION: 2026.04.01b — WhatsApp + date validation fix
// ══════════════════════════════════════════

// 0. EMAILJS
// ══════════════════════════════════════════
function _ejs() {
    const lib = window.emailjs;
    if (!lib) {
        console.error("[EmailJS] ❌ SDK not available — was init called?");
        if (typeof showToast === "function") {
            showToast("⚠️ Email notification unavailable — your booking is still saved", false);
        }
        return null;
    }
    console.log("[EmailJS] ✅ SDK ready");
    return lib.default || lib;
}

// ══════════════════════════════════════════
// 1. GREETING
// ══════════════════════════════════════════
const greetingEl = document.getElementById("greeting");
if (greetingEl) {
    const hour = new Date().getHours();
    greetingEl.innerText = hour < 12
        ? "Good Morning 🌞 — Welcome to GTEC Guest Lodge"
        : hour < 18
            ? "Good Afternoon 🌤️ — Welcome to GTEC Guest Lodge"
            : "Good Evening 🌙 — Welcome to GTEC Guest Lodge";
}

// ══════════════════════════════════════════
// 2. LOAD ROOMS — real-time Firestore listener
// ══════════════════════════════════════════
db.collection("rooms").onSnapshot(snapshot => {
    const roomsGrid = document.getElementById("roomsGrid");
    if (!roomsGrid) return;

    if (!snapshot || snapshot.empty) {
        console.warn("[Rooms] Snapshot empty — keeping current grid");
        return;
    }

    roomsGrid.innerHTML = "";

    let total = 0, avail = 0;
    snapshot.forEach(doc => {
        total++;
        if ((doc.data().status || '').toLowerCase() === 'available') avail++;
    });
    const ht = document.getElementById('heroTotal'); if (ht) ht.textContent = total;
    const ha = document.getElementById('heroAvail'); if (ha) ha.textContent = avail;

    const sortedRooms = [];
    snapshot.forEach(doc => sortedRooms.push({ id: doc.id, ...doc.data() }));
    sortedRooms.sort((a, b) => parseInt(a.number || 0) - parseInt(b.number || 0));

    sortedRooms.forEach(room => {
        const card = document.createElement("div");
        card.className = "room-card";

        const disabled = room.status !== "Available";
        const status = (room.status || 'unknown').toLowerCase();

        const imgHTML = room.image
            ? `<img src="${room.image}?v=${Date.now()}" alt="Room ${room.number}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div class="room-img-placeholder">
                   <i class="fas fa-bed"></i>
                   <span>ROOM ${room.number}</span>
               </div>`;

        card.innerHTML = `
            <div class="room-img-wrap">
                ${imgHTML}
                <span class="room-num-badge">Room ${room.number}</span>
                <span class="room-status-badge ${status}">${room.status || 'Unknown'}</span>
            </div>
            <div class="room-body">
                <div class="room-type">${room.type || 'Standard Room'}</div>
                <div class="room-title">Room ${room.number}</div>
                <div class="room-amenities">
                    <span class="amenity"><i class="fas fa-wifi"></i>WiFi</span>
                    <span class="amenity"><i class="fas fa-snowflake"></i>AC</span>
                    <span class="amenity"><i class="fas fa-tv"></i>TV</span>
                </div>
                <div class="room-footer">
                    <div class="room-capacity">
                        <i class="fas fa-user-friends"></i>
                        Up to ${room.capacity || 2} guests
                    </div>
                    <button class="book-btn" ${disabled ? "disabled" : ""}
                        onclick="openBooking('${room.id}', '${room.number}', '${room.type || 'Standard'}')">
                        ${disabled ? (room.status || 'Unavailable') : 'Book Now'}
                    </button>
                </div>
            </div>
        `;

        roomsGrid.appendChild(card);
    });

}, err => {
    console.error("[Rooms] Firestore error:", err.code, err.message);
    const roomsGrid = document.getElementById("roomsGrid");
    if (roomsGrid && roomsGrid.querySelector('.skeleton-card')) {
        roomsGrid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:60px 20px;">
                <div style="font-size:40px;margin-bottom:16px;">🏨</div>
                <p style="color:#64748b;font-size:16px;font-weight:500;">Rooms are currently being updated.</p>
                <p style="color:#94a3b8;font-size:13px;margin-top:8px;">Please refresh the page or contact us directly.</p>
                <button onclick="location.reload()" style="margin-top:20px;padding:10px 24px;background:#c9a84c;color:#0d1117;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
                    Refresh Page
                </button>
            </div>
        `;
    }
});


// ══════════════════════════════════════════
// 3. BOOKING MODAL — open / close
// ══════════════════════════════════════════
function openBooking(roomId, roomNumber, roomType) {
    document.getElementById("roomId").value = roomId;
    document.getElementById("roomNumber").value = roomNumber;

    const roomDisplay = document.getElementById("roomDisplay");
    if (roomDisplay) roomDisplay.value = `Room ${roomNumber}`;

    const modalLabel = document.getElementById("modalRoomLabel");
    if (modalLabel) modalLabel.textContent = `Room ${roomNumber} — ${roomType || 'Standard'}`;

    const sm = document.getElementById("successMessage");
    const em = document.getElementById("errorMessage");
    if (sm) { sm.style.display = 'none'; sm.textContent = ''; }
    if (em) { em.style.display = 'none'; em.textContent = ''; }

    // ✅ Set minimum check-in to NOW so past dates can't be selected
    const now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const nowStr = now.toISOString().slice(0, 16);

    const checkInEl  = document.getElementById("checkIn");
    const checkOutEl = document.getElementById("checkOut");
    if (checkInEl)  { checkInEl.min  = nowStr; checkInEl.value  = ''; }
    if (checkOutEl) { checkOutEl.min = nowStr; checkOutEl.value = ''; }

    // ✅ Whenever check-in changes, push check-out min forward
    if (checkInEl && checkOutEl) {
        // Remove any old listener by cloning
        const newCheckIn = checkInEl.cloneNode(true);
        checkInEl.parentNode.replaceChild(newCheckIn, checkInEl);
        newCheckIn.addEventListener("change", function () {
            if (this.value) {
                checkOutEl.min = this.value;
                if (checkOutEl.value && checkOutEl.value <= this.value) {
                    checkOutEl.value = '';
                }
            }
        });
    }

    const modal = document.getElementById("bookingModal");
    modal.classList.add("open");
    modal.style.display = "flex";

    console.log(`[Booking] Modal opened — Room ${roomNumber}`);
}

const closeModalBtn = document.getElementById("closeModal");
if (closeModalBtn) {
    closeModalBtn.onclick = () => {
        const modal = document.getElementById("bookingModal");
        modal.classList.remove("open");
        modal.style.display = "none";
    };
}

const bookingModal = document.getElementById("bookingModal");
if (bookingModal) {
    bookingModal.addEventListener("click", (e) => {
        if (e.target === bookingModal) {
            bookingModal.classList.remove("open");
            bookingModal.style.display = "none";
        }
    });
}


// ══════════════════════════════════════════
// 4. BOOKING FORM SUBMIT
// ══════════════════════════════════════════
const bookingForm = document.getElementById("bookingForm");

if (bookingForm) {
    bookingForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const name          = document.getElementById("guestName").value.trim();
        const phone         = document.getElementById("phone").value.trim();
        const email         = document.getElementById("email").value.trim();
        const guestsCount   = parseInt(document.getElementById("guests").value);
        const checkinInput  = document.getElementById("checkIn").value;
        const checkoutInput = document.getElementById("checkOut").value;
        const notes         = document.getElementById("specialRequest").value.trim();
        const roomId        = document.getElementById("roomId").value;
        const roomNumber    = document.getElementById("roomNumber").value;

        if (!name || !phone || !email || !guestsCount || !checkinInput || !checkoutInput || !roomId) {
            showFormMsg("Please fill in all required fields.", "error");
            return;
        }

        const checkinDate      = new Date(checkinInput);
        const expectedCheckout = new Date(checkoutInput);

        // ✅ Hard validation: checkout must be strictly after checkin
        if (expectedCheckout <= checkinDate) {
            showFormMsg("❌ Check-out date must be after check-in date.", "error");
            document.getElementById("checkOut").focus();
            return;
        }

        // ─────────────────────────────────────────────────────────
// 🆕 CALCULATE NUMBER OF NIGHTS
// ─────────────────────────────────────────────────────────
const oneDay = 1000 * 60 * 60 * 24;
function normalizeToNoon(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}
const nights = Math.round((normalizeToNoon(expectedCheckout) - normalizeToNoon(checkinDate)) / oneDay);


        const submitBtn = document.getElementById("submitBookingBtn")
            || bookingForm.querySelector(".submit-btn")
            || bookingForm.querySelector(".book-btn");
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';
        }

        const idNumber  = `GH-${Math.floor(Math.random() * 100000)}`;
        const guestData = {
            name, phone, email, idNumber, guestsCount,
            roomId, roomNumber,
            checkinDate:     firebase.firestore.Timestamp.fromDate(checkinDate),
            checkinDateStr:  checkinDate.toISOString(),
            checkoutDate:    firebase.firestore.Timestamp.fromDate(expectedCheckout),
            checkoutDateStr: expectedCheckout.toISOString(),
            notes,
            status:        "checkedin",
            paymentStatus: "unpaid",
            timestamp:     firebase.firestore.FieldValue.serverTimestamp()
                };

        try {
            await db.collection("guests").add(guestData);
console.log("[Firestore] Guest saved ✅");

// Auto-create unpaid invoice placeholder
await db.collection("invoices").add({
    invoiceNumber: `#PENDING-${idNumber}`,
    guestName: name,
    guestPhone: phone,
    guestEmail: email,
    guestId: idNumber,
    room: roomNumber,
    guestsCount: guestsCount,
    paymentMethod: 'momo',
    paymentStatus: 'unpaid',
    subtotal: 0,
    notes: notes || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
});
console.log("[Firestore] Placeholder invoice created ✅");

            await db.collection("rooms").doc(roomId).update({ status: "Reserved" });
            console.log("[Firestore] Room → Reserved ✅");

            const fmt = (d) => d.toLocaleString("en-GB", {
                weekday: "short", year: "numeric", month: "short",
                day: "numeric", hour: "2-digit", minute: "2-digit"
            });
            const formattedTime = fmt(new Date());

            const adminPayload = {
                name, phone, email, room: roomNumber,
                checkin:  fmt(checkinDate),
                checkout: fmt(expectedCheckout),
                nights:   nights,
                notes: notes || "None", time: formattedTime
            };
            const guestPayload = {
                title:    `Booking Confirmed — Room ${roomNumber}`,
                name, phone, email, room: roomNumber,
                checkin:  fmt(checkinDate),
                checkout: fmt(expectedCheckout),
                nights:   nights,
                idNumber, time: formattedTime
            };

            const ejs = _ejs();
            if (ejs) {
                try {
                    await ejs.send("service_muxt9dr", "template_ejmyipp", adminPayload);
                    console.log("[EmailJS] Admin email sent ✅");
                } catch (e) {
                    console.error("[EmailJS] Admin email failed:", e);
                    if (typeof showToast === "function") {
                        showToast(`⚠️ Admin email failed: ${e?.text || e?.message || "quota may be exceeded"}`, false);
                    }
                }

                try {
                    await ejs.send("service_muxt9dr", "template_zbbfaym", guestPayload);
                    console.log("[EmailJS] Guest email sent ✅");
                } catch (e) {
                    console.error("[EmailJS] Guest email failed:", e);
                    if (typeof showToast === "function") {
                        showToast(`⚠️ Guest email failed: ${e?.text || e?.message || "quota may be exceeded"}`, false);
                    }
                }
            }

            // Google Sheets — non-fatal
            try {
                await fetch("https://script.google.com/macros/s/AKfycbwDU_27f2ivJqxztffDPJD6DFaJualYqPza4gldvYCUxo1eyV6x6b04B1SIZRpi5mMBNg/exec", {
                    method: "POST",
                    mode:   "no-cors",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name:     name        || '—',
                        phone:    phone       || '—',
                        email:    email       || '—',
                        idNumber: idNumber    || '—',
                        guests:   guestsCount || '—',
                        room:     roomNumber  || '—',
                        checkin:  checkinDate.toLocaleString('en-GB'),
                        checkout: expectedCheckout.toLocaleString('en-GB'),
                        notes:    notes       || '—'
                    })
                });
            } catch (e) { console.warn("[Sheets] Non-fatal:", e); }


                        // ─────────── AUTOMATIC WHATSAPP NOTIFICATION (via Vercel API) ───────────
                        try {
                let rawPhone = phone.replace(/\D/g, '');
                if (rawPhone.startsWith('0')) rawPhone = rawPhone.slice(1);
                if (!rawPhone.startsWith('233')) rawPhone = '233' + rawPhone;
                const whatsappNumber = rawPhone;

                const bookingDetails =
                    `Room: ${roomNumber}\n` +
                    `Check-In: ${fmt(checkinDate)}\n` +
                    `Check-Out: ${fmt(expectedCheckout)}\n` +
                    `Nights: ${nights}\n` +
                    `Guest: ${name}`;

                const response = await fetch('https://gtec-whatsapp-api.vercel.app/api/send-whatsapp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': 'gtec-2026-wa-secret'
                    },
                    body: JSON.stringify({
                        customerPhone: whatsappNumber,
                        bookingId: idNumber,
                        bookingDetails: bookingDetails
                    })
                });

                const data = await response.json();
                if (response.ok) {
                    console.log('[WhatsApp] ✅ Auto‑message sent to', whatsappNumber);
                } else {
                    // Show the detailed error from the WhatsApp API
                    console.error('[WhatsApp] ❌ Server responded with error:', data);
                }
            } catch (err) {
                console.warn('[WhatsApp] ⚠️ Failed to send (non‑critical):', err.message);
            }
            // ─────────────────────────────────────────────────────────────────────────


            bookingForm.reset();

            // ✅ Pass all booking data so the WA modal is fully pre-populated
            if (typeof showSuccessOverlay === "function") {
                const modalLabelEl = document.getElementById("modalRoomLabel");
                const roomType = modalLabelEl
                    ? (modalLabelEl.textContent.split("—")[1] || "Standard").trim()
                    : "Standard";

                showSuccessOverlay(idNumber, {
                    guestName:  name,
                    roomNumber: roomNumber,
                    roomType:   roomType,
                    checkIn:    fmt(checkinDate),
                    checkOut:   fmt(expectedCheckout),
                    guestPhone: phone   // ← pre-fills WhatsApp number field automatically
                });
            } else {
                showFormMsg("✅ Booking confirmed! Check your email for details.", "success");
            }

            if (typeof showToast === "function") showToast("Booking confirmed! ✅");

        } catch (err) {
            console.error("[Booking] Error:", err);
            showFormMsg("❌ Booking failed. Please try again.", "error");
            if (typeof showToast === "function") showToast("Booking failed ❌", false);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm Booking';
            }
        }
    });
}

// ── Form message helper ──────────────────────────────────────────────────────
function showFormMsg(msg, type) {
    const sm = document.getElementById("successMessage");
    const em = document.getElementById("errorMessage");
    if (type === "success") {
        if (sm) { sm.textContent = msg; sm.style.display = "block"; }
        if (em) em.style.display = "none";
    } else {
        if (em) { em.textContent = msg; em.style.display = "block"; }
        if (sm) sm.style.display = "none";
        if (!em && sm) { sm.style.color = "red"; sm.textContent = msg; }
    }
}