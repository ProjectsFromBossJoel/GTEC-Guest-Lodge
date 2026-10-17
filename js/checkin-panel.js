/*!
 * GTEC Guest Lodge — check-in helpers
 * Accra weather (top right of the page header) · live booking summary · step-by-step check-in guide
 *
 * Save as:  js/checkin-panel.js
 * Load it AFTER js/checkin.js on checkin.html. Nothing in checkin.js is changed.
 */
(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────────────────────
    var WX_URL =
        'https://api.open-meteo.com/v1/forecast?latitude=5.6037&longitude=-0.1870' +
        '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&timezone=Africa%2FAccra&forecast_days=1';
    var WX_REFRESH_MS = 15 * 60 * 1000;

    var CEDI = 'GH\u20B5 ';

    // Fields marked `required` in the check-in form
    var REQUIRED = [
        'guest-name', 'guest-phone', 'guest-email', 'guest-count',
        'room-select', 'checkin-date', 'checkout-date', 'notes'
    ];

    // Steps 1-3 are tracked live from the form; 4-6 happen in the popup / Verification page
    var STEPS = [
        { title: 'Guest details',                     hint: 'Name, phone, email and purpose of stay.' },
        { title: 'Room &amp; dates',                  hint: 'Pick a free room and check the dates.' },
        { title: 'Click \u201CCheck In Guest\u201D',  hint: 'Registers the booking. The guest is notified automatically.' },
        { title: 'Copy the Guest ID',                 hint: 'Use \u201CCopy ID\u201D in the popup and share it with the guest.' },
        { title: 'Verify &amp; Check In Now',         hint: 'Opens the Verification page to confirm the guest.' },
        { title: 'Room marked Occupied',              hint: 'Happens once verification is complete.' }
    ];
    var LIVE_STEPS = 3;

    // ── Styles ────────────────────────────────────────────────────────────
    var CSS = `
    /* Two-column layout: form on the left, panel on the right */
    .content-area.ci-has-panel {
        display: grid;
        grid-template-columns: minmax(0, 800px) 340px;
        column-gap: 24px;
        align-items: start;
        justify-content: start;
    }
    .content-area.ci-has-panel > .page-header {
        grid-column: 1 / -1;
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; flex-wrap: wrap;
    }
    .content-area.ci-has-panel > .card { grid-column: 1; grid-row: 2; }

    .ci-side {
        grid-column: 2; grid-row: 2;
        display: flex; flex-direction: column; gap: 14px;
        position: sticky; top: 90px;
        max-height: calc(100vh - 110px);
        overflow-y: auto; scrollbar-width: thin;
        padding: 2px;
    }

    /* Stack under the form on narrower screens */
    @media (max-width: 1279px) {
        html:not(.sb-collapsed) .content-area.ci-has-panel { grid-template-columns: minmax(0, 1fr); }
        html:not(.sb-collapsed) .content-area.ci-has-panel > .card,
        html:not(.sb-collapsed) .ci-side {
            grid-column: 1; grid-row: auto;
            position: static; max-height: none; overflow: visible;
        }
        html:not(.sb-collapsed) .ci-side { margin-top: 20px; }
    }
    @media (max-width: 1099px) {
        html.sb-collapsed .content-area.ci-has-panel { grid-template-columns: minmax(0, 1fr); }
        html.sb-collapsed .content-area.ci-has-panel > .card,
        html.sb-collapsed .ci-side {
            grid-column: 1; grid-row: auto;
            position: static; max-height: none; overflow: visible;
        }
        html.sb-collapsed .ci-side { margin-top: 20px; }
    }

    /* Cards */
    .ci-card {
        background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px;
        box-shadow: 0 2px 12px rgba(0,0,0,.05); flex-shrink: 0;
    }
    .ci-card-head {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 12px 16px; border-bottom: 1px solid #f1f5f9;
        font-size: 13px; font-weight: 700; color: #1e293b;
    }
    .ci-card-head i { color: #1f3b57; margin-right: 7px; }
    .ci-card-body { padding: 14px 16px; }

    .ci-pill { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; white-space: nowrap; }
    .ci-pill-amber { background: #fef3c7; color: #92400e; }
    .ci-pill-green { background: #dcfce7; color: #15803d; }
    .ci-pill-red   { background: #fee2e2; color: #b91c1c; }

    /* Weather chip (page header, top right) */
    .ci-weather {
        display: flex; align-items: center; gap: 12px;
        width: 340px; max-width: 100%; box-sizing: border-box;
        padding: 10px 14px; border-radius: 14px;
        background: linear-gradient(135deg, #eff6ff, #e0f2fe);
        border: 1px solid #bfdbfe;
    }
    .ci-weather-icon {
        width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
        background: #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,.06);
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; color: #f59e0b;
    }
    .ci-weather-body { flex: 1; min-width: 0; }
    .ci-weather-top  { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .ci-weather-temp { font-size: 24px; font-weight: 800; color: #1f3b57; line-height: 1; }
    .ci-weather-desc { font-size: 12px; font-weight: 600; color: #475569; }
    .ci-weather-meta { font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.4; }
    .ci-weather-loc  {
        align-self: flex-start; font-size: 10px; font-weight: 700; color: #3b82f6;
        text-transform: uppercase; letter-spacing: .06em;
    }

    /* Booking summary */
    .ci-row {
        display: flex; justify-content: space-between; gap: 12px;
        padding: 7px 0; border-bottom: 1px dashed #eef2f7; font-size: 13px;
    }
    .ci-row span   { color: #64748b; }
    .ci-row strong { color: #1e293b; font-weight: 600; text-align: right; min-width: 0; overflow-wrap: anywhere; }
    .ci-total {
        display: flex; justify-content: space-between; align-items: center;
        margin-top: 12px; padding: 12px 14px; border-radius: 10px;
        background: #f0f9ff; border: 1px solid #bae6fd;
    }
    .ci-total span   { font-size: 12px; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: .04em; }
    .ci-total strong { font-size: 20px; font-weight: 800; color: #1f3b57; }
    .ci-note { display: none; margin-top: 10px; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45; }
    .ci-note.err  { display: block; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
    .ci-note.warn { display: block; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }

    /* Check-in steps */
    .ci-count { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; background: #f1f5f9; color: #475569; white-space: nowrap; }
    .ci-step-group {
        margin: 0 0 10px; font-size: 10px; font-weight: 700; color: #94a3b8;
        text-transform: uppercase; letter-spacing: .07em;
    }
    .ci-step-group.later { margin-top: 6px; }
    .ci-step { position: relative; display: flex; gap: 12px; padding-bottom: 14px; }
    .ci-step::before {
        content: ''; position: absolute; left: 11px; top: 26px; bottom: 2px;
        width: 2px; background: #e2e8f0;
    }
    .ci-step-end { padding-bottom: 4px; }
    .ci-step-end::before { display: none; }
    .ci-step-dot {
        width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; box-sizing: border-box;
        display: flex; align-items: center; justify-content: center;
        border: 2px solid #cbd5e1; background: #ffffff; color: #94a3b8;
        font-size: 11px; font-weight: 700; transition: all .2s;
    }
    .ci-step-after .ci-step-dot { border-style: dashed; }
    .ci-step.current .ci-step-dot {
        background: #1f3b57; border-color: #1f3b57; color: #ffffff;
        box-shadow: 0 0 0 4px rgba(31,59,87,.12);
    }
    .ci-step.done .ci-step-dot { background: #22c55e; border-color: #22c55e; color: #ffffff; }
    .ci-step.done .ci-step-dot span { display: none; }
    .ci-step.done .ci-step-dot::after { content: '\u2713'; }
    .ci-step.done::before { background: #86efac; }
    .ci-step-text  { min-width: 0; padding-top: 1px; }
    .ci-step-title { font-size: 13px; font-weight: 700; color: #475569; line-height: 1.3; }
    .ci-step.current .ci-step-title { color: #1f3b57; }
    .ci-step.done .ci-step-title    { color: #15803d; }
    .ci-step-hint  { margin-top: 2px; font-size: 11.5px; color: #94a3b8; line-height: 1.4; }
    .ci-step.current .ci-step-hint  { color: #64748b; }
    .ci-steps-note {
        display: flex; gap: 8px; margin-top: 12px; padding: 9px 11px; border-radius: 8px;
        background: #f0f9ff; border: 1px solid #bae6fd; color: #0369a1;
        font-size: 11.5px; line-height: 1.45;
    }
    .ci-steps-note i { margin-top: 2px; flex-shrink: 0; }
    `;

    // ── Helpers ───────────────────────────────────────────────────────────
    function money(n) { return CEDI + Number(n).toFixed(2); }

    // Same parsing as checkin.js: datetime-local value + ":00"
    function parseDT(v) {
        if (!v) return null;
        var d = new Date(v + ':00');
        return isNaN(d.getTime()) ? null : d;
    }

    // Same night-count rule as checkin.js: compare both dates at noon
    function noon(d) { var x = new Date(d); x.setHours(12, 0, 0, 0); return x; }

    function fmtDT(d) {
        return d.toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    function val(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    // ── Weather (Open-Meteo, no API key) ──────────────────────────────────
    function wxInfo(code) {
        if (code === 0) return { text: 'Clear sky',     icon: 'fa-sun',                  color: '#f59e0b' };
        if (code === 1) return { text: 'Mostly clear',  icon: 'fa-sun',                  color: '#f59e0b' };
        if (code === 2) return { text: 'Partly cloudy', icon: 'fa-cloud-sun',            color: '#f59e0b' };
        if (code === 3) return { text: 'Overcast',      icon: 'fa-cloud',                color: '#64748b' };
        if (code === 45 || code === 48) return { text: 'Foggy', icon: 'fa-smog',          color: '#64748b' };
        if (code >= 51 && code <= 57)   return { text: 'Drizzle', icon: 'fa-cloud-rain',  color: '#3b82f6' };
        if (code >= 61 && code <= 67)   return { text: 'Rain', icon: 'fa-cloud-showers-heavy', color: '#3b82f6' };
        if (code >= 71 && code <= 77)   return { text: 'Snow', icon: 'fa-snowflake',      color: '#0ea5e9' };
        if (code >= 80 && code <= 82)   return { text: 'Rain showers', icon: 'fa-cloud-showers-heavy', color: '#3b82f6' };
        if (code === 85 || code === 86) return { text: 'Snow showers', icon: 'fa-snowflake', color: '#0ea5e9' };
        if (code >= 95)                 return { text: 'Thunderstorm', icon: 'fa-bolt',   color: '#7c3aed' };
        return { text: 'Weather', icon: 'fa-cloud', color: '#64748b' };
    }

    function loadWeather(els) {
        fetch(WX_URL)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (d) {
                var c = d.current, day = d.daily || {};
                var info  = wxInfo(c.weather_code);
                var temp  = Math.round(c.temperature_2m);
                var feels = Math.round(c.apparent_temperature);
                var hum   = Math.round(c.relative_humidity_2m);
                var wind  = Math.round(c.wind_speed_10m);
                var hi    = day.temperature_2m_max ? Math.round(day.temperature_2m_max[0]) : '\u2014';
                var lo    = day.temperature_2m_min ? Math.round(day.temperature_2m_min[0]) : '\u2014';
                var rain  = day.precipitation_probability_max ? day.precipitation_probability_max[0] : null;

                els.icon.innerHTML = '<i class="fas ' + info.icon + '"></i>';
                els.icon.style.color = info.color;
                els.temp.textContent = temp + '\u00B0C';
                els.desc.textContent = info.text;
                els.meta.textContent =
                    'Feels ' + feels + '\u00B0 \u00B7 H ' + hi + '\u00B0 \u00B7 L ' + lo + '\u00B0' +
                    (rain !== null ? ' \u00B7 Rain ' + rain + '%' : '');
                els.root.title =
                    'Humidity ' + hum + '% \u00B7 Wind ' + wind + ' km/h \u00B7 Updated ' +
                    new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            })
            .catch(function (err) {
                console.warn('[CheckinPanel] Weather unavailable:', err);
                els.icon.innerHTML = '<i class="fas fa-cloud"></i>';
                els.icon.style.color = '#94a3b8';
                els.temp.textContent = '\u2014';
                els.desc.textContent = 'Weather unavailable';
                els.meta.textContent = 'Will retry automatically.';
            });
    }

    // ── Build + wire ──────────────────────────────────────────────────────
    function boot() {
        var content = document.querySelector('.content-area');
        var card    = content && content.querySelector('.card');
        var form    = document.getElementById('checkin-form');
        if (!content || !card || !form || document.getElementById('ci-side-panel')) return;

        var style = document.createElement('style');
        style.id = 'ci-panel-styles';
        style.textContent = CSS;
        document.head.appendChild(style);

        var $ = function (id) { return document.getElementById(id); };

        // ── Weather chip → top right of the page header ──
        var chip = document.createElement('div');
        chip.id = 'ci-weather';
        chip.className = 'ci-weather';
        chip.setAttribute('aria-label', 'Weather in Accra');
        chip.innerHTML = `
            <div class="ci-weather-icon" id="ciw-icon"><i class="fas fa-cloud-sun"></i></div>
            <div class="ci-weather-body">
                <div class="ci-weather-top">
                    <span class="ci-weather-temp" id="ciw-temp">\u2014</span>
                    <span class="ci-weather-desc" id="ciw-desc">Loading weather\u2026</span>
                </div>
                <div class="ci-weather-meta" id="ciw-meta"></div>
            </div>
            <div class="ci-weather-loc" id="ciw-loc">Accra</div>`;
        var header = content.querySelector('.page-header');
        if (header) header.appendChild(chip);
        else content.insertBefore(chip, content.firstChild);

        var wx = {
            root: chip, icon: $('ciw-icon'), temp: $('ciw-temp'),
            desc: $('ciw-desc'), meta: $('ciw-meta'), loc: $('ciw-loc')
        };
        loadWeather(wx);
        setInterval(function () { loadWeather(wx); }, WX_REFRESH_MS);

        // ── Side panel: booking summary + steps ──
        var stepsHTML = STEPS.map(function (s, i) {
            var group = i === 0
                ? '<div class="ci-step-group">Fill in the form</div>'
                : i === LIVE_STEPS ? '<div class="ci-step-group later">After booking (popup)</div>' : '';
            var cls = 'ci-step' +
                (i >= LIVE_STEPS ? ' ci-step-after' : '') +
                (i === LIVE_STEPS - 1 || i === STEPS.length - 1 ? ' ci-step-end' : '');
            return group +
                '<div class="' + cls + '">' +
                    '<div class="ci-step-dot"><span>' + (i + 1) + '</span></div>' +
                    '<div class="ci-step-text">' +
                        '<div class="ci-step-title">' + s.title + '</div>' +
                        '<div class="ci-step-hint">' + s.hint + '</div>' +
                    '</div>' +
                '</div>';
        }).join('');

        var aside = document.createElement('aside');
        aside.id = 'ci-side-panel';
        aside.className = 'ci-side';
        aside.setAttribute('aria-label', 'Check-in helper panel');
        aside.innerHTML = `
            <div class="ci-card">
                <div class="ci-card-head">
                    <span><i class="fas fa-receipt"></i>Booking Summary</span>
                    <span class="ci-pill ci-pill-amber" id="cis-pill">\u2014</span>
                </div>
                <div class="ci-card-body">
                    <div class="ci-row"><span>Guest</span><strong id="cis-guest">\u2014</strong></div>
                    <div class="ci-row"><span>Room</span><strong id="cis-room">\u2014</strong></div>
                    <div class="ci-row"><span>Check-in</span><strong id="cis-in">\u2014</strong></div>
                    <div class="ci-row"><span>Check-out</span><strong id="cis-out">\u2014</strong></div>
                    <div class="ci-row"><span>Nights</span><strong id="cis-nights">\u2014</strong></div>
                    <div class="ci-row"><span>Rate / night</span><strong id="cis-rate">\u2014</strong></div>
                    <div class="ci-total"><span>Room total</span><strong id="cis-total">\u2014</strong></div>
                    <div class="ci-note" id="cis-note"></div>
                </div>
            </div>

            <div class="ci-card">
                <div class="ci-card-head">
                    <span><i class="fas fa-route"></i>Check-In Steps</span>
                    <span class="ci-count" id="cic-count">Step 1 of ${STEPS.length}</span>
                </div>
                <div class="ci-card-body">
                    ${stepsHTML}
                    <div class="ci-steps-note">
                        <i class="fas fa-info-circle"></i>
                        <span>Not ready to verify? Choose \u201CLater\u201D in the popup \u2014 the booking stays
                        Pending Verification until you verify it on the Verification page.</span>
                    </div>
                </div>
            </div>`;
        card.parentNode.insertBefore(aside, card.nextSibling);
        content.classList.add('ci-has-panel');

        // ── Steps (1-3 follow the form; 4-6 are a fixed guide for the popup) ──
        var stepEls = aside.querySelectorAll('.ci-step');
        var stepPill = $('cic-count');

        function updateSteps(guestDone, roomDone) {
            var flags = [guestDone, roomDone, false];   // step 3 is only done by clicking the button
            var cur = flags.indexOf(false);
            for (var i = 0; i < LIVE_STEPS; i++) {
                stepEls[i].classList.toggle('done', flags[i]);
                stepEls[i].classList.toggle('current', i === cur);
            }
            stepPill.textContent = 'Step ' + (cur + 1) + ' of ' + STEPS.length;
        }

        // ── Booking summary ──
        var pill = $('cis-pill'), note = $('cis-note');

        function updateSummary() {
            var name = val('guest-name').trim();

            var room = null, roomLabel = '\u2014';
            var sel = $('room-select');
            try {
                if (sel && sel.value) {
                    room = JSON.parse(sel.value);
                    roomLabel = sel.options[sel.selectedIndex].text;
                }
            } catch (e) { room = null; }

            var ci = parseDT(val('checkin-date'));
            var co = parseDT(val('checkout-date'));
            var nights = null, err = '', warn = '';

            if (ci && co) {
                if (co <= ci) {
                    err = 'Check-out must be after check-in.';
                } else {
                    nights = Math.round((noon(co) - noon(ci)) / 86400000);
                    if (nights < 1) {
                        warn = 'Same-day stay \u2014 this is recorded as 0 nights, so the room total will be ' + money(0) + '.';
                    }
                }
            }

            var price = room && Number(room.price) ? Number(room.price) : 0;

            $('cis-guest').textContent  = name || '\u2014';
            $('cis-room').textContent   = roomLabel;
            $('cis-in').textContent     = ci ? fmtDT(ci) : '\u2014';
            $('cis-out').textContent    = co ? fmtDT(co) : '\u2014';
            $('cis-nights').textContent = nights !== null ? nights : '\u2014';
            $('cis-rate').textContent   = room ? (price ? money(price) : 'Not set') : '\u2014';
            $('cis-total').textContent  = (room && nights !== null) ? money(price * nights) : '\u2014';

            // Status pill
            var missing = REQUIRED.filter(function (id) { return !val(id).trim(); }).length;
            var cls, text;
            if (err)          { cls = 'ci-pill-red';   text = 'Check dates'; }
            else if (missing) { cls = 'ci-pill-amber'; text = missing + ' required left'; }
            else              { cls = 'ci-pill-green'; text = 'Ready to check in'; }
            pill.className = 'ci-pill ' + cls;
            pill.textContent = text;

            // Notes
            note.className = 'ci-note' + (err ? ' err' : warn ? ' warn' : '');
            note.textContent = err || warn;

            // Steps
            var guestDone = ['guest-name', 'guest-phone', 'guest-email', 'guest-count', 'notes']
                .every(function (id) { return val(id).trim() !== ''; });
            var roomDone = !!room && !!ci && !!co && !err;
            updateSteps(guestDone, roomDone);
        }

        // ── Events ──
        form.addEventListener('input',  updateSummary);
        form.addEventListener('change', updateSummary);
        // After a reset (Clear button or successful check-in) checkin.js re-sets the default
        // dates in the same tick, so refresh on the next tick.
        form.addEventListener('reset', function () {
            setTimeout(updateSummary, 0);
        });

        updateSummary();
    }

    // Runs after checkin.js's DOMContentLoaded handler, so the default dates are already set
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();