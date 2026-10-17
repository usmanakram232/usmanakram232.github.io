(function () {
  'use strict';
  var KEY = 'familyMealPlanner.v1';
  var DATA, S, R = {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var AISLES = ['P', 'M', 'D', 'G', 'L', 'O', 'F', 'S'];

  function h(tag, attrs) {
    var el = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i]; if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }
  function longDate(d) { return DOWL[d.getDay()] + ' ' + d.getDate() + ' ' + d.toLocaleString('en-GB', { month: 'long' }); }
  function shortDate(d) { return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + d.toLocaleString('en-GB', { month: 'short' }); }

  /* ---------- state ---------- */
  function lastCookDay() {
    var t = new Date(), mon = addDays(new Date(t.getFullYear(), t.getMonth(), t.getDate()), -((t.getDay() + 6) % 7));
    return ymd(addDays(mon, -1)); // the Sunday before this week, so the whole current week is covered
  }
  function defaults() {
    return { settings: { adults: 2, toddlers: 1, cookDays: [0, 2, 4], daycareDays: [1, 2, 3, 4, 5], avoid: [], start: lastCookDay() },
      overrides: {}, checks: {}, tab: 'today', date: ymd(new Date()), shop: 'week', swap: null, recipeCat: 'all', recipeQ: '' };
  }
  function load() {
    var s = defaults();
    try { var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw) { Object.keys(raw).forEach(function (k) { s[k] = raw[k]; }); s.settings = Object.assign(defaults().settings, raw.settings || {}); } } catch (e) {}
    s.date = ymd(new Date()); s.swap = null;
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save: browser storage is blocked'); } }
  var tt;
  function toast(m) { var t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(function () { t.hidden = true; }, 2600); }

  /* ---------- helpers ---------- */
  function famPortions() { return S.settings.adults + 0.5 * S.settings.toddlers; }
  function avoided(r) {
    var terms = S.settings.avoid.map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    if (!terms.length) return null;
    for (var t = 0; t < terms.length; t++) {
      if (r.name.toLowerCase().indexOf(terms[t]) >= 0) return terms[t];
      for (var i = 0; i < r.ing.length; i++) if (r.ing[i].i.toLowerCase().indexOf(terms[t]) >= 0) return terms[t];
    }
    return null;
  }
  function frac(n) {
    var w = Math.floor(n + 1e-9), f = Math.round((n - w) * 4) / 4, s = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾', 1: '' }[f];
    if (f === 1) { w += 1; s = ''; }
    return (w ? w : '') + s || '¼';
  }
  function fmt(q, u) {
    if (u === 'g' || u === 'ml') { var v = q < 30 ? Math.round(q) : q < 200 ? Math.round(q / 5) * 5 : Math.round(q / 10) * 10; return (v || 5) + ' ' + u; }
    if (u === 'tbsp' || u === 'tsp') return frac(Math.max(0.25, Math.round(q * 4) / 4)) + ' ' + u;
    var r = Math.max(0.5, Math.round(q * 2) / 2);
    return frac(r) + (u === 'pc' ? '' : ' ' + u);
  }
  function fmtUp(q, u) {
    if (u === 'g' || u === 'ml') { var v = q < 500 ? Math.ceil(q / 25) * 25 : Math.ceil(q / 50) * 50; return v + ' ' + u; }
    if (u === 'tbsp' || u === 'tsp') return frac(Math.ceil(q * 4) / 4) + ' ' + u;
    return Math.ceil(q - 1e-9) + (u === 'pc' ? '' : ' ' + u);
  }

  /* ---------- plan simulation ---------- */
  function simulate(n) {
    var st = S.settings, P = DATA.plan, start = parse(st.start), days = [];
    var q = { doubles: 0, easy: 0, lunch: 0, bwd: 0, bwe: 0, snack: 0, frozen: 0, mid: 0, wk: 0 };
    var last = null, covered = false;
    function next(list, key) {
      for (var t = 0; t < list.length; t++) { var id = list[q[key] % list.length]; q[key]++; if (!avoided(R[id])) return id; }
      return null;
    }
    function ov(date, slot, base) { var o = S.overrides[date + '|' + slot]; return o && R[o] ? o : base; }
    for (var i = 0; i <= n; i++) {
      var dt = addDays(start, i), date = ymd(dt), dow = dt.getDay(), d = { date: date, dow: dow, i: i };
      var cook = st.cookDays.indexOf(dow) >= 0, base = null;
      if (cook) { base = next(P.doubles, 'doubles'); d.kind = base ? 'cook' : 'easy'; if (!base) base = next(P.easy, 'easy'); }
      else if (covered && last) { d.kind = 'leftover'; }
      else { d.kind = 'easy'; base = next(P.easy, 'easy'); }
      if (d.kind === 'leftover') d.dinner = last;
      else { d.dinner = ov(date, 'dinner', base); last = d.dinner; }
      covered = d.kind === 'cook';
      if (d.kind === 'leftover') { d.lunch = d.dinner; d.lunchLeft = true; }
      else d.lunch = ov(date, 'lunch', next(P.lunch, 'lunch'));
      var weekend = dow === 0 || dow === 6;
      d.breakfast = ov(date, 'breakfast', weekend ? next(P.breakfastWeekend, 'bwe') : next(P.breakfastWeekday, 'bwd'));
      d.snack = ov(date, 'snack', next(P.snack, 'snack'));
      var tr = null;
      if (dow === 6) tr = next(P.frozen, 'frozen'); else if (dow === 3) tr = next(P.midweekDrink, 'mid'); else if (dow === 0) tr = next(P.weekendDrink, 'wk');
      d.treat = tr ? ov(date, 'treat', tr) : null;
      days.push(d);
    }
    days.forEach(function (d, i) { d.leftoverNext = d.kind === 'cook' && days[i + 1] && days[i + 1].kind === 'leftover'; });
    return days;
  }
  var cache = null;
  function planFor(date) {
    var n = Math.round((parse(date) - parse(S.settings.start)) / 86400000);
    if (n < 0) return null;
    var key = JSON.stringify([S.settings, S.overrides]);
    if (!cache || cache.key !== key || cache.n < n + 14) cache = { key: key, n: n + 60, days: simulate(n + 60) };
    return cache.days[n];
  }
  function portionsFor(d, slot) {
    var a = S.settings.adults, t = S.settings.toddlers, fam = famPortions();
    var daycare = S.settings.daycareDays.indexOf(d.dow) >= 0 && t > 0;
    if (slot === 'breakfast') return fam;
    if (slot === 'snack') return Math.max(t, 0);
    if (slot === 'treat') return fam;
    if (slot === 'lunch') return d.lunchLeft ? 0 : (daycare ? a : fam);
    if (slot === 'dinner') {
      if (d.kind === 'leftover') return 0;
      if (d.kind === 'cook') return d.leftoverNext ? 2 * fam + a : fam;
      return fam;
    }
    return fam;
  }

  /* ---------- illustrations ---------- */
  var ICONS = {
    pot: '<path d="M7 20h34v14a9 9 0 01-9 9H16a9 9 0 01-9-9z"/><path d="M4 20h40M17 14c0-3 4-3 4-6M27 14c0-3 4-3 4-6"/>',
    bowl: '<path d="M6 22h36a18 14 0 01-36 0z"/><path d="M16 12c0-3 4-3 4-6M28 12c0-3 4-3 4-6"/>',
    cup: '<path d="M10 14h24v14a12 12 0 01-24 0z"/><path d="M34 18h4a5 5 0 010 10h-4M16 8c0-3 4-3 4-6M25 8c0-3 4-3 4-6"/>',
    bread: '<path d="M8 24a10 10 0 0110-10h12a10 10 0 0110 10v14H8z"/><path d="M18 26v6M24 26v6M30 26v6"/>',
    egg: '<path d="M24 6c8 0 13 11 13 20a13 13 0 01-26 0c0-9 5-20 13-20z"/><circle cx="24" cy="28" r="6"/>',
    fish: '<path d="M6 24c8-12 22-12 30 0-8 12-22 12-30 0z"/><path d="M36 24l7-8v16z"/><circle cx="16" cy="22" r="1.5"/>',
    ice: '<path d="M14 24l10 18 10-18z"/><path d="M13 24a6 6 0 016-8 7 7 0 0112-1 6 6 0 013 9z"/>',
    apple: '<path d="M24 14c-8-5-16 1-14 11 2 9 8 15 14 15s12-6 14-15c2-10-6-16-14-11z"/><path d="M24 14c0-4 2-7 6-8"/>',
    leaf: '<path d="M9 40C9 21 21 9 41 7c0 20-9 32-27 32z"/><path d="M9 40l20-20"/>',
    pan: '<circle cx="22" cy="24" r="14"/><path d="M36 24h10"/>'
  };
  var CAT_HUE = { main: 205, breakfast: 40, lunch: 160, snack: 340, treat: 280, drink: 22 };
  function iconFor(r) {
    var id = r.id;
    if (/fish|salmon/.test(id)) return 'fish';
    if (/kulfi|custard|gelato|cocoa/.test(id)) return 'ice';
    if (/lassi|latte/.test(id)) return 'cup';
    if (/egg|omelet|bhurji/.test(id)) return 'egg';
    if (/pulao|rice|oats|chia|parfait|yogurt|melon|cottage/.test(id)) return 'bowl';
    if (/waffle|pancake|wrap|quesadilla|puri|paratha|roll|crackers|pasta|mac|hummus/.test(id)) return 'bread';
    if (/bhindi|aloo|karela|peppers/.test(id)) return 'leaf';
    if (r.cat === 'snack') return 'apple';
    if (/fajita|teriyaki|kabab/.test(id)) return 'pan';
    return 'pot';
  }
  function icon(r, size) {
    var el = h('span', { class: 'ico', 'aria-hidden': 'true', style: '--h:' + (CAT_HUE[r.cat] || 210) + ';width:' + size + 'px;height:' + size + 'px' });
    el.innerHTML = '<svg viewBox="0 0 48 48" width="' + Math.round(size * .66) + '" height="' + Math.round(size * .66) + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + ICONS[iconFor(r)] + '</svg>';
    return el;
  }

  /* ---------- recipe detail ---------- */
  function recipeDetail(r, portions) {
    var f = portions / r.yield;
    var av = avoided(r);
    var ing = r.ing.map(function (i) { return h('li', null, h('b', { text: fmt(i.q * f, i.u) + ' ' }), i.i); });
    return h('div', null,
      av ? h('div', { class: 'safety' }, h('b', { text: 'Contains: ' }), av + ', which you have set to avoid.') : null,
      h('p', { class: 'kv' }, h('b', { text: 'For ' }), (Math.round(portions * 10) / 10) + ' portions (the recipe makes ' + r.yield + ').'),
      h('p', { class: 'kv' }, h('b', { text: 'Ingredients' })), h('ul', { style: 'padding-left:1.1rem' }, ing),
      h('p', { class: 'kv', style: 'margin-top:.5rem' }, h('b', { text: 'Method' })), h('ol', null, r.steps.map(function (s) { return h('li', { text: s }); })),
      h('p', { class: 'kv' }, h('b', { text: 'For the toddler: ' }), r.kid),
      r.lite ? h('p', { class: 'kv' }, h('b', { text: 'Lighter plate: ' }), r.lite) : null,
      r.store ? h('p', { class: 'kv' }, h('b', { text: 'Storage: ' }), r.store) : null,
      r.alg.length ? h('p', { class: 'kv' }, h('b', { text: 'Contains: ' }), r.alg.join(', ')) : null,
      r.note ? h('p', { class: 'note', text: r.note }) : null);
  }
  function metaTags(r) {
    return h('div', { class: 'meta' }, h('span', { class: 'tag', text: r.active + ' min active' }), h('span', { class: 'tag', text: r.total + ' min total' }),
      r.app.map(function (a) { return h('span', { class: 'tag acc', text: a }); }), r.tags.map(function (t) { return h('span', { class: 'tag', text: t }); }));
  }

  /* ---------- today ---------- */
  var SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Afternoon snack 2:45', dinner: 'Dinner', treat: 'Treat or drink' };
  function swapOptions(d, slot) {
    var P = DATA.plan, list;
    if (slot === 'dinner') list = d.kind === 'cook' ? P.doubles : P.easy;
    else if (slot === 'lunch') list = P.lunch;
    else if (slot === 'breakfast') list = (d.dow === 0 || d.dow === 6) ? P.breakfastWeekend : P.breakfastWeekday;
    else if (slot === 'snack') list = P.snack;
    else list = d.dow === 6 ? P.frozen : d.dow === 3 ? P.midweekDrink : P.weekendDrink;
    var seen = {}; return list.filter(function (id) { if (seen[id]) return false; seen[id] = 1; return true; });
  }
  function slotCard(d, slot) {
    var id = d[slot]; if (!id) return null;
    var r = R[id], key = d.date + '|' + slot, portions = portionsFor(d, slot);
    var leftover = (slot === 'dinner' && d.kind === 'leftover') || (slot === 'lunch' && d.lunchLeft);
    var daycare = S.settings.daycareDays.indexOf(d.dow) >= 0 && S.settings.toddlers > 0;
    var canSwap = !leftover;
    var overridden = !!S.overrides[key];
    var open = S.swap === key;
    var status = null;
    if (slot === 'dinner') status = d.kind === 'cook' ? 'Batch-cook night' : d.kind === 'leftover' ? 'Reheat night' : 'Easy night';
    if (slot === 'lunch') status = d.lunchLeft ? 'Leftovers' : daycare ? 'Adults (toddler eats at childcare)' : 'Family';
    var card = h('article', { class: 'card' },
      h('div', { class: 'slot' }, h('div', { class: 'card-head' }, icon(r, 52), h('div', null, h('span', { class: 'slot-label', text: SLOT_LABEL[slot] }), h('h3', { text: r.name }))),
        canSwap ? h('button', { class: 'btn ghost sm noprint', type: 'button', text: open ? 'Close' : 'Swap', 'aria-expanded': String(open), onclick: function () { S.swap = open ? null : key; renderToday(); } }) : null),
      status ? h('div', { class: 'meta' }, h('span', { class: 'tag acc', text: status }), overridden ? h('span', { class: 'tag', text: 'swapped' }) : null) : null,
      metaTags(r));
    if (open) {
      card.appendChild(h('div', { class: 'group noprint' }, h('span', { class: 'label', text: 'Swap for' }), h('div', { class: 'row' },
        swapOptions(d, slot).filter(function (x) { return x !== id; }).map(function (x) {
          return h('button', { class: 'chip', type: 'button', text: R[x].name + (avoided(R[x]) ? ' (avoided)' : ''), disabled: !!avoided(R[x]), onclick: function () { S.overrides[key] = x; S.swap = null; save(); renderAll(); } });
        }),
        overridden ? h('button', { class: 'chip', type: 'button', text: 'Back to plan', onclick: function () { delete S.overrides[key]; S.swap = null; save(); renderAll(); } }) : null)));
    }
    card.appendChild(h('details', null, h('summary', { text: 'Recipe' }), recipeDetail(r, leftover ? famPortions() : portions)));
    return card;
  }
  function renderToday() {
    var el = clear($('#p-today')), date = S.date, dt = parse(date), d = planFor(date);
    el.appendChild(h('div', { class: 'row noprint', style: 'justify-content:space-between;margin-bottom:.8rem' },
      h('button', { class: 'btn ghost sm', type: 'button', text: 'Previous day', onclick: function () { S.date = ymd(addDays(dt, -1)); renderToday(); } }),
      h('button', { class: 'btn ghost sm', type: 'button', text: 'Today', onclick: function () { S.date = ymd(new Date()); renderToday(); } }),
      h('button', { class: 'btn ghost sm', type: 'button', text: 'Next day', onclick: function () { S.date = ymd(addDays(dt, 1)); renderToday(); } })));
    el.appendChild(h('h2', { text: longDate(dt) }));
    if (!d) { el.appendChild(h('div', { class: 'card' }, h('p', { text: 'This is before the plan starts on ' + shortDate(parse(S.settings.start)) + '. Change the start in Setup.' }))); return; }
    var d1 = planFor(ymd(addDays(dt, 1))), dinner = R[d.dinner];
    if (d.kind === 'cook') el.appendChild(h('div', { class: 'banner' }, h('b', { text: 'Batch-cook night. ' }),
      'Cook ' + dinner.name.toLowerCase() + ' once' + (d.leftoverNext ? ': it covers tonight, tomorrow\'s dinner and a packed lunch tomorrow.' : '.') + ' About ' + dinner.active + ' minutes of active cooking.'));
    if (d1 && d1.kind === 'cook' && R[d1.dinner].overnight) el.appendChild(h('div', { class: 'banner' }, h('b', { text: 'Tonight: ' }), 'soak the dried beans or chickpeas for tomorrow\'s ' + R[d1.dinner].name.toLowerCase() + '.'));
    if (d.kind === 'leftover') el.appendChild(h('div', { class: 'banner' }, h('b', { text: 'Reheat night. ' }), 'No cooking: warm up last night\'s dish (rice only once).'));
    ['breakfast', 'lunch', 'snack', 'dinner', 'treat'].forEach(function (slot) {
      if (slot === 'snack' && S.settings.toddlers < 1) return;
      var c = slotCard(d, slot); if (c) el.appendChild(c);
    });
    var daycare = S.settings.daycareDays.indexOf(d.dow) >= 0 && S.settings.toddlers > 0;
    if (daycare) el.appendChild(h('p', { class: 'note', text: 'Toddler lunch is at childcare today, so no toddler lunch is planned.' }));
  }

  /* ---------- week ---------- */
  function renderWeek() {
    var el = clear($('#p-week')), dt = parse(S.date), mon = addDays(dt, -((dt.getDay() + 6) % 7));
    el.appendChild(h('div', { class: 'row noprint', style: 'justify-content:space-between;margin-bottom:.8rem' },
      h('button', { class: 'btn ghost sm', type: 'button', text: 'Previous week', onclick: function () { S.date = ymd(addDays(mon, -7)); renderWeek(); } }),
      h('button', { class: 'btn ghost sm', type: 'button', text: 'This week', onclick: function () { S.date = ymd(new Date()); renderWeek(); } }),
      h('button', { class: 'btn ghost sm', type: 'button', text: 'Next week', onclick: function () { S.date = ymd(addDays(mon, 7)); renderWeek(); } }),
      h('button', { class: 'btn sm', type: 'button', text: 'Print', onclick: function () { window.print(); } })));
    el.appendChild(h('h2', { text: 'Week of ' + shortDate(mon) }));
    el.appendChild(h('p', { class: 'sub', text: 'Marked days are batch-cook nights. Tap a day to open it.' }));
    var tb = h('tbody');
    for (var i = 0; i < 7; i++) {
      (function (day) {
        var date = ymd(day), d = planFor(date);
        if (!d) { tb.appendChild(h('tr', null, h('th', { text: shortDate(day) }), h('td', { text: 'Before plan start', colspan: 4 }))); return; }
        var daycare = S.settings.daycareDays.indexOf(d.dow) >= 0 && S.settings.toddlers > 0;
        tb.appendChild(h('tr', { class: (d.kind === 'cook' ? 'cook ' : '') + (date === ymd(new Date()) ? 'today' : '') },
          h('th', null, h('button', { class: 'chip', type: 'button', text: shortDate(day), onclick: function () { S.date = date; setTab('today'); } })),
          h('td', { 'data-l': 'Breakfast', text: R[d.breakfast].name }),
          h('td', { 'data-l': 'Lunch', text: (d.lunchLeft ? 'Leftover: ' : '') + R[d.lunch].name + (daycare ? ' (adults)' : '') }),
          h('td', { 'data-l': 'Snack', text: R[d.snack].name + (d.treat ? ' + ' + R[d.treat].name : '') }),
          h('td', { 'data-l': 'Dinner', text: (d.kind === 'cook' ? 'COOK: ' : d.kind === 'leftover' ? 'Reheat: ' : '') + R[d.dinner].name })));
      })(addDays(mon, i));
    }
    el.appendChild(h('table', { class: 'daygrid' }, h('thead', null, h('tr', null, ['Day', 'Breakfast', 'Lunch', 'Snack', 'Dinner'].map(function (x) { return h('th', { text: x }); }))), tb));
  }

  /* ---------- shop ---------- */
  function shopRange() {
    var today = ymd(new Date()), t = parse(today), s0 = parse(S.settings.start);
    var a = t < s0 ? s0 : t, n = 7;
    if (S.shop === 'next') a = addDays(a, 7); else if (S.shop === '3') n = 3;
    return { a: a, b: addDays(a, n - 1) };
  }
  function shopList(range) {
    var map = {};
    function add(rid, portions, why) {
      if (portions <= 0) return;
      var r = R[rid], f = portions / r.yield;
      r.ing.forEach(function (i) {
        var k = i.i + '|' + i.u; var e = map[k] || (map[k] = { name: i.i, unit: i.u, a: i.a, q: 0, why: [] });
        e.q += i.q * f; if (e.why.indexOf(r.name) < 0) e.why.push(r.name);
      });
    }
    for (var dt = range.a; dt <= range.b; dt = addDays(dt, 1)) {
      var d = planFor(ymd(dt)); if (!d) continue;
      add(d.breakfast, portionsFor(d, 'breakfast'));
      if (!d.lunchLeft) add(d.lunch, portionsFor(d, 'lunch'));
      if (S.settings.toddlers > 0) add(d.snack, portionsFor(d, 'snack'));
      add(d.dinner, portionsFor(d, 'dinner'));
      if (d.treat) add(d.treat, portionsFor(d, 'treat'));
    }
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function renderShop() {
    var el = clear($('#p-shop')), range = shopRange(), rk = ymd(range.a) + '_' + S.shop;
    el.appendChild(h('h2', { text: 'Shopping list' }));
    el.appendChild(h('p', { class: 'sub', text: shortDate(range.a) + ' to ' + shortDate(range.b) + '. Scaled for ' + S.settings.adults + ' adults and ' + S.settings.toddlers + ' toddler(s); batch-cook nights buy for the extra dinner and lunch.' }));
    el.appendChild(h('div', { class: 'row noprint', style: 'margin:.8rem 0' }, [['week', 'Next 7 days'], ['next', 'The 7 days after'], ['3', 'Next 3 days']].map(function (o) {
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.shop === o[0]), text: o[1], onclick: function () { S.shop = o[0]; save(); renderShop(); } }); })));
    var items = shopList(range), checks = S.checks[rk] || {};
    var groups = {}; items.forEach(function (i) { (groups[i.a] = groups[i.a] || []).push(i); });
    var text = [];
    AISLES.forEach(function (a) {
      var list = groups[a]; if (!list) return;
      list.sort(function (x, y) { return x.name.localeCompare(y.name); });
      var card = h('div', { class: 'card' }, h('h3', { text: DATA.aisles[a] }));
      text.push(DATA.aisles[a].toUpperCase());
      list.forEach(function (i) {
        var k = i.name + '|' + i.unit, qty = fmtUp(i.q, i.unit), label = i.name + ': ' + qty;
        text.push('- ' + label);
        var cb = h('input', { type: 'checkbox', 'aria-label': label, onchange: function () { var c = S.checks[rk] || (S.checks[rk] = {}); c[k] = cb.checked; save(); renderShop(); } });
        cb.checked = !!checks[k];
        card.appendChild(h('label', { class: 'check' + (cb.checked ? ' done' : '') }, cb, h('span', null, h('b', { text: qty + ' ' }), i.name, h('span', { class: 'note', text: '  ' + i.why.slice(0, 2).join(', ') + (i.why.length > 2 ? '…' : '') }))));
      });
      el.appendChild(card);
    });
    if (!items.length) el.appendChild(h('div', { class: 'card' }, h('p', { text: 'Nothing to buy in this range.' })));
    el.appendChild(h('div', { class: 'row noprint' },
      h('button', { class: 'btn', type: 'button', text: 'Copy list', onclick: function () { navigator.clipboard && navigator.clipboard.writeText(text.join('\n')).then(function () { toast('Copied'); }, function () { toast('Could not copy'); }); } }),
      h('button', { class: 'btn ghost', type: 'button', text: 'Print', onclick: function () { window.print(); } }),
      h('button', { class: 'btn ghost', type: 'button', text: 'Clear ticks', onclick: function () { delete S.checks[rk]; save(); renderShop(); } })));
  }

  /* ---------- recipes ---------- */
  function renderRecipes() {
    var el = clear($('#p-recipes')), cats = [['all', 'All'], ['main', 'Dinners'], ['lunch', 'Lunches'], ['breakfast', 'Breakfasts'], ['snack', 'Snacks'], ['treat', 'Treats and drinks']];
    el.appendChild(h('h2', { text: 'Recipes (' + DATA.recipes.length + ')' }));
    var q;
    el.appendChild(h('div', { class: 'row', style: 'margin:.8rem 0' }, q = h('input', { type: 'text', value: S.recipeQ, placeholder: 'Search recipes or ingredients', 'aria-label': 'Search recipes', style: 'flex:1;min-width:12rem', oninput: function () { S.recipeQ = q.value; var pos = q.selectionStart; renderRecipes(); var n = $('#p-recipes input'); n.focus(); n.setSelectionRange(pos, pos); } })));
    el.appendChild(h('div', { class: 'group row' }, cats.map(function (c) { return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.recipeCat === c[0]), text: c[1], onclick: function () { S.recipeCat = c[0]; renderRecipes(); } }); })));
    var term = S.recipeQ.trim().toLowerCase();
    DATA.recipes.filter(function (r) {
      if (S.recipeCat !== 'all' && (S.recipeCat === 'treat' ? (r.cat !== 'treat' && r.cat !== 'drink') : r.cat !== S.recipeCat)) return false;
      if (!term) return true;
      return r.name.toLowerCase().indexOf(term) >= 0 || r.ing.some(function (i) { return i.i.toLowerCase().indexOf(term) >= 0; });
    }).forEach(function (r) {
      var av = avoided(r);
      el.appendChild(h('article', { class: 'card' }, h('div', { class: 'card-head' }, icon(r, 52), h('h3', { text: r.name })), metaTags(r),
        av ? h('div', { class: 'meta' }, h('span', { class: 'tag warn', text: 'contains ' + av })) : null,
        h('details', null, h('summary', { text: 'Recipe' }), recipeDetail(r, r.cat === 'snack' ? Math.max(1, S.settings.toddlers) : famPortions()))));
    });
  }

  /* ---------- guide ---------- */
  function renderGuide() {
    var el = clear($('#p-guide')), G = DATA.guide, Rf = DATA.refs;
    el.appendChild(h('h2', { text: 'Guide' }));
    function items(list) { return list.map(function (s) { return h('div', { class: s.general ? 'safety' : 'kv' }, h('b', { text: s.title + ': ' }), s.text, h('div', { class: 'note' + (s.general ? ' warn' : ''), text: s.src })); }); }
    function sec(t, body, open) { return h('details', { class: 'card', open: open }, h('summary', { text: t }), h('div', null, body)); }
    el.appendChild(sec('How the week works', items(G.rhythm), true));
    el.appendChild(sec('Toddler portions and milk', items(G.portions)));
    el.appendChild(sec('Safety and food handling', items(G.safety)));
    var kind = S.refKind || 'all';
    var body = [h('p', { class: 'note', text: 'Recipes are standard home-cooking methods written for this planner, not copied from these sources. The sources below back the toddler portions, safety rules, batch-cook approach and sugar guidance.' }),
      h('div', { class: 'group row' }, ['all'].concat(Object.keys(Rf.kinds)).map(function (k) { return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(kind === k), text: k === 'all' ? 'All' : Rf.kinds[k], onclick: function () { S.refKind = k; renderGuide(); } }); }))];
    Rf.items.filter(function (r) { return kind === 'all' || r.kind === kind; }).forEach(function (r) {
      body.push(h('article', { class: 'card' }, h('div', { class: 'meta' }, h('span', { class: 'tag acc', text: Rf.kinds[r.kind] }), r.year ? h('span', { class: 'tag', text: r.year }) : null),
        h('h3', { text: r.title }), h('p', { class: 'note', text: r.author }),
        h('p', { class: 'kv' }, h('b', { text: 'Covers: ' }), r.covers),
        r.findings ? h('p', { class: 'kv' }, h('b', { text: 'Key findings: ' }), r.findings) : null,
        r.note ? h('p', { class: 'kv' }, h('b', { text: 'Worth knowing: ' }), r.note) : null,
        h('p', { class: 'kv' }, h('b', { text: 'Used here for: ' }), r.used),
        r.url ? h('p', null, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.url.indexOf('doi.org') > 0 ? 'Open the paper' : 'Open the source' })) : h('p', { class: 'note', text: 'No direct link. Search the title.' })));
    });
    el.appendChild(sec('References (' + Rf.items.length + ')', body));
    el.appendChild(h('p', { class: 'note', text: 'This is a planning aid, not medical or dietary advice. For allergies, weight or health conditions, talk to your doctor or a registered dietitian.' }));
  }

  /* ---------- setup ---------- */
  function exportData() {
    var o = { app: 'meal-planner', version: 1, settings: S.settings, overrides: S.overrides, checks: S.checks };
    var u = URL.createObjectURL(new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' })), a = h('a', { href: u, download: 'meal-planner-' + ymd(new Date()) + '.json' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 500);
  }
  function importButton() {
    var file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': 'Import file', onchange: function () {
      var f = file.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { try { var d = JSON.parse(r.result); if (d.app !== 'meal-planner') throw 0;
        if (d.settings) S.settings = Object.assign(defaults().settings, d.settings); if (d.overrides) S.overrides = d.overrides; if (d.checks) S.checks = d.checks;
        save(); cache = null; toast('Imported'); renderAll(); } catch (e) { toast('That file is not a meal planner export'); } };
      r.readAsText(f); file.value = '';
    } });
    return h('span', null, h('button', { class: 'btn ghost sm', type: 'button', text: 'Import', onclick: function () { file.click(); } }), file);
  }
  function renderSetup() {
    var el = clear($('#p-setup')), st = S.settings, ad, td, av, startSel;
    el.appendChild(h('h2', { text: 'Setup' }));
    function toggles(label, arr, key) {
      return h('div', { class: 'group', role: 'group', 'aria-label': label }, h('span', { class: 'label', text: label }), h('div', { class: 'row' }, [1, 2, 3, 4, 5, 6, 0].map(function (n) {
        return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(arr.indexOf(n) >= 0), text: DOW[n], onclick: function () { var i = arr.indexOf(n); if (i >= 0) arr.splice(i, 1); else arr.push(n); save(); cache = null; renderSetup(); } });
      })));
    }
    el.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('label', { class: 'note' }, 'Adults ', ad = h('input', { type: 'number', min: 1, max: 8, value: st.adults, 'aria-label': 'Adults' })),
        h('label', { class: 'note' }, 'Toddlers ', td = h('input', { type: 'number', min: 0, max: 4, value: st.toddlers, 'aria-label': 'Toddlers' }))),
      toggles('Batch-cook nights (the next night is reheated)', st.cookDays),
      toggles('Toddler eats lunch at childcare', st.daycareDays),
      h('div', { class: 'group' }, h('span', { class: 'label', text: 'Ingredients to avoid (comma separated)' }), av = h('input', { type: 'text', value: st.avoid.join(', '), placeholder: 'for example: peanut, sesame', 'aria-label': 'Ingredients to avoid', style: 'width:100%' }),
        h('p', { class: 'note', text: 'Recipes containing these are skipped in the plan and marked in Recipes.' })),
      h('div', { class: 'group' }, h('span', { class: 'label', text: 'Plan starts on' }), startSel = h('select', { 'aria-label': 'Plan start date' }, (function () {
        var t = new Date(), o = []; for (var i = -28; i <= 14; i++) { var d = addDays(new Date(t.getFullYear(), t.getMonth(), t.getDate()), i); o.push(h('option', { value: ymd(d), text: shortDate(d), selected: ymd(d) === st.start })); } return o; })()),
        h('p', { class: 'note', text: 'The menu rotates from this day. Pick a batch-cook night so the week lines up.' })),
      h('button', { class: 'btn', type: 'button', text: 'Save', onclick: function () {
        st.adults = Math.max(1, +ad.value || 1); st.toddlers = Math.max(0, +td.value || 0); st.avoid = av.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); st.start = startSel.value; save(); cache = null; toast('Saved'); renderAll(); } })));
    el.appendChild(h('div', { class: 'card' }, h('span', { class: 'label', text: 'Your data' }),
      h('p', { class: 'note', text: 'Stays in this browser. Export your settings, swaps and shopping ticks to move them to another device.' }),
      h('div', { class: 'row', style: 'margin-top:.6rem' }, h('button', { class: 'btn sm', type: 'button', text: 'Export', onclick: exportData }), importButton(),
        h('button', { class: 'btn ghost sm', type: 'button', text: 'Reset swaps', onclick: function () { S.overrides = {}; save(); cache = null; renderAll(); toast('Swaps cleared'); } }),
        h('button', { class: 'btn ghost sm', type: 'button', text: 'Clear all', onclick: function () { if (confirm('Delete settings, swaps and ticks from this browser?')) { S = defaults(); save(); cache = null; renderAll(); } } }))));
  }

  /* ---------- shell ---------- */
  function renderAll() { renderToday(); renderWeek(); renderShop(); renderRecipes(); renderGuide(); renderSetup(); setTab(S.tab, true); }
  function setTab(t, quiet) {
    S.tab = t; if (!quiet) save();
    document.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === t)); b.tabIndex = b.dataset.tab === t ? 0 : -1; });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.id !== 'p-' + t; });
    ({ today: renderToday, week: renderWeek, shop: renderShop, recipes: renderRecipes, guide: renderGuide, setup: renderSetup })[t]();
    if (!quiet) window.scrollTo(0, 0);
  }
  function init() {
    $('#theme-toggle').addEventListener('click', function () { var n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('theme', n); } catch (e) {} });
    document.querySelectorAll('.tab').forEach(function (b, i, all) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
      b.addEventListener('keydown', function (e) { var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { var n = all[(i + d + all.length) % all.length]; n.focus(); setTab(n.dataset.tab); } });
    });
    S = load();
    fetch('data.json').then(function (r) { return r.json(); }).then(function (d) {
      DATA = d; d.recipes.forEach(function (r) { R[r.id] = r; });
      $('#subtitle').textContent = 'Three batch-cook nights a week, a rotating menu, swap-a-meal and a scaled shopping list.';
      renderAll();
    }).catch(function () { $('#subtitle').textContent = 'Could not load recipe data. Reload the page.'; });
  }
  init();
})();
