// sidebar.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared sidebar logic — runs on every admin page.
// Adds a live chat message count badge to the Chat nav item automatically.
// Just include this file AFTER firebase.js on every page.
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

    // ── 1. Find the Chat nav link and inject badge span ───────────────────
    const chatNavLinks = document.querySelectorAll('a[href="chat.html"]');

    chatNavLinks.forEach(link => {
        // Avoid adding duplicate badge if already exists (e.g. on chat.html itself)
        if (!link.querySelector('.nav-chat-badge')) {
            const badge = document.createElement('span');
            badge.className = 'nav-chat-badge';
            badge.style.cssText = `
                display: none;
                background: #ef4444;
                color: white;
                font-size: 10px;
                font-weight: 700;
                min-width: 18px;
                height: 18px;
                border-radius: 10px;
                padding: 0 5px;
                margin-left: auto;
                align-items: center;
                justify-content: center;
                line-height: 1;
            `;
            link.style.display = 'flex';
            link.style.alignItems = 'center';
            link.appendChild(badge);
        }
    });

    // ── 2. Listen to liveChats in real-time and update all badges ─────────
    if (typeof db !== 'undefined') {
        db.collection("liveChats").onSnapshot(snapshot => {
            const badges = document.querySelectorAll('.nav-chat-badge');
            badges.forEach(badge => {
                if (snapshot.size > 0) {
                    badge.textContent = snapshot.size;
                    badge.style.display = 'inline-flex';
                } else {
                    badge.style.display = 'none';
                }
            });
        }, err => {
            console.warn("[sidebar.js] Chat badge error:", err);
        });
    }

});