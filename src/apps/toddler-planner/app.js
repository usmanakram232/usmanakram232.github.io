(function () {
  'use strict';
  var KEY = 'toddlerPlanner.v1';
  var DATA, S;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var DAY = 86400000;

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysAgo(dateStr) { return Math.round((new Date(ymd()) - new Date(dateStr)) / DAY); }

  /* ---------- state ---------- */
  function defaults() {
    return { profile: { name: '', dob: '' }, skills: {}, log: [], minutes: {}, focus: ['pour', 'jump', 'words'],
      filters: { time: 15, where: 'any', energy: 'any', mess: 'low', stretch: true }, tab: 'today' };
  }
  function load() {
    var s = defaults();
    try { var raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw) { Object.keys(raw).forEach(function (k) { s[k] = raw[k]; }); s.filters = Object.assign(defaults().filters, raw.filters || {}); } } catch (e) {}
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save: browser storage is blocked'); } }
  var toastTimer;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600); }


  /* ---------- backup ---------- */
  function exportData(scope) {
    var o = { app: 'toddler-planner', version: 1, profile: S.profile, skills: S.skills };
    if (scope === 'all') { o.log = S.log; o.minutes = S.minutes; o.focus = S.focus; }
    var blob = new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' });
    var u = URL.createObjectURL(blob), a = h('a', { href: u, download: 'toddler-' + (scope === 'all' ? 'backup-' : 'profile-') + ymd() + '.json' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 500);
  }
  function importButton(label, cls) {
    var file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': label, onchange: function () {
      var f = file.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () {
        try {
          var d = JSON.parse(r.result); if (d.app !== 'toddler-planner') throw 0;
          ['skills', 'log', 'minutes', 'focus'].forEach(function (k) { if (d[k] != null) S[k] = d[k]; });
          if (d.profile) { if (d.profile.name) S.profile.name = d.profile.name; if (d.profile.dob) S.profile.dob = d.profile.dob; }
          save(); header(); suggest(); toast('Imported'); renderAll();
        } catch (e) { toast('That file is not a planner export'); }
      };
      r.readAsText(f); file.value = '';
    } });
    return h('span', null, h('button', { class: cls || 'btn ghost sm', type: 'button', text: label, onclick: function () { file.click(); } }), file);
  }

  /* ---------- helpers ---------- */
  function ageText() {
    var m = /^(\d{4})-(\d{2})/.exec(S.profile.dob || '');
    if (!m) return null;
    var n = new Date(), mo = (n.getFullYear() - +m[1]) * 12 + n.getMonth() + 1 - +m[2];
    return mo < 0 ? null : mo;
  }
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function years() { var y = new Date().getFullYear(), r = []; for (var i = 0; i < 6; i++) r.push(y - i); return r; }
  function who() { return S.profile.name || 'your toddler'; }
  function actById(id) { return DATA.activities.filter(function (a) { return a.id === id; })[0]; }
  function lastDone(id) { var l = S.log.filter(function (e) { return e.id === id; }); return l.length ? l[l.length - 1] : null; }
  var MESS = { low: 0, medium: 1, high: 2 };

  /* ---------- scoring ---------- */
  function candidates() {
    var f = S.filters;
    return DATA.activities.filter(function (a) {
      if (f.time !== 'any' && a.minutes > f.time) return false;
      if (f.where === 'indoor' && a.setting === 'outdoor') return false;
      if (f.where === 'outdoor' && a.setting === 'indoor') return false;
      if (f.energy !== 'any' && a.energy !== f.energy) return false;
      if (f.mess === 'low' && a.mess !== 'low') return false;
      if (f.mess === 'some' && MESS[a.mess] > 1) return false;
      if (!f.stretch && a.level === 'stretch') return false;
      return true;
    });
  }
  function recentDomainCount(dom) {
    return S.log.filter(function (e) { var a = actById(e.id); return a && a.domain === dom && daysAgo(e.date) <= 7; }).length;
  }
  var picks = [];
  function suggest() {
    var pool = candidates().map(function (a) {
      var sc = 1, why = [];
      DATA.focus.forEach(function (f) { if (S.focus.indexOf(f.id) >= 0 && f.activities.indexOf(a.id) >= 0) { sc += 2; why.push('Practises: ' + f.label.toLowerCase()); } });
      var ld = lastDone(a.id);
      if (!ld) why.push('Not tried yet');
      else {
        var d = daysAgo(ld.date);
        if (d < 3) sc *= 0.15; else if (d < 7) sc *= 0.5;
        if (ld.react === 'loved') { sc *= 1.4; why.push('Loved it last time'); }
        if (ld.react === 'no') sc *= 0.4;
      }
      var rc = recentDomainCount(a.domain);
      sc *= 1 / (1 + 0.3 * rc);
      if (rc === 0 && DATA.domains[a.domain]) why.push('Little ' + DATA.domains[a.domain].toLowerCase() + ' play this week');
      if (a.level === 'stretch') { sc *= 0.7; why.push('A step beyond where he is'); }
      sc *= 0.7 + Math.random() * 0.6;
      return { a: a, sc: sc, why: why.slice(0, 2) };
    }).sort(function (x, y) { return y.sc - x.sc; });
    var out = [], seen = {};
    pool.forEach(function (p) { if (out.length < 3 && !seen[p.a.domain]) { out.push(p); seen[p.a.domain] = 1; } });
    pool.forEach(function (p) { if (out.length < 3 && out.indexOf(p) < 0) out.push(p); });
    picks = out;
  }


  /* ---------- illustrations (inline SVG, trusted constants) ---------- */
  var ICONS = {
    ball: '<circle cx="24" cy="24" r="15"/><path d="M10 20c9 5 19 5 28 0M24 9c-5 9-5 21 0 30"/>',
    tunnel: '<path d="M5 40V17l8-7h30v30z"/><path d="M13 40V30a9 9 0 0118 0v10"/><path d="M5 17h30v23"/>',
    drop: '<path d="M24 6c9 11 13 17 13 24a13 13 0 01-26 0c0-7 4-13 13-24z"/><path d="M17 31a7 7 0 004 6"/>',
    sponge: '<rect x="7" y="16" width="34" height="20" rx="4"/><circle cx="16" cy="25" r="2"/><circle cx="26" cy="30" r="2"/><circle cx="33" cy="23" r="2"/><path d="M12 36v4M36 36v4"/>',
    book: '<path d="M24 14c-4-3-10-4-16-3v25c6-1 12 0 16 3 4-3 10-4 16-3V11c-6-1-12 0-16 3zM24 14v25"/><path d="M12 18c3 0 5 .3 8 1.5M12 24c3 0 5 .3 8 1.5"/>',
    music: '<path d="M18 35V12l21-5v23"/><circle cx="13" cy="35" r="5"/><circle cx="34" cy="30" r="5"/>',
    blocks: '<rect x="6" y="28" width="15" height="14"/><rect x="21" y="28" width="15" height="14"/><rect x="13" y="14" width="15" height="14"/>',
    post: '<rect x="7" y="18" width="34" height="22" rx="3"/><path d="M15 18v-5h18v5M16 28h16"/><path d="M24 4v8M20 9l4 4 4-4"/>',
    paint: '<path d="M24 7c11 0 17 7 17 15 0 6-5 7-9 7s-4 4-1 6c-2 5-9 6-15 3C10 34 7 27 9 20 11 12 16 7 24 7z"/><circle cx="16" cy="21" r="2"/><circle cx="24" cy="15" r="2"/><circle cx="32" cy="19" r="2"/>',
    bubbles: '<circle cx="18" cy="29" r="11"/><circle cx="35" cy="16" r="6"/><circle cx="36" cy="35" r="4"/><path d="M13 25a6 6 0 013-4"/>',
    leaf: '<path d="M9 40C9 21 21 9 41 7c0 20-9 32-27 32z"/><path d="M9 40l20-20"/>',
    teddy: '<circle cx="24" cy="27" r="13"/><circle cx="12" cy="13" r="5"/><circle cx="36" cy="13" r="5"/><circle cx="19" cy="24" r="1.5"/><circle cx="29" cy="24" r="1.5"/><path d="M21 32q3 3 6 0"/>',
    jug: '<path d="M15 8h18l4 9v24H11V17z"/><path d="M11 28q6 3 13 0t13 0"/><path d="M37 17l6-3"/>',
    beads: '<path d="M2 24h44"/><circle cx="9" cy="24" r="6"/><circle cx="23" cy="24" r="6"/><circle cx="37" cy="24" r="6"/>',
    tape: '<circle cx="22" cy="24" r="15"/><circle cx="22" cy="24" r="6"/><path d="M36 32l8 8"/>',
    basket: '<path d="M7 20h34l-4 21H11z"/><path d="M13 20c0-9 6-13 11-13s11 4 11 13M16 27v8M24 27v8M32 27v8"/>',
    cloth: '<path d="M6 41c2-16 9-25 18-25s16 9 18 25z"/><path d="M13 41c1-6 3-10 6-13M33 41c-1-4-2-7-4-9"/><circle cx="24" cy="10" r="3"/>',
    bag: '<path d="M14 15h20l5 25H9z"/><path d="M18 15c0-9 12-9 12 0"/><path d="M21 27a3 3 0 115 2c-1 1-2 1-2 3M24 36h.1"/>',
    ice: '<path d="M8 15l16-7 16 7v18l-16 7-16-7z"/><path d="M8 15l16 7 16-7M24 22v18"/>',
    dance: '<circle cx="24" cy="9" r="4"/><path d="M24 14v15M24 20l-11-6M24 20l11 5M24 29l-8 13M24 29l9 13"/>',
    climb: '<path d="M7 42L24 6l17 36"/><path d="M12 31h24M17 21h14M21 12h6"/>',
    dough: '<path d="M6 31c0-9 8-15 18-15s18 6 18 15-8 11-18 11S6 40 6 31z"/><circle cx="17" cy="30" r="1.5"/><circle cx="24" cy="34" r="1.5"/><circle cx="31" cy="29" r="1.5"/><path d="M20 16c0-5 8-5 8 0"/>',
    brush: '<path d="M27 6l15 15-9 9L18 15z"/><path d="M22 22l6 6M17 33L6 44"/>',
    cards: '<rect x="7" y="14" width="22" height="28" rx="2"/><rect x="19" y="7" width="22" height="28" rx="2"/><path d="M25 16h10M25 22h10M25 28h6"/>',
    cups: '<path d="M7 20h22l-3 20H10z"/><path d="M12 13h12"/><circle cx="38" cy="35" r="5"/>',
    paw: '<path d="M24 28c-7 0-11 5-11 9 0 3 4 4 11 4s11-1 11-4c0-4-4-9-11-9z"/><circle cx="11" cy="21" r="3.5"/><circle cx="19" cy="13" r="3.5"/><circle cx="29" cy="13" r="3.5"/><circle cx="37" cy="21" r="3.5"/>',
    foot: '<path d="M16 26c0-5 3-9 8-9s8 4 8 9c0 6 2 10 0 14s-14 4-16 0 0-8 0-14z"/><circle cx="14" cy="14" r="2.6"/><circle cx="21" cy="9" r="2.6"/><circle cx="29" cy="9" r="2.6"/><circle cx="36" cy="14" r="2.6"/>',
    ribbon: '<path d="M5 12c7 0 8 9 14 9s7-9 14-9 8 9 10 9M5 28c7 0 8 9 14 9s7-9 14-9 8 9 10 9"/>',
    plant: '<path d="M24 43V22M24 31c-9 0-13-6-13-13 9 0 13 5 13 13zM24 25c0-9 5-13 13-13 0 8-4 13-13 13zM12 43h24"/>',
    sort: '<path d="M5 27h17a8.5 8.5 0 01-17 0zM26 27h17a8.5 8.5 0 01-17 0z"/><circle cx="13" cy="18" r="4"/><circle cx="34" cy="18" r="4"/><circle cx="18" cy="10" r="2.5"/>',
    bin: '<path d="M10 20h28l-3 21H13z"/><circle cx="18" cy="12" r="4"/><circle cx="30" cy="10" r="4"/><path d="M24 29v6"/>',
    run: '<circle cx="31" cy="9" r="4"/><path d="M29 14l-7 11 9 6-3 11M22 25l-9 2M30 18l8 6M12 38h9"/>',
    push: '<rect x="5" y="22" width="20" height="16" rx="2"/><circle cx="10" cy="40" r="3"/><circle cx="21" cy="40" r="3"/><path d="M30 30h13M37 23l6 7-6 7"/>',
    throw: '<circle cx="39" cy="10" r="5"/><path d="M5 40Q12 8 31 11" stroke-dasharray="3 4"/><path d="M5 42l8-6"/>',
    jump: '<path d="M24 42V12M15 21l9-9 9 9M9 45h30"/>',
    face: '<circle cx="24" cy="24" r="16"/><circle cx="18" cy="21" r="1.7"/><circle cx="30" cy="21" r="1.7"/><path d="M16 29q8 8 16 0"/>',
    sun: '<circle cx="24" cy="24" r="8"/><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.5 10.5l4 4M33.5 33.5l4 4M10.5 37.5l4-4M33.5 14.5l4-4"/>'
  };
  var ACT_ICON = { 'squishy-sponges': 'sponge', 'leaf-collector': 'leaf', 'freeze-dance': 'dance', 'fill-and-dump-ball-transfer': 'ball', 'teddy-bear-pretend-care': 'teddy',
    'how-does-your-garden-grow': 'plant', 'classic-shell-game': 'cups', 'band-together': 'music', 'bubble-mound-exploration': 'bubbles', 'diaper-naming-game': 'foot',
    'picture-story-cards': 'cards', 'point-it-out-reading': 'book', 'cardboard-box-tunnel': 'tunnel', 'living-room-obstacle-course': 'run', 'play-dough-squeezing-and-poking': 'dough',
    'gentle-ball-roll-and-toss': 'ball', 'action-song-sing-along': 'music', 'color-sorting-trays': 'sort', 'pikler-climbing-exploration': 'climb', 'sponge-table-washing': 'sponge',
    'finger-painting': 'paint', 'large-bead-threading': 'beads', 'tape-rescue': 'tape', 'crayon-or-card-drop': 'post', 'pom-pom-ice-tray-transfer': 'bin',
    'cardboard-pom-pom-tube-drop': 'post', 'ribbon-tugging-box': 'ribbon', 'ice-toy-excavation': 'ice', 'animal-walks': 'paw', 'sponge-painting': 'paint',
    'heuristic-treasure-basket-exploration': 'basket', 'in-and-out-container-play': 'bin', 'tower-tumbler': 'blocks', 'hide-and-search-towel-game': 'cloth',
    'doll-brush-routine': 'brush', 'interactive-book-animal-sounds': 'book', 'food-photo-collage': 'cards', 'water-table-soap-wash': 'drop', 'perforated-jug-pouring': 'jug', 'mystery-touch-bag': 'bag' };
  var DOM_ICON = { move: 'run', hands: 'blocks', words: 'book', senses: 'sun', pretend: 'teddy', daily: 'drop', mind: 'cups' };
  var BURN_ICON = { Climbing: 'climb', Running: 'run', 'Pushing/Pulling': 'push', Throwing: 'throw', Jumping: 'jump', Dancing: 'dance' };
  var DOM_HUE = { move: 205, hands: 160, words: 45, senses: 280, pretend: 340, daily: 22, mind: 100 };
  function icon(name, dom, size) {
    var el = h('span', { class: 'ico', 'aria-hidden': 'true', style: '--h:' + (DOM_HUE[dom] || 210) + ';width:' + size + 'px;height:' + size + 'px' });
    el.innerHTML = '<svg viewBox="0 0 48 48" width="' + Math.round(size * .66) + '" height="' + Math.round(size * .66) + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + (ICONS[name] || ICONS.sun) + '</svg>';
    return el;
  }

  /* ---------- render: today ---------- */
  function chipGroup(label, opts, cur, onPick) {
    return h('div', { class: 'group', role: 'group', 'aria-label': label }, h('span', { class: 'label', text: label }),
      h('div', { class: 'row' }, opts.map(function (o) {
        return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur === o[0]), text: o[1], onclick: function () { onPick(o[0]); } });
      })));
  }
  function activityCard(p) {
    var a = p.a, saf = a.safety.map(function (id) { return DATA.safety[id]; }).filter(Boolean);
    var ver = 'asis', verSel;
    var card = h('article', { class: 'card' },
      h('div', { class: 'card-head' }, icon(ACT_ICON[a.id] || DOM_ICON[a.domain], a.domain, 56), h('h3', { text: a.title })),
      h('div', { class: 'meta' },
        h('span', { class: 'tag', text: a.minutes + ' min' }), h('span', { class: 'tag', text: a.setting }),
        h('span', { class: 'tag', text: a.energy + ' energy' }), h('span', { class: 'tag', text: a.mess + ' mess' }),
        h('span', { class: 'tag acc', text: DATA.domains[a.domain] }),
        a.level === 'stretch' ? h('span', { class: 'tag', text: 'stretch' }) : null,
        saf.length ? h('span', { class: 'tag warn', text: 'safety' }) : null),
      p.why && p.why.length ? h('p', { class: 'why', text: p.why.join('. ') + '.' }) : null,
      saf.map(function (s) { return h('div', { class: 'safety' }, h('b', { text: s.title + ': ' }), s.rule); }),
      h('details', null, h('summary', { text: 'How to do it' }),
        h('div', null,
          h('p', { class: 'kv' }, h('b', { text: 'You need: ' }), a.materials),
          h('ol', null, a.steps.map(function (s) { return h('li', { text: s }); })),
          h('p', { class: 'kv' }, h('b', { text: 'Easier: ' }), a.easier),
          h('p', { class: 'kv' }, h('b', { text: 'Harder: ' }), a.harder),
          h('p', { class: 'kv' }, h('b', { text: 'Builds: ' }), a.builds),
          h('p', { class: 'note', text: 'Source: ' + a.source }))),
      h('div', { class: 'log-actions' },
        h('label', { class: 'note' }, 'Version ',
          verSel = h('select', { 'aria-label': 'Version tried' }, h('option', { value: 'asis', text: 'as written' }), h('option', { value: 'easier', text: 'easier' }), h('option', { value: 'harder', text: 'harder' }))),
        [['loved', 'Loved it'], ['ok', 'Fine'], ['no', 'Not a hit']].map(function (r) {
          return h('button', { class: 'btn ghost sm', type: 'button', text: r[1], onclick: function () {
            S.log.push({ id: a.id, date: ymd(), ts: Date.now(), react: r[0], ver: verSel.value }); save(); toast('Logged: ' + a.title); suggest(); renderToday();
          } });
        })));
    return card;
  }
  function burnerSection() {
    var cats = ['All'].concat(DATA.burners.map(function (b) { return b.cat; }).filter(function (c, i, ar) { return ar.indexOf(c) === i; }));
    var wrap = h('div', { class: 'card' }, h('h2', { text: 'Burn energy' }),
      h('p', { class: 'sub', text: 'Quick movement ideas, no prep. Pick where you are.' }));
    var where = S.burnWhere || 'out', cat = S.burnCat || 'All';
    wrap.appendChild(h('div', { class: 'group', style: 'margin-top:.8rem' }, h('div', { class: 'row' },
      [['out', 'Outside'], ['indoor', 'Indoors or rainy']].map(function (o) { return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(where === o[0]), text: o[1], onclick: function () { S.burnWhere = o[0]; save(); renderToday(); } }); }))));
    wrap.appendChild(h('div', { class: 'group' }, h('div', { class: 'row' }, cats.map(function (c) { return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(cat === c), text: c, onclick: function () { S.burnCat = c; save(); renderToday(); } }); }))));
    var items = DATA.burners.filter(function (b) { return cat === 'All' || b.cat === cat; });
    items = items.slice().sort(function () { return Math.random() - .5; }).slice(0, cat === 'All' ? 3 : 4);
    items.forEach(function (b) { var x = where === 'out' ? b.out : b.indoor; wrap.appendChild(h('div', { class: 'burn' }, icon(BURN_ICON[b.cat], 'move', 44), h('p', { class: 'kv' }, h('b', { text: x.title + ' ' }), h('span', { class: 'tag', text: b.cat }), h('br'), x.text))); });
    wrap.appendChild(h('div', { class: 'safety' }, h('b', { text: 'Safety: ' }), 'Soft surface under climbing and jumping, and stay within a step of him.'));
    return wrap;
  }
  function minutesSection() {
    var day = S.minutes[ymd()] || { hard: 0, easy: 0 }, total = day.hard + day.easy;
    function add(kind, m) { var d = S.minutes[ymd()] || { hard: 0, easy: 0 }; d[kind] = Math.max(0, d[kind] + m); S.minutes[ymd()] = d; save(); renderToday(); }
    function bar(label, val, goal, ok) {
      return h('div', { class: 'group' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'note', text: label }), h('span', { class: 'note', text: val + ' / ' + goal + ' min' })),
        h('div', { class: 'bar' + (ok ? ' ok' : ''), role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': goal, 'aria-valuenow': Math.min(val, goal) }, h('i', { style: 'width:' + Math.min(100, val / goal * 100) + '%' })));
    }
    return h('div', { class: 'card' }, h('h2', { text: 'Movement today' }),
      h('p', { class: 'sub', text: 'WHO: at least 180 minutes of varied physical activity a day for ages 1 to 2, with at least 60 of them energetic. Walking, climbing and crawling all count, and childcare time counts too.' }),
      h('div', { style: 'margin-top:.8rem' }, bar('Energetic (running, climbing, jumping, dancing)', day.hard, 60, day.hard >= 60), bar('All activity', total, 180, total >= 180)),
      h('div', { class: 'row' }, h('span', { class: 'note', text: 'Energetic' }), [5, 10, 15, 30].map(function (m) { return h('button', { class: 'chip', type: 'button', text: '+' + m, 'aria-label': 'Add ' + m + ' energetic minutes', onclick: function () { add('hard', m); } }); })),
      h('div', { class: 'row', style: 'margin-top:.4rem' }, h('span', { class: 'note', text: 'Gentle' }), [15, 30, 60].map(function (m) { return h('button', { class: 'chip', type: 'button', text: '+' + m, 'aria-label': 'Add ' + m + ' gentle minutes', onclick: function () { add('easy', m); } }); }),
        h('button', { class: 'chip', type: 'button', text: 'Reset today', onclick: function () { delete S.minutes[ymd()]; save(); renderToday(); } })));
  }
  function renderToday() {
    var el = clear($('#p-today')), f = S.filters;
    var fsum = (f.time === 'any' ? 'Any length' : f.time + ' min') + ' · ' + f.where + ' · ' + f.energy + ' energy · ' + ({ low: 'low', some: 'some', any: 'any' }[f.mess]) + ' mess';
    var fcard = h('details', { class: 'card', open: S.filtersOpen }, h('summary', { text: 'Limits: ' + fsum }),
      h('div', { style: 'margin-top:.8rem' }, chipGroup('Time', [[10, '10 min'], [15, '15 min'], ['any', 'Longer']], f.time, function (v) { f.time = v; save(); suggest(); renderToday(); }),
      chipGroup('Where', [['any', 'Anywhere'], ['indoor', 'Indoors'], ['outdoor', 'Outdoors']], f.where, function (v) { f.where = v; save(); suggest(); renderToday(); }),
      chipGroup('Energy', [['any', 'Any'], ['high', 'High'], ['medium', 'Medium'], ['calm', 'Calm']], f.energy, function (v) { f.energy = v; save(); suggest(); renderToday(); }),
      chipGroup('Mess', [['low', 'Low only'], ['some', 'Some'], ['any', 'Any']], f.mess, function (v) { f.mess = v; save(); suggest(); renderToday(); }),
      h('div', { class: 'group', role: 'group', 'aria-label': 'Focus' }, h('span', { class: 'label', text: 'Focus (pick what to practise)' }),
        h('div', { class: 'row' }, DATA.focus.map(function (fo) {
          return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.focus.indexOf(fo.id) >= 0), text: fo.label, onclick: function () {
            var i = S.focus.indexOf(fo.id); if (i >= 0) S.focus.splice(i, 1); else S.focus.push(fo.id); save(); suggest(); renderToday(); } });
        }))),
      h('div', { class: 'row' },
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(f.stretch), text: 'Include stretch ideas', onclick: function () { f.stretch = !f.stretch; save(); suggest(); renderToday(); } }),
        h('button', { class: 'btn', type: 'button', text: 'Shuffle', onclick: function () { suggest(); renderToday(); } }))));
    fcard.addEventListener('toggle', function () { S.filtersOpen = fcard.open; });
    el.appendChild(h('h2', { text: 'What shall we do now?' }));
    el.appendChild(h('p', { class: 'sub', text: 'Three ideas that fit your limits. Attention for a toddler is often 3 to 10 minutes, so stop when ' + who() + ' is done.', style: 'margin-bottom:1rem' }));
    var fo = S.focus.map(function (id) { return DATA.focus.filter(function (x) { return x.id === id; })[0]; }).filter(Boolean);
    if (fo.length) fcard.querySelector('div').appendChild(h('p', { class: 'note', style: 'margin-top:.8rem', text: 'Why these focuses: ' + fo.map(function (x) { return x.label + ': ' + x.why; }).join(' ') }));
    el.appendChild(fcard);
    if (!picks.length) el.appendChild(h('div', { class: 'card' }, h('p', { text: 'Nothing matches these limits. Relax one filter, such as mess or time.' })));
    picks.forEach(function (p) { el.appendChild(activityCard(p)); });
    el.appendChild(burnerSection());
    el.appendChild(minutesSection());
  }

  /* ---------- render: growth ---------- */
  var SKILL_FOCUS = { jump: 'jump', 'stairs-down': 'jump', trike: 'jump', hang: 'jump', cup: 'pour', spoon: 'pour', pour: 'pour', tower4: 'stack', stack2: 'stack', post: 'stack', combine: 'words', words30: 'words', 'name-familiar': 'words', mine: 'words', 'potty-interest': 'potty', 'potty-signals': 'potty', 'potty-sits': 'potty', 'no-phase': 'calm', 'new-pretend': 'calm' };
  function renderGrowth() {
    var el = clear($('#p-growth'));
    var a = ageText();
    el.appendChild(h('h2', { text: 'Where ' + who() + ' is now' }));
    el.appendChild(h('p', { class: 'sub', text: DATA.timing + ' Ahead in one area and later in another is normal. This is a play guide, not an assessment.' }));
    var nm, bm, by, pm = /^(\d{4})-(\d{2})/.exec(S.profile.dob || '') || [];
    el.appendChild(h('div', { class: 'card', style: 'margin-top:1rem' }, h('span', { class: 'label', text: 'Profile (stays in this browser)' }),
      h('div', { class: 'row' },
        h('label', { class: 'note' }, 'Name ', nm = h('input', { type: 'text', value: S.profile.name, 'aria-label': 'Name', autocomplete: 'off' })),
        h('label', { class: 'note' }, 'Born ', bm = h('select', { 'aria-label': 'Birth month' }, h('option', { value: '', text: 'Month' }), MONTHS.map(function (m, i) { return h('option', { value: String(i + 1).padStart(2, '0'), text: m, selected: pm[2] === String(i + 1).padStart(2, '0') }); })),
          by = h('select', { 'aria-label': 'Birth year' }, h('option', { value: '', text: 'Year' }), years().map(function (y) { return h('option', { value: String(y), text: String(y), selected: pm[1] === String(y) }); }))),
        h('button', { class: 'btn sm', type: 'button', text: 'Save', onclick: function () { S.profile.name = nm.value.trim(); S.profile.dob = bm.value && by.value ? by.value + '-' + bm.value : ''; save(); header(); renderGrowth(); toast('Saved'); } })),
      a != null ? h('p', { class: 'note', style: 'margin-top:.5rem', text: 'Age: ' + a + ' months.' }) : null,
      h('div', { class: 'row', style: 'margin-top:.6rem' }, h('button', { class: 'btn ghost sm', type: 'button', text: 'Export profile', onclick: function () { exportData('profile'); } }), importButton('Import profile'),
        h('span', { class: 'note', text: 'A small JSON file with name, birth month and skills.' }))));
    var order = { working: 0, none: 1 }, bandRank = { '18 mo': 0, '24 mo': 1, typical: 2 };
    var next = DATA.skills.filter(function (s) { return (S.skills[s.id] || 'none') !== 'done'; })
      .sort(function (x, y) { var sx = (S.skills[x.id] === 'working' ? 0 : 1), sy = (S.skills[y.id] === 'working' ? 0 : 1); return sx - sy || bandRank[x.band] - bandRank[y.band]; }).slice(0, 6);
    el.appendChild(h('div', { class: 'card' }, h('h3', { text: 'Next up' }),
      h('p', { class: 'note', text: 'Skills they are working on first, then the next in the typical sequence.' }),
      next.map(function (s) {
        var fid = SKILL_FOCUS[s.id];
        return h('div', { class: 'skill' }, h('div', null, s.label, h('small', { text: DATA.domains[s.domain] + ' · ' + (S.skills[s.id] === 'working' ? 'working on it' : 'not yet') })),
          fid ? h('button', { class: 'btn ghost sm', type: 'button', text: 'Practise', onclick: function () { if (S.focus.indexOf(fid) < 0) S.focus.push(fid); save(); suggest(); setTab('today'); } }) : null);
      })));
    Object.keys(DATA.domains).filter(function (d) { return DATA.skills.some(function (s) { return s.domain === d; }); }).forEach(function (dom) {
      var skills = DATA.skills.filter(function (s) { return s.domain === dom; });
      var done = skills.filter(function (s) { return S.skills[s.id] === 'done'; }).length;
      var card = h('div', { class: 'card' }, h('h3', { text: DATA.domains[dom] + ' (' + done + ' of ' + skills.length + ')' }));
      skills.forEach(function (s) {
        var cur = S.skills[s.id] || 'none';
        card.appendChild(h('div', { class: 'skill' }, h('div', null, s.label, h('small', { text: s.band })),
          h('div', { class: 'seg', role: 'radiogroup', 'aria-label': s.label }, [['none', 'Not yet'], ['working', 'Working'], ['done', 'Does it']].map(function (o) {
            return h('button', { type: 'button', role: 'radio', 'aria-checked': String(cur === o[0]), text: o[1], onclick: function () { S.skills[s.id] = o[0]; save(); renderGrowth(); } });
          }))));
      });
      el.appendChild(card);
    });
    el.appendChild(h('div', { class: 'card' }, h('h3', { text: 'When to ask the paediatrician' }),
      h('p', { text: 'Talk to your paediatrician about big delays in walking, running, jumping, climbing or balance, or coordination problems that affect daily life, and about any worry with hands, speech or social skills. Raise concerns at routine check-ups (in Germany the U7 is at 21 to 24 months).', class: 'note' })));
  }

  /* ---------- render: log ---------- */
  function renderLog() {
    var el = clear($('#p-log'));
    el.appendChild(h('h2', { text: 'Log' }));
    var recent = S.log.filter(function (e) { return daysAgo(e.date) <= 14; });
    el.appendChild(h('p', { class: 'sub', text: recent.length + ' activities in the last 14 days.' }));
    var counts = {}; recent.forEach(function (e) { var a = actById(e.id); if (a) counts[a.domain] = (counts[a.domain] || 0) + 1; });
    var max = Math.max.apply(null, Object.keys(DATA.domains).map(function (d) { return counts[d] || 0; }).concat([1]));
    el.appendChild(h('div', { class: 'card', style: 'margin-top:1rem' }, h('span', { class: 'label', text: 'Balance, last 14 days' }),
      Object.keys(DATA.domains).map(function (d) {
        var c = counts[d] || 0;
        return h('div', { class: 'group' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'note', text: DATA.domains[d] }), h('span', { class: 'note', text: String(c) })),
          h('div', { class: 'bar', role: 'progressbar', 'aria-label': DATA.domains[d], 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': c }, h('i', { style: 'width:' + (c / max * 100) + '%' })));
      })));
    var list = h('div', { class: 'card' }, h('span', { class: 'label', text: 'History' }));
    if (!S.log.length) list.appendChild(h('p', { class: 'note', text: 'Nothing logged yet. Tap "Loved it", "Fine" or "Not a hit" on an activity card.' }));
    S.log.slice().reverse().slice(0, 60).forEach(function (e) {
      var a = actById(e.id);
      list.appendChild(h('div', { class: 'skill' }, h('div', null, a ? a.title : e.id, h('small', { text: e.date + ' · ' + ({ loved: 'loved it', ok: 'fine', no: 'not a hit' }[e.react] || '') + (e.ver && e.ver !== 'asis' ? ' · ' + e.ver : '') })),
        h('button', { class: 'btn ghost sm', type: 'button', text: 'Remove', 'aria-label': 'Remove ' + (a ? a.title : e.id), onclick: function () { S.log = S.log.filter(function (x) { return x !== e; }); save(); renderLog(); } })));
    });
    el.appendChild(list);
    el.appendChild(h('div', { class: 'card' }, h('span', { class: 'label', text: 'Your data' }),
      h('p', { class: 'note', text: 'Data lives only in this browser. Export a full backup (profile, skills, log, movement) before clearing browser data or switching phones.' }),
      h('div', { class: 'row', style: 'margin-top:.6rem' },
        h('button', { class: 'btn sm', type: 'button', text: 'Export backup', onclick: function () { exportData('all'); } }),
        importButton('Import backup'),
        h('button', { class: 'btn ghost sm', type: 'button', text: 'Clear all', onclick: function () { if (confirm('Delete the profile, skills and log from this browser?')) { var t = S.tab; S = defaults(); S.tab = t; save(); header(); suggest(); renderAll(); } } }))));
  }

  /* ---------- render: guide ---------- */
  function renderGuide() {
    var el = clear($('#p-guide')), g = DATA.guide;
    el.appendChild(h('h2', { text: 'Guide' }));
    function sec(title, body, open) { return h('details', { class: 'card', open: open }, h('summary', { text: title }), h('div', null, body)); }
    el.appendChild(sec('How to play with a toddler', [
      h('p', { class: 'kv' }, h('b', { text: 'Join in: ' }), g.join), h('p', { class: 'kv' }, h('b', { text: 'How long: ' }), g.span),
      h('p', { class: 'kv' }, h('b', { text: 'Step back: ' }), g.back), h('p', { class: 'kv' }, h('b', { text: 'Scaffold: ' }), g.scaffold)], true));
    el.appendChild(sec('A day around childcare', [
      h('p', { class: 'note', text: 'A sample day. Childcare covers part of the day; these are short home slots.' }),
      h('p', { class: 'kv' }, h('b', { text: 'After pick-up (10 to 15 min): ' }), 'energetic play outdoors or an indoor obstacle course. The WHO target is 60 energetic minutes in the day, and childcare time counts.'),
      h('p', { class: 'kv' }, h('b', { text: 'Dinner: ' }), 'self-feeding with spoon and cup, small amounts, towel ready.'),
      h('p', { class: 'kv' }, h('b', { text: 'Bath: ' }), 'pouring cups, strainers, squirters. Best place for cup control practice.'),
      h('p', { class: 'kv' }, h('b', { text: 'Wind-down: ' }), 'calm storytime and slow songs. Keep it the same every evening.'),
      h('p', { class: 'kv' }, h('b', { text: 'Weekend: ' }), 'a park trip (climbing, running, swings) plus one calm hands-on activity from Today.'),
      h('p', { class: 'note', text: 'Screens: keep them small and do not let them replace play, movement, sleep or talk.' })]));
    el.appendChild(sec('Everyday routines', DATA.routines.map(function (r) { return h('p', { class: 'kv' }, h('b', { text: r.routine + ': ' }), r.text); }).concat([h('p', { class: 'kv' }, h('b', { text: 'When they resist: ' }), DATA.resist)])));
    el.appendChild(sec('Treasure basket ideas', [h('p', { text: DATA.basket.join(', ') + '. Check each item for safety first, then sit back and watch.' })]));
    var ids = Object.keys(DATA.safety);
    el.appendChild(sec('Safety rules', ids.map(function (id) { var s = DATA.safety[id];
      return h('div', { class: 'safety' }, h('b', { text: s.title + ': ' }), s.rule, h('div', { class: 'note' + (s.general ? ' warn' : ''), text: s.src })); })));
    el.appendChild(sec('Not covered here', [h('p', { class: 'note', text: 'Look these up elsewhere or ask your paediatrician.' })].concat(DATA.gaps.map(function (x) { return h('p', { class: 'kv' }, h('b', { text: x.topic + ': ' }), x.text); }))));
    el.appendChild(sec('Sources', [h('ul', { style: 'padding-left:1.1rem' }, DATA.sources.map(function (x) { return h('li', { text: x }); }))]));
  }


  /* ---------- render: references ---------- */
  function renderRefs() {
    var el = clear($('#p-refs')), R = DATA.references, kind = S.refKind || 'all';
    el.appendChild(h('h2', { text: 'References' }));
    el.appendChild(h('p', { class: 'sub', text: 'The ideas here come from a closed set of ' + R.items.length + ' published sources. Each entry shows what it covers and which activities use it, so you can go and read the original.' }));
    el.appendChild(h('details', { class: 'card', style: 'margin-top:1rem', open: true }, h('summary', { text: 'How this was put together' }), h('div', null,
      h('p', { class: 'kv', text: 'I collected the sources, then wrote each activity from them: steps, materials, an easier and a harder version. Where sources disagreed or an idea had a safety problem (small pom-poms, scissors, ribbons) I changed it, and labelled safety rules that were not in any source as general guidance.' }),
      h('p', { class: 'kv', text: 'Not all sources are equal. A guideline from the WHO or a standards document carries more weight than a commercial blog. Use the type label on each entry, and treat blog-only ideas as suggestions rather than evidence.' }),
      h('p', { class: 'kv', text: 'This is a play guide, not medical or developmental advice. Anything about health, growth or safety should be checked with your paediatrician.' }),
      h('p', { class: 'kv', text: 'The key-findings summaries were written from the source text and may be imperfect. Check the original before relying on a number or quote. Some publisher sites block automatic link checks, so a link that fails once may still work in your browser.' }))));
    var kinds = ['all'].concat(Object.keys(R.kinds));
    el.appendChild(h('div', { class: 'group', role: 'group', 'aria-label': 'Filter by type' }, h('span', { class: 'label', text: 'Type' }), h('div', { class: 'row' }, kinds.map(function (k) {
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(kind === k), text: k === 'all' ? 'All' : R.kinds[k], onclick: function () { S.refKind = k; save(); renderRefs(); } });
    }))));
    R.items.filter(function (r) { return kind === 'all' || r.kind === kind; }).forEach(function (r) {
      var acts = r.rx ? DATA.activities.filter(function (a) { return new RegExp(r.rx).test(a.source); }) : [];
      el.appendChild(h('article', { class: 'card' },
        h('div', { class: 'meta' }, h('span', { class: 'tag acc', text: R.kinds[r.kind] }), h('span', { class: 'tag', text: r.year })),
        h('h3', { text: r.title }), h('p', { class: 'note', text: r.author }),
        h('p', { class: 'kv' }, h('b', { text: 'Covers: ' }), r.covers),
        r.ages ? h('p', { class: 'kv' }, h('b', { text: 'Ages: ' }), r.ages) : null,
        r.findings ? h('p', { class: 'kv' }, h('b', { text: 'Key findings: ' }), r.findings) : null,
        r.note ? h('p', { class: 'kv' }, h('b', { text: 'Worth knowing: ' }), r.note) : null,
        h('p', { class: 'kv' }, h('b', { text: 'Used here for: ' }), r.used),
        acts.length ? h('details', null, h('summary', { text: 'Activities using it (' + acts.length + ')' }), h('div', null, h('ul', { style: 'padding-left:1.1rem' }, acts.map(function (a) { return h('li', { text: a.title }); })))) : null,
        r.url ? h('p', { style: 'margin-top:.5rem' }, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.doi ? 'Read the paper (DOI ' + r.doi + ')' : 'Open the source' })) : h('p', { class: 'note', style: 'margin-top:.5rem', text: 'No direct link available. Search the title and author.' })));
    });
    el.appendChild(h('div', { class: 'card' }, h('h3', { text: 'Go deeper' }), h('p', { class: 'note', text: 'Authoritative starting points, separate from the sources above.' }),
      h('ul', { style: 'padding-left:1.1rem;margin-top:.4rem' }, R.further.map(function (f) { return h('li', null, h('a', { href: f.url, target: '_blank', rel: 'noopener', text: f.title }), ': ' + f.note); }))));
  }

  /* ---------- shell ---------- */
  function header() {
    var a = ageText();
    $('#subtitle').textContent = (S.profile.name ? S.profile.name + ', ' : '') + (a != null ? a + ' months. ' : '') + 'Short, safe ideas that fit your time and their energy.';
  }
  function renderAll() { renderToday(); renderGrowth(); renderLog(); renderGuide(); renderRefs(); setTab(S.tab, true); }
  function setTab(t, quiet) {
    S.tab = t; if (!quiet) save();
    document.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === t)); b.tabIndex = b.dataset.tab === t ? 0 : -1; });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.id !== 'p-' + t; });
    if (t === 'today') renderToday(); if (t === 'growth') renderGrowth(); if (t === 'log') renderLog(); if (t === 'refs') renderRefs();
    if (!quiet) window.scrollTo(0, 0);
  }
  function init() {
    var btn = $('#theme-toggle');
    btn.addEventListener('click', function () { var n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('theme', n); } catch (e) {} });
    document.querySelectorAll('.tab').forEach(function (b, i, all) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
      b.addEventListener('keydown', function (e) { var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { var n = all[(i + d + all.length) % all.length]; n.focus(); setTab(n.dataset.tab); } });
    });
    S = load(); header();
    fetch('data.json').then(function (r) { return r.json(); }).then(function (d) { DATA = d; suggest(); renderAll(); })
      .catch(function () { $('#subtitle').textContent = 'Could not load activity data. Reload the page.'; });
  }
  init();
})();
