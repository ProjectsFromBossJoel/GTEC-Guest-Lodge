/*!
 * GTEC Guest Lodge — collapsible sidebar (icon-only rail)
 *
 * Save as:  js/sidebar-collapse.js
 * Include in <head>, right after css/style.css:
 *   <script src="js/sidebar-collapse.js"></script>
 */
(function () {
    'use strict';

    var KEY  = 'sidebarCollapsed';
    var root = document.documentElement;

    // Restore the saved state immediately (before first paint) so there is no flash
    try {
        if (localStorage.getItem(KEY) === '1') root.classList.add('sb-collapsed');
    } catch (e) {}

    // ── Styles ────────────────────────────────────────────────────────────
    var css = `
    /* Toggle button */
    .collapse-btn {
        width: 40px; height: 40px; flex-shrink: 0;
        display: none; align-items: center; justify-content: center;
        padding: 0; margin-right: 12px;
        border: 1.5px solid #e2e8f0; border-radius: 10px;
        background: #ffffff; color: #1f3b57; cursor: pointer;
        transition: background .15s, color .15s, border-color .15s;
    }
    .collapse-btn:hover { background: #1f3b57; border-color: #1f3b57; color: #ffffff; }
    .collapse-btn svg   { width: 22px; height: 22px; display: block; }
    .collapse-btn .cb-chev {
        transform-box: fill-box; transform-origin: center;
        transition: transform .2s ease;
    }
    /* Chevron flips to point right when the sidebar is collapsed (= "expand") */
    html.sb-collapsed .collapse-btn .cb-chev { transform: rotate(180deg); }

    @media (min-width: 769px) {
        .collapse-btn   { display: flex; }
        .toggle-sidebar { display: none !important; }

        /* Collapsed = narrow icon rail */
        html.sb-collapsed .sidebar {
            position: fixed !important;
            top: 0; left: 0; bottom: 0;
            width: 78px !important; min-width: 78px !important;
            z-index: 200; overflow: hidden;
        }
        html.sb-collapsed .main-content {
            margin-left: 78px !important;
            width: calc(100% - 78px) !important;
            max-width: none !important;
        }

        /* Logo only, no "Guest Lodge" text */
        html.sb-collapsed .sidebar-header {
            display: flex; justify-content: center;
            padding-left: 0 !important; padding-right: 0 !important;
        }
        html.sb-collapsed .sidebar-logo { font-size: 0 !important; justify-content: center; }

        /* Menu: hide section labels + link text, keep icons */
        html.sb-collapsed .menu-label { display: none !important; }
        html.sb-collapsed .sidebar-menu {
            overflow-x: hidden; overflow-y: auto; scrollbar-width: none;
        }
        html.sb-collapsed .sidebar-menu::-webkit-scrollbar { display: none; }
        html.sb-collapsed .menu-item {
            font-size: 0 !important; justify-content: center; position: relative;
            padding-left: 0 !important; padding-right: 0 !important; gap: 0 !important;
        }
        html.sb-collapsed .menu-item i { font-size: 18px !important; margin: 0 !important; }

        /* Unread badges sit on the corner of the icon */
        html.sb-collapsed .nav-badge {
            position: absolute; top: 4px; right: 16px; font-size: 10px !important;
        }
    }`;

    var style = document.createElement('style');
    style.id = 'sidebar-collapse-styles';
    style.textContent = css;
    document.head.appendChild(style);

    // ── Icon: rounded panel, left divider, left chevron ───────────────────
    var ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="3" y="4.5" width="18" height="15" rx="4"/>' +
        '<line x1="8.2" y1="4.5" x2="8.2" y2="19.5"/>' +
        '<polyline class="cb-chev" points="15.2,8.6 12.2,12 15.2,15.4"/>' +
        '</svg>';

    // ── Button + behaviour ────────────────────────────────────────────────
    function init() {
        var header = document.querySelector('.header');
        if (!header || document.getElementById('collapse-sidebar-btn')) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'collapse-sidebar-btn';
        btn.className = 'collapse-btn';
        btn.innerHTML = ICON;

        var burger = document.getElementById('toggle-sidebar');
        if (burger && burger.parentNode) burger.parentNode.insertBefore(btn, burger.nextSibling);
        else header.insertBefore(btn, header.firstChild);

        function sync() {
            var c = root.classList.contains('sb-collapsed');
            btn.title = c ? 'Expand sidebar' : 'Collapse sidebar';
            btn.setAttribute('aria-label', btn.title);
            btn.setAttribute('aria-pressed', c ? 'true' : 'false');
        }

        btn.addEventListener('click', function () {
            var c = root.classList.toggle('sb-collapsed');
            try { localStorage.setItem(KEY, c ? '1' : '0'); } catch (e) {}
            sync();
            // Let charts / grids re-measure after the layout change
            window.dispatchEvent(new Event('resize'));
        });
        sync();

        // Hover tooltips so the icons are identifiable when collapsed
        document.querySelectorAll('.sidebar .menu-item').forEach(function (a) {
            var clone = a.cloneNode(true);
            clone.querySelectorAll('.nav-badge').forEach(function (b) { b.remove(); });
            var label = clone.textContent.replace(/\s+/g, ' ').trim();
            if (label) a.title = label;
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();