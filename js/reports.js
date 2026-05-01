// reports.js

function getSafeDateString(dateValue) {
    if (!dateValue) return "";

    if (typeof dateValue === 'string') return dateValue;

    if (typeof dateValue.toDate === 'function') {
        try {
            return dateValue.toDate().toISOString();
        } catch (e) {
            return "";
        }
    }

    try {
        return new Date(dateValue).toISOString();
    } catch (e) {
        return "";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadReports();
});

async function loadReports() {
    if (typeof UI !== 'undefined' && UI.showLoader) {
        UI.showLoader();
    }

    try {
        if (typeof db === 'undefined') {
            throw new Error("Firebase db is not initialized");
        }

        // ================= ROOMS =================
        const roomsSnapshot = await db.collection('rooms').get();

        let totalRooms = roomsSnapshot.size;
        let occupiedRooms = 0;
        let availableRooms = 0;

        roomsSnapshot.forEach(doc => {
            const data = doc.data() || {};
            const st = (data.status || '').toLowerCase();

            if (st === 'occupied') occupiedRooms++;
            if (st === 'available') availableRooms++;
        });

        // ================= OCCUPANCY =================
        let occupancyPercent = 0;
        if (totalRooms > 0) {
            occupancyPercent = Math.round((occupiedRooms / totalRooms) * 100);
        }

        // ================= TODAY =================
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const todayStr = now.toISOString().split('T')[0];

        // ================= CHECK-INS =================
        const guestsSnapshot = await db.collection('guests').get();
        let dailyCheckins = 0;

        guestsSnapshot.forEach(doc => {
            const data = doc.data() || {};

            const dateStr = getSafeDateString(data.checkinDateStr || data.checkinDate);

            if (dateStr && dateStr.startsWith(todayStr)) {
                dailyCheckins++;
            }
        });

        // ================= CHECK-OUTS =================
        const historySnapshot = await db.collection('history').get();
        let dailyCheckouts = 0;

        historySnapshot.forEach(doc => {
            const data = doc.data() || {};

            const dateStr = getSafeDateString(data.checkoutDateStr || data.checkoutDate);

            if (dateStr && dateStr.startsWith(todayStr)) {
                dailyCheckouts++;
            }
        });

        // ================= UPDATE UI =================
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        setText('rep-total-rooms', totalRooms);
        setText('rep-occupied-rooms', occupiedRooms);
        setText('rep-available-rooms', availableRooms);
        setText('rep-daily-checkins', dailyCheckins);
        setText('rep-daily-checkouts', dailyCheckouts);
        setText('rep-occupancy', `${occupancyPercent}%`);
        setText('rep-capacity-text', `${occupiedRooms} / ${totalRooms}`);

        const bar = document.getElementById('rep-occupancy-bar');
        if (bar) {
            bar.style.width = `${occupancyPercent}%`;

            if (occupancyPercent < 50) {
                bar.style.background = 'var(--status-available)';
            } else if (occupancyPercent < 80) {
                bar.style.background = 'var(--status-reserved)';
            } else {
                bar.style.background = 'var(--status-occupied)';
            }
        }

    } catch (error) {
        console.error("Error loading reports:", error);

        if (typeof UI !== 'undefined' && UI.showNotification) {
            UI.showNotification("Error generating reports", "error");
        }

    } finally {
        if (typeof UI !== 'undefined' && UI.hideLoader) {
            UI.hideLoader();
        }
    }
}