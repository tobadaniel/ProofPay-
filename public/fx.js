/*
 * ProofPay FX layer — sound, motion and stage lighting for the demo.
 *
 * Presentation only. This file never touches the app's logic: it observes
 * the DOM the app renders (verify report, ledger) and the state the app
 * already persists in localStorage ('proofpay-state-v1'), and reacts to
 * transitions — funded, verified, released — with animation and sound.
 *
 * Sound: tiny WebAudio oscillator engine, no audio files, nothing
 * copyrighted. Browsers require a user gesture before audio, so the
 * context is created/resumed on the first pointer/key interaction.
 * Mute is persisted in localStorage ('proofpay-fx-muted').
 *
 * Respects prefers-reduced-motion: heavy animation is skipped and
 * numbers jump straight to their final values.
 */
(function () {
  'use strict';

  var LS_KEY = 'proofpay-state-v1';
  var MUTE_KEY = 'proofpay-fx-muted';
  var REDUCED = false;
  try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function money(n) { return '$' + Number(n || 0).toFixed(2); }

  /* ============================ SOUND ============================ */

  var Sound = (function () {
    var ctx = null;
    var muted = true;

    function ac() {
      if (muted) return null;
      try {
        if (!ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ctx = new AC();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch (e) { return null; }
    }

    function tone(freq, delay, dur, type, vol, slideTo) {
      var c = ac(); if (!c) return;
      try {
        var t0 = c.currentTime + (delay || 0);
        var osc = c.createOscillator();
        var g = c.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol || 0.05, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(c.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.05);
      } catch (e) {}
    }

    /* Warm up the context on the first genuine user gesture. */
    function unlock() { ac(); }
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);

    return {
      get muted() { return muted; },
      toggle: function () {
        muted = !muted;
        try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
        if (!muted) this.click();
        return muted;
      },
      click:   function () { tone(700, 0, 0.05, 'sine', 0.03); },
      tick:    function () { tone(1250, 0, 0.03, 'square', 0.016); },
      fund:    function () { tone(392, 0, 0.14, 'sine', 0.055); tone(587.33, 0.09, 0.16, 'sine', 0.055); tone(783.99, 0.2, 0.22, 'sine', 0.05); },
      pass:    function () { var n = [523.25, 659.25, 783.99, 1046.5]; for (var i = 0; i < n.length; i++) tone(n[i], i * 0.09, 0.2, 'sine', 0.055); },
      revise:  function () { tone(196, 0, 0.26, 'sawtooth', 0.045); tone(146.83, 0.16, 0.34, 'sawtooth', 0.045); },
      sparkle: function () { var n = [1318.5, 1567.98, 2093, 1760, 2349.3]; for (var i = 0; i < n.length; i++) tone(n[i], i * 0.055, 0.16, 'triangle', 0.045); }
    };
  })();

  /* ============================ CONFETTI ============================ */

  function confetti() {
    return; /* retired: mature theme, no confetti */
    if (REDUCED) return;
    var canvas = $('fx-confetti');
    if (!canvas) return;
    var c = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    var colours = ['#37c6ff', '#009cde', '#2fbf71', '#ffc439', '#ffffff', '#7fe3ff'];
    var parts = [];
    var cx = window.innerWidth / 2, cy = window.innerHeight * 0.32;
    for (var i = 0; i < 130; i++) {
      var a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 8;
      parts.push({
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3.5,
        w: 5 + Math.random() * 6, h: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        colour: colours[i % colours.length], life: 1
      });
    }
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var t = (ts - start) / 1000;
      c.clearRect(0, 0, canvas.width, canvas.height);
      var alive = false;
      parts.forEach(function (p) {
        if (p.life <= 0) return;
        alive = true;
        p.vy += 0.16; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr;
        p.life = Math.max(0, 1 - t / 1.5);
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
        c.globalAlpha = p.life; c.fillStyle = p.colour;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore();
      });
      if (alive && t < 1.7) requestAnimationFrame(frame);
      else c.clearRect(0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(frame);
  }

  /* ============================ COUNT-UP ============================ */

  function countUp(el, from, to, isMoney, dur) {
    if (!el) return;
    if (REDUCED || !window.requestAnimationFrame) {
      el.textContent = isMoney ? money(to) : String(Math.round(to));
      return;
    }
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / (dur || 750));
      var eased = 1 - Math.pow(1 - p, 3);
      var v = from + (to - from) * eased;
      el.textContent = isMoney ? money(v) : String(Math.round(v));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ============================ STATE ============================ */

  function readState() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && Array.isArray(s.milestones)) return s;
    } catch (e) {}
    return null;
  }
  function verSig(m) {
    if (!m || !m.verification) return '';
    var v = m.verification;
    return [v.score, v.verdict, v.passed, v.total, (v.results || []).length].join(':');
  }
  function snapshot(s) {
    if (!s) return { statuses: '', vers: '', ledger: 0, held: 0, released: 0 };
    var held = 0, released = 0;
    s.milestones.forEach(function (m) {
      if (m.status === 'FUNDED') held += Number(m.amount) || 0;
      if (m.status === 'RELEASED') released += Number(m.amount) || 0;
    });
    return {
      statuses: s.milestones.map(function (m) { return m.status; }).join(','),
      vers: s.milestones.map(verSig).join(','),
      ledger: (s.ledger || []).length,
      held: held, released: released
    };
  }

  /* ============================ HERO + STEPPER ============================ */

  var shownHeld = 0, shownReleased = 0, stageInitDone = false;

  function updateStage(s) {
    if (!s) return;
    var m = s.milestones[s.active] || null;
    var anyFunded = s.milestones.some(function (x) { return x.status === 'FUNDED' || x.status === 'RELEASED'; });
    var anyReleased = s.milestones.some(function (x) { return x.status === 'RELEASED'; });
    var verdict = m && m.verification ? m.verification.verdict : null;

    var client = $('fx-node-client'), vault = $('fx-node-vault'), gate = $('fx-node-gate'), free = $('fx-node-free');
    if (client) client.classList.toggle('lit', s.milestones.length > 0);
    if (vault) vault.classList.toggle('lit', anyFunded);
    if (gate) {
      gate.classList.toggle('lit', verdict === 'release');
      gate.classList.toggle('blocked', verdict === 'revise');
      var gateSub = $('fx-gate-sub');
      if (gateSub) gateSub.textContent = verdict === 'release' ? 'verdict: RELEASE — gate open'
        : verdict === 'revise' ? 'verdict: REVISE — gate shut' : 'judges the deliverable';
    }
    if (free) free.classList.toggle('lit', anyReleased);

    /* amounts: count-up only on change after initial paint */
    var snap = snapshot(s);
    var heldEl = $('fx-held-amount'), relEl = $('fx-released-amount');
    if (heldEl) {
      if (stageInitDone && snap.held !== shownHeld) countUp(heldEl, shownHeld, snap.held, true, 800);
      else if (!stageInitDone) heldEl.textContent = money(snap.held);
    }
    if (relEl) {
      if (stageInitDone && snap.released !== shownReleased) countUp(relEl, shownReleased, snap.released, true, 800);
      else if (!stageInitDone) relEl.textContent = money(snap.released);
    }
    shownHeld = snap.held; shownReleased = snap.released;

    /* stepper */
    var done = [
      s.milestones.length > 0,
      !!m && (m.status === 'FUNDED' || m.status === 'RELEASED'),
      !!m && (!!m.verification || !!(m.deliverableText || m.deliverableLink)),
      !!m && !!m.verification,
      !!m && m.status === 'RELEASED'
    ];
    var current = done.indexOf(false) + 1; /* 1..5, or 0 when all done */
    var items = document.querySelectorAll('#fx-stepper li');
    Array.prototype.forEach.call(items, function (li, i) {
      li.classList.toggle('done', done[i]);
      li.classList.toggle('current', current === i + 1);
      var dot = li.querySelector('.fx-step-dot');
      if (dot) dot.textContent = done[i] ? '✓' : String(i + 1);
    });
    stageInitDone = true;
  }

  function pulseNode(id) {
    var n = $(id); if (!n || REDUCED) return;
    n.classList.remove('pulse'); void n.offsetWidth; n.classList.add('pulse');
  }

  /* ============================ VERIFY REPORT FX ============================ */

  var lastAnimatedSig = null;

  function animateVerifyReport() {
    var report = $('verify-report');
    if (!report || report.classList.contains('hidden') || !report.innerHTML) return;
    var s = readState(); if (!s) return;
    var m = s.milestones[s.active]; if (!m || !m.verification) return;
    var sig = verSig(m);
    if (sig === lastAnimatedSig) return;
    lastAnimatedSig = sig;

    var v = m.verification;
    var banner = report.querySelector('.banner');
    var rows = report.querySelectorAll('table.verify tbody tr');
    var scoreNum = report.querySelector('.score-num');
    var barFill = report.querySelector('.bar > div');

    if (REDUCED) { verdictFinish(v, banner, report); return; }

    /* score: count up while the bar sweeps */
    if (barFill) {
      var target = barFill.style.width;
      barFill.style.width = '0%';
      void barFill.offsetWidth;
      setTimeout(function () { barFill.style.width = target; }, 60);
    }
    if (scoreNum && scoreNum.childNodes[0]) {
      var node = scoreNum.childNodes[0];
      var from = 0, to = v.score, start = null;
      (function step(ts) {
        if (!start) start = ts;
        var p = Math.min(1, (ts - start) / 900);
        node.nodeValue = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step); else node.nodeValue = String(to);
      })(performance.now());
    }

    /* criteria rows: scanning reveal, one by one, verdict stamps pop */
    report.classList.remove('fx-scanning'); void report.offsetWidth; report.classList.add('fx-scanning');
    Array.prototype.forEach.call(rows, function (row, i) {
      row.classList.add('fx-row-hidden');
      setTimeout(function () {
        row.classList.remove('fx-row-hidden');
        row.classList.add('fx-row-in');
        var cell = row.querySelector('.verdict-pass, .verdict-fail');
        if (cell) { cell.classList.remove('fx-stamp'); void cell.offsetWidth; cell.classList.add('fx-stamp'); }
        if (i < 9) Sound.tick();
      }, 130 + i * 170);
    });

    var totalDelay = 130 + rows.length * 170 + 120;
    setTimeout(function () { report.classList.remove('fx-scanning'); verdictFinish(v, banner, report); }, totalDelay);
  }

  function verdictFinish(v, banner, report) {
    if (!banner) banner = report ? report.querySelector('.banner') : null;
    if (v.verdict === 'release') {
      if (banner) { banner.classList.remove('fx-banner-pop'); void banner.offsetWidth; banner.classList.add('fx-banner-pop'); }
      Sound.pass();
    } else {
      if (banner && !REDUCED) { banner.classList.remove('fx-shake'); void banner.offsetWidth; banner.classList.add('fx-shake'); }
      if (report) Array.prototype.forEach.call(report.querySelectorAll('ul.missing li'), function (li) { li.classList.add('fx-gap'); });
      Sound.revise();
    }
  }

  var verifyObserver = null;
  function watchVerify() {
    var report = $('verify-report');
    if (!report || !window.MutationObserver) return;
    verifyObserver = new MutationObserver(function () { animateVerifyReport(); });
    verifyObserver.observe(report, { childList: true });
  }

  /* ============================ LEDGER FX ============================ */

  function flashLedger() {
    var grid = $('ledger-grid');
    var card = grid ? grid.closest('.card') : null;
    if (card) { card.classList.remove('fx-ledger-flash'); void card.offsetWidth; card.classList.add('fx-ledger-flash'); }
    /* highlight the newest row (ledger renders newest first) in whichever
       renderer is active — retry briefly because AG Grid paints async */
    var tries = 0;
    (function attempt() {
      var row = document.querySelector('#ledger-fallback table.ledger tbody tr') ||
                document.querySelector('#ledger-grid .ag-row');
      if (row) { row.classList.add('fx-row-new'); return; }
      if (++tries < 6) setTimeout(attempt, 150);
    })();
  }

  function stampReleasedPill() {
    var cards = document.querySelectorAll('.milestone-card .pill.released');
    Array.prototype.forEach.call(cards, function (pill) {
      pill.classList.remove('fx-stamped'); void pill.offsetWidth; pill.classList.add('fx-stamped');
    });
  }

  /* ============================ TRANSITION WATCHER ============================ */

  var prev = null;

  function tick() {
    var s = readState();
    updateStage(s);
    if (!s) { prev = snapshot(s); return; }
    var cur = snapshot(s);
    if (prev && stageInitDone) {
      var prevStatuses = prev.statuses ? prev.statuses.split(',') : [];
      var curStatuses = cur.statuses ? cur.statuses.split(',') : [];
      for (var i = 0; i < curStatuses.length; i++) {
        if (prevStatuses[i] !== curStatuses[i] && curStatuses[i] === 'FUNDED') {
          pulseNode('fx-node-vault');
          Sound.fund();
        }
        if (prevStatuses[i] !== curStatuses[i] && curStatuses[i] === 'RELEASED') {
          confetti();
          Sound.sparkle();
          setTimeout(stampReleasedPill, 60);
        }
      }
      if (cur.ledger > prev.ledger) setTimeout(flashLedger, 80);
    }
    prev = cur;
  }

  /* ============================ WIRING ============================ */

  function init() {
    /* mute toggle */
    var btn = $('fx-mute');
    function paintMute() { if (btn) btn.textContent = Sound.muted ? '🔇 Sound off' : '🔊 Sound on'; }
    if (btn) btn.addEventListener('click', function () { Sound.toggle(); paintMute(); });
    paintMute();

    /* soft click on the app's buttons */
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.btn, a.linklike, .milestone-card') : null;
      if (t && t.id !== 'fx-mute') Sound.click();
    });

    watchVerify();
    tick();
    setTimeout(animateVerifyReport, 450); /* replay a persisted report on load */
    setInterval(tick, 350);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
