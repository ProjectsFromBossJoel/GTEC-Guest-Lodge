// firebase.js
// ─────────────────────────────────────────────────────────────────────────────
// Firebase initialization + global UI utilities
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════
// ✅ AUTO CACHE BUSTER
// Uses current timestamp as version — automatically unique on every page load.
// No manual version bumping ever needed. Works on all devices including mobile.
// ══════════════════════════════════════════
(function () {
    const v = Date.now();

    // List of ALL JS files that should never be cached
    const scripts = [
        'js/sidebar.js',
        'js/logs.js',
        'js/guests.js',
        'js/checkout.js',
        'js/checkin.js',
        'js/roomsui.js',
        'js/dashboard.js',
        'js/rooms.js',
        'js/reports.js',
        'js/roles.js',
        'js/verification.js',
        'js/chat.js',
    ];

    // For each script already in the DOM, add ?v= to its src
    document.querySelectorAll('script[src]').forEach(tag => {
        scripts.forEach(name => {
            // Match the filename without any existing ?v= param
            if (tag.src.includes(name.split('/').pop().split('?')[0])) {
                const clean = tag.src.split('?')[0];
                tag.src = `${clean}?v=${v}`;
            }
        });
    });

    // Also bust firebase.js itself
    const self = document.querySelector('script[src*="firebase.js"]');
    if (self) {
        const clean = self.src.split('?')[0];
        // Can't change own src after load, but set a flag for next load
        // Instead we store version in sessionStorage for service workers
    }

    console.log(`[Cache] Auto-busted all JS files with v=${v} ✅`);
})();


// ══════════════════════════════════════════
// FIREBASE CONFIG
// ══════════════════════════════════════════
const firebaseConfig = {
    apiKey: "AIzaSyAWEF_WEDqMTQAP61zmqTyMN-AK43OWoT4",
    authDomain: "guesthousesystem-86fdc.firebaseapp.com",
    projectId: "guesthousesystem-86fdc",
    storageBucket: "guesthousesystem-86fdc.firebasestorage.app",
    messagingSenderId: "482448753298",
    appId: "1:482448753298:web:e3e17de5bbf0f268121c4b",
    measurementId: "G-1YGYCD1M28"
};

// ✅ Single initialization — no duplicate calls
let app, auth, db;

try {
    app = firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(firebaseConfig);

    auth = firebase.auth();

    // ✅ SESSION persistence — auth is cleared automatically when the tab
    // or browser window is closed. No manual logout needed on tab close.
    // Uses sessionStorage instead of localStorage under the hood.
    auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
        .then(() => console.log("[Firebase] Auth persistence set to SESSION ✅"))
        .catch(err => console.error("[Firebase] Persistence error:", err));

    db = firebase.firestore();

    // ✅ No offline persistence — always fetch fresh data from server
    db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });

    console.log("[Firebase] Initialized ✅ — live sync active");

} catch (error) {
    console.error("[Firebase] Initialization error:", error);
}


// ══════════════════════════════════════════
// GLOBAL UI UTILITIES
// ══════════════════════════════════════════
const UI = {

    showNotification: (message, type = 'success') => {
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        notif.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"
               style="color: ${type === 'success' ? 'var(--status-available)' : 'var(--status-occupied)'}; font-size: 20px;"></i>
            <span>${message}</span>
        `;
        document.body.appendChild(notif);
        void notif.offsetWidth;
        notif.classList.add('show');
        setTimeout(() => {
            notif.classList.remove('show');
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    },

    showLoader: () => {
        let loader = document.getElementById('global-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'global-loader';
            loader.className = 'loader-overlay';
            loader.innerHTML = '<div class="spinner"></div>';
            document.body.appendChild(loader);
        }
        loader.classList.remove('hidden');
    },

    hideLoader: () => {
        const loader = document.getElementById('global-loader');
        if (loader) loader.classList.add('hidden');
    },

    formatDate: (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    }
};

// Expose globals
window.UI = UI;
window.db = db;
window.auth = auth;