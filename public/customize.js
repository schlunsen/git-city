/*
 * Git City — the Customize panel.
 *
 * Edits a draft .git-city/city.json for the profile on screen, previews it on
 * the island (the draft goes through the same validator and build path as a
 * fetched file), and publishes it through GitHub's own editor: a pre-filled
 * "new file" page, or the editor for an existing file plus "Copy JSON". No
 * tokens, no OAuth, nothing is written anywhere by this page.
 *
 * Config text only reaches the DOM through textContent / input values; the
 * panel never uses innerHTML. Links point at fixed github.com URLs built from
 * a validated login.
 */
import {
  OPTIONS, LABELS, LIMITS, CONFIG_PATH, PROFILE_README_DOCS, ORG_README_DOCS,
  normalizeCityConfig, serializeCityConfig, serializeBuildingConfig, newFileUrl, editFileUrl, blobUrl,
} from './city-config.js';
import { paintGraffiti } from './graffiti.js';
import { LANDMARK_SITES } from './world.js';
import { renderLandmarkThumbs } from './landmark-thumbs.js'; // small rendered pictures of each 3D landmark

// Where each landmark can stand (world.js LANDMARK_SITES), in words for the picker.
const SITE_LABEL = { bigFair: 'Big fairground', fair: 'Fairground', farm: 'Farmland', peak: 'Hilltop', slopes: 'Hillside', coast: 'Coast', wild: 'Wild land' };
function whereOf(key) {
  const kinds = (LANDMARK_SITES[key] || []).map((s) => s.replace(/\d+$/, ''));
  return [...new Set(kinds.map((k) => SITE_LABEL[k] || k))].slice(0, 2).join(' · ');
}

const GUIDE = './customize.html'; // the how-to page (public/customize.html)

const MAX_PREFILL_URL = 8000; // longer "new file" URLs get unreliable: fall back to copy + paste
const PREVIEW_DELAY = 450;

// ---- tiny DOM helpers (no innerHTML anywhere) --------------------------------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k.startsWith('aria-') || k === 'role' || k === 'for') el.setAttribute(k, String(v));
    else el[k] = v; // DOM properties: type, value, checked, maxLength, href, placeholder…
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
// Draft paths are arrays (repo names may contain dots). Keys are written as own
// data properties, so a repo called "__proto__" can't reach a prototype.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, configurable: true, writable: true });
function getIn(obj, path) {
  let o = obj;
  for (const k of path) { if (!o || typeof o !== 'object' || !own(o, k)) return undefined; o = o[k]; }
  return o;
}
function setIn(obj, path, value) {
  const chain = [];
  let o = obj;
  for (const k of path.slice(0, -1)) {
    if (!own(o, k) || !o[k] || typeof o[k] !== 'object' || Array.isArray(o[k])) put(o, k, {});
    chain.push([o, k]);
    o = o[k];
  }
  const last = path[path.length - 1];
  if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete o[last];
  else put(o, last, value);
  for (let i = chain.length - 1; i >= 0; i--) { // prune emptied sections
    const [p, k] = chain[i];
    if (Object.keys(p[k]).length) break;
    delete p[k];
  }
}
const draftFrom = (config) => JSON.parse(serializeCityConfig(config, { schema: false }));

// ---- toast: short notices ("city.json ignored: …") --------------------------
let toastEl = null, toastTimer = 0;
export function showToast(text, { tone = 'info', ms = 7000 } = {}) {
  injectStyle();
  if (!toastEl) {
    toastEl = h('div', { id: 'cz-toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.dataset.tone = tone;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/**
 * @param {{
 *   context: () => ({ login: string, repos: object[], found: boolean, error: string|null,
 *                     warnings: string[], published: object|null } | null),
 *   preview: (draft: object) => string[],   // apply a raw draft to the island; returns its warnings
 *   restore: () => void,                    // back to the published config
 *   onOpen?: () => void,
 * }} hooks
 */
export function createCustomizer({ context, preview, restore, onOpen }) {
  injectStyle(); // also styles the profile card's "How to customize" link
  let root = null, pill = null;
  let draft = null, forLogin = null, live = true, previewing = false, lastJson = '', timer = 0;
  let forRepo = null, forOrg = false; // where city.json goes: <login>/<login>, or <org>/.github
  const repoInfo = new Map(); // login -> { exists: true|false|null, branch }
  const els = {};

  function ensureRoot() {
    if (root) return;
    injectStyle();
    root = h('aside', { id: 'cz', role: 'dialog', 'aria-label': 'Customize this city', hidden: true, onkeydown: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      e.stopPropagation(); // typing here never reaches the city's shortcuts
    } });
    pill = h('div', { id: 'cz-pill', role: 'status', hidden: true },
      h('span', { text: 'Previewing your unpublished draft' }),
      h('button', { type: 'button', text: 'Edit', onclick: () => open() }),
      h('button', { type: 'button', text: 'Revert', onclick: () => revert() }));
    document.body.append(root, pill);
  }

  function open() {
    const ctx = context();
    if (!ctx?.login) return;
    ensureRoot();
    if (forLogin !== ctx.login || !draft) { draft = draftFrom(ctx.published); forLogin = ctx.login; }
    forRepo = ctx.configRepo; forOrg = !!ctx.org;
    render(ctx);
    root.hidden = false;
    document.body.classList.add('cz-open');
    updatePill();
    onOpen?.();
    lookupRepo(ctx.configRepo);
    root.querySelector('.cz-close')?.focus({ preventScroll: true });
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('cz-open');
    updatePill();
  }
  /** A different city loaded: drop the draft and the panel. */
  function reset() {
    clearTimeout(timer);
    draft = null; forLogin = null; previewing = false;
    close();
    updatePill();
  }
  function updatePill() { if (pill) pill.hidden = !(previewing && root?.hidden); }
  function revert() {
    clearTimeout(timer);
    previewing = false;
    restore();
    const ctx = context();
    draft = draftFrom(ctx?.published || null);
    if (root && !root.hidden && ctx) render(ctx);
    updatePill();
  }

  // Every edit lands here: re-validate, refresh the JSON + links, schedule a preview.
  function changed() {
    const ctx = context();
    if (!ctx) return;
    const { config, warnings } = normalizeCityConfig(draft, { repos: ctx.repos, login: ctx.login });
    lastJson = serializeCityConfig(config);
    els.json.textContent = lastJson;
    els.warn.replaceChildren(...warnings.slice(0, 12).map((w) => h('li', { text: w })));
    els.warn.hidden = !warnings.length;
    updatePublish(ctx);
    if (live) { clearTimeout(timer); timer = setTimeout(() => { preview(draft); previewing = true; updatePill(); }, PREVIEW_DELAY); }
  }
  const set = (path, value) => { setIn(draft, path, value); changed(); };

  // ---- form controls ---------------------------------------------------------
  const row = (label, control, hint) => h('label', { class: 'cz-row' },
    h('span', { class: 'cz-lab', text: label }), h('span', { class: 'cz-ctl' }, control, hint ? h('small', { text: hint }) : null));
  function textField(path, max, placeholder, multiline = false) {
    const el = h(multiline ? 'textarea' : 'input', {
      value: getIn(draft, path) ?? '', maxLength: max, placeholder, spellcheck: multiline, rows: multiline ? 2 : undefined,
      oninput: () => set(path, el.value),
    });
    if (!multiline) el.type = 'text';
    return el;
  }
  function selectField(path, list, labels, blank) {
    const cur = getIn(draft, path);
    const el = h('select', { onchange: () => set(path, el.value || undefined) },
      h('option', { value: '', text: blank }), ...list.map((v) => h('option', { value: v, text: labels[v] || v, selected: v === cur })));
    return el;
  }
  function flagField(path, onLabel, offLabel) {
    const cur = getIn(draft, path);
    const el = h('select', { onchange: () => set(path, el.value === '' ? undefined : el.value === 'on') },
      h('option', { value: '', text: 'Visitor\'s choice' }),
      h('option', { value: 'on', text: onLabel, selected: cur === true }),
      h('option', { value: 'off', text: offLabel, selected: cur === false }));
    return el;
  }
  function colourField(path, fallback) {
    const cur = getIn(draft, path);
    const pick = h('input', { type: 'color', value: cur || fallback, disabled: !cur, 'aria-label': 'Colour', oninput: () => set(path, pick.value) });
    const on = h('input', { type: 'checkbox', checked: !!cur, 'aria-label': 'Use a custom colour', onchange: () => {
      pick.disabled = !on.checked;
      set(path, on.checked ? pick.value : undefined);
    } });
    return h('span', { class: 'cz-colour' }, on, pick);
  }
  // Landmarks: a card per 3D landmark (a rendered picture, its name, where it
  // can stand). Picks keep their order (it's the order they're placed in), shown
  // as a number on the card; at the limit the rest are disabled.
  function landmarkPicker() {
    const count = h('span', { class: 'cz-lm-count', 'aria-live': 'polite' });
    const clear = h('button', { type: 'button', class: 'cz-mini', text: 'Clear', onclick: () => { set(['landmarks'], []); sync(); } });
    const grid = h('div', { class: 'cz-lm-grid', role: 'group', 'aria-label': 'Landmarks' });
    const cards = new Map();
    for (const key of OPTIONS.landmark) {
      const img = h('img', { class: 'cz-lm-img', alt: '', decoding: 'async' });
      const badge = h('span', { class: 'cz-lm-badge' });
      const where = whereOf(key);
      const b = h('button', {
        type: 'button', class: 'cz-lm', dataset: { key }, title: `${LABELS.landmark[key]}: ${where}`,
        onclick: () => {
          const sel = [...(getIn(draft, ['landmarks']) || [])];
          const i = sel.indexOf(key);
          if (i >= 0) sel.splice(i, 1); else if (sel.length < LIMITS.landmarks) sel.push(key);
          set(['landmarks'], sel);
          sync();
        },
      }, h('span', { class: 'cz-lm-pic' }, img, badge), h('span', { class: 'cz-lm-name', text: LABELS.landmark[key] }),
      h('span', { class: 'cz-lm-where', text: where }));
      cards.set(key, { b, img, badge, where });
      grid.append(b);
    }
    function sync() {
      const sel = getIn(draft, ['landmarks']) || [];
      count.textContent = sel.length ? `${sel.length} of ${LIMITS.landmarks} picked · placed in this order` : `None picked yet · up to ${LIMITS.landmarks}`;
      clear.hidden = !sel.length;
      for (const [key, c] of cards) {
        const i = sel.indexOf(key);
        c.b.setAttribute('aria-pressed', String(i >= 0));
        c.b.disabled = i < 0 && sel.length >= LIMITS.landmarks;
        c.badge.textContent = i >= 0 ? String(i + 1) : '';
        c.b.setAttribute('aria-label', `${LABELS.landmark[key]}, ${c.where}${i >= 0 ? `, picked number ${i + 1}` : ''}`);
      }
    }
    // The pictures are rendered once per visit, the first time the grid is on screen.
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      renderLandmarkThumbs((key, url) => {
        const c = cards.get(key);
        if (c) { c.img.src = url; c.b.classList.add('has-pic'); }
      });
    });
    seen.observe(grid);
    sync();
    return h('div', { class: 'cz-lm-wrap' }, h('div', { class: 'cz-lm-head' }, count, clear), grid);
  }
  function neighboursField() {
    const el = h('input', {
      type: 'text', value: (getIn(draft, ['neighbours']) || []).join(', '), placeholder: 'gaearon, antfu, sindresorhus', spellcheck: false,
      oninput: () => set(['neighbours'], el.value.split(/[\s,]+/).map((s) => s.replace(/^@/, '')).filter(Boolean)),
    });
    return el;
  }
  function volumeField() {
    const cur = getIn(draft, ['player', 'volume']);
    const out = h('output', { text: cur ?? '—' });
    const range = h('input', { type: 'range', min: 0, max: 100, step: 1, value: cur ?? 20, disabled: cur === undefined, 'aria-label': 'Volume',
      oninput: () => { out.textContent = range.value; set(['player', 'volume'], Number(range.value)); } });
    const on = h('input', { type: 'checkbox', checked: cur !== undefined, 'aria-label': 'Set a volume', onchange: () => {
      range.disabled = !on.checked;
      out.textContent = on.checked ? range.value : '—';
      set(['player', 'volume'], on.checked ? Number(range.value) : undefined);
    } });
    return h('span', { class: 'cz-colour' }, on, range, out);
  }

  // Repositories: feature (ordered), hide, and per-repo colour / sign / billboard / style.
  function repoSection(ctx) {
    const repos = (ctx.repos || []).filter((r) => r && !r.fork && !r.archived)
      .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
    const featuredLine = h('div', { class: 'cz-chips cz-featured' });
    const list = h('div', { class: 'cz-repos' });
    const rows = new Map();
    const filter = h('input', { type: 'search', placeholder: `Filter ${repos.length} repositories`, 'aria-label': 'Filter repositories', oninput: () => {
      const q = filter.value.trim().toLowerCase();
      for (const [name, r] of rows) r.el.hidden = !!q && !name.toLowerCase().includes(q);
    } });
    const inList = (key, name) => (getIn(draft, [key]) || []).includes(name);
    const toggle = (key, name, max) => {
      const cur = [...(getIn(draft, [key]) || [])];
      const i = cur.indexOf(name);
      if (i >= 0) cur.splice(i, 1);
      else if (cur.length < max) {
        cur.push(name);
        const other = key === 'hide' ? 'featured' : 'hide'; // a repo is featured or hidden, not both
        setIn(draft, [other], (getIn(draft, [other]) || []).filter((n) => n !== name));
      }
      set([key], cur);
      sync();
    };
    function sync() {
      const feat = getIn(draft, ['featured']) || [];
      featuredLine.replaceChildren(
        h('span', { class: 'cz-lab', text: feat.length ? 'Featured, in order:' : 'Nothing featured: the most-starred repos lead.' }),
        ...feat.map((n, i) => h('button', { type: 'button', class: 'cz-chip', 'aria-pressed': 'true', title: `Stop featuring ${n}`,
          text: `${i + 1}. ${n} ×`, onclick: () => toggle('featured', n, LIMITS.featured) })));
      for (const [name, r] of rows) {
        const f = inList('featured', name), hd = inList('hide', name);
        r.feat.setAttribute('aria-pressed', String(f));
        r.feat.disabled = !f && feat.length >= LIMITS.featured;
        r.hide.setAttribute('aria-pressed', String(hd));
        r.el.classList.toggle('is-hidden', hd);
        r.el.classList.toggle('is-edited', !!getIn(draft, ['repos', name]));
      }
    }
    // One building's settings: the same fields a repo's own .git-city/building.json takes.
    function editor(name) {
      const path = (...k) => ['repos', name, ...k];
      const setR = (p, v, after) => { setIn(draft, p, v); changed(); sync(); after?.(); };
      const input = (p, max, placeholder, after) => {
        const el = h('input', { type: 'text', value: getIn(draft, p) ?? '', maxLength: max, placeholder, oninput: () => setR(p, el.value, after) });
        return el;
      };
      const choose = (p, list, labels, after) => { // list[0] is the default and isn't stored
        const cur = getIn(draft, p) || list[0];
        const el = h('select', { onchange: () => setR(p, el.value === list[0] ? undefined : el.value, after) },
          ...list.map((v) => h('option', { value: v, text: labels[v] || v, selected: v === cur })));
        return el;
      };
      const paint = (p, fallback, label, after) => {
        const cur = getIn(draft, p);
        const pick = h('input', { type: 'color', value: cur || fallback, disabled: !cur, 'aria-label': label, oninput: () => setR(p, pick.value, after) });
        const on = h('input', { type: 'checkbox', checked: !!cur, 'aria-label': `Custom ${label.toLowerCase()}`, onchange: () => {
          pick.disabled = !on.checked;
          setR(p, on.checked ? pick.value : undefined, after);
        } });
        return h('span', { class: 'cz-colour' }, on, pick);
      };
      // Graffiti, previewed with the same painter as the walls (graffiti.js).
      const wall = h('canvas', { class: 'cz-graffiti', role: 'img', 'aria-label': 'Graffiti preview' });
      const redraw = () => {
        const g = getIn(draft, path('graffiti')) || {};
        const text = typeof g.text === 'string' ? g.text.trim().slice(0, LIMITS.graffiti) : '';
        wall.hidden = !text;
        if (text) paintGraffiti(wall, { text, color: /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : undefined, style: g.style }, `${forLogin}/${name}`);
      };
      const copyFile = h('button', { type: 'button', class: 'cz-mini', text: 'Copy as building.json', title: 'For the repository itself: .git-city/building.json', onclick: () => {
        const ctx = context();
        const { config } = normalizeCityConfig(draft, { repos: ctx?.repos, login: ctx?.login });
        copyText(serializeBuildingConfig(config?.repos[name] || {}), copyFile, 'Copy as building.json');
      } });
      const box = h('div', { class: 'cz-repo-edit' },
        row('Sign', input(path('sign'), LIMITS.sign, 'Shop sign text')),
        row('Billboard', input(path('billboard'), LIMITS.text, 'Country billboard text')),
        row('Building', choose(path('style'), OPTIONS.style, LABELS.style)),
        row('Roof', choose(path('roof'), OPTIONS.roof, LABELS.roof)),
        row('Facade', paint(path('color'), '#64dedb', 'Facade colour')),
        row('Neon', paint(path('neon'), '#ff5ab4', 'Neon colour'), 'The lit windows\' glow at night.'),
        row('Flag', input(path('flag'), LIMITS.flagCodePoints, 'GC or an emoji'), 'An emoji or up to 3 characters.'),
        row('Graffiti', input(path('graffiti', 'text'), LIMITS.graffiti, 'ship it!', redraw)),
        row('Spray style', choose(path('graffiti', 'style'), OPTIONS.graffiti, LABELS.graffiti, redraw)),
        row('Spray paint', paint(path('graffiti', 'color'), '#ff5ab4', 'Graffiti colour', redraw)),
        wall,
        h('div', { class: 'cz-actions' }, copyFile));
      redraw();
      return box;
    }
    for (const r of repos) {
      const name = r.name;
      const feat = h('button', { type: 'button', class: 'cz-mini cz-feat', text: '★', title: 'Feature: next to the plaza and first on the billboards', 'aria-label': `Feature ${name}`,
        onclick: () => toggle('featured', name, LIMITS.featured) });
      const hide = h('button', { type: 'button', class: 'cz-mini cz-hide', text: 'hide', title: 'Leave this repository out of the city', 'aria-label': `Hide ${name}`,
        onclick: () => toggle('hide', name, LIMITS.hide) });
      const body = h('div', { hidden: true });
      const edit = h('button', { type: 'button', class: 'cz-mini', text: 'edit', 'aria-expanded': 'false', 'aria-label': `Edit ${name}`, onclick: () => {
        const openNow = body.hidden;
        if (openNow && !body.childElementCount) body.append(editor(name));
        body.hidden = !openNow;
        edit.setAttribute('aria-expanded', String(openNow));
      } });
      const el = h('div', { class: 'cz-repo' },
        h('div', { class: 'cz-repo-head' },
          h('span', { class: 'nm', text: name, title: r.description || name }),
          h('span', { class: 'st', text: `★ ${r.stargazers_count || 0}` }), feat, hide, edit),
        body);
      rows.set(name, { el, feat, hide });
      list.append(el);
    }
    sync();
    return h('div', {}, featuredLine, filter, list,
      h('small', { class: 'cz-note', text: `Up to ${LIMITS.featured} featured and ${LIMITS.hide} hidden. Forks and archived repositories never get a building.` }));
  }

  // ---- publish ------------------------------------------------------------------
  function publishBlock() {
    els.primary = h('a', { class: 'cz-btn primary', target: '_blank', rel: 'noopener noreferrer' });
    els.copy = h('button', { type: 'button', class: 'cz-btn', text: 'Copy JSON', onclick: copyJson });
    els.pubNote = h('p', { class: 'cz-note' });
    els.alt = h('a', { class: 'cz-link', target: '_blank', rel: 'noopener noreferrer' });
    return h('div', { class: 'cz-publish' }, h('div', { class: 'cz-actions' }, els.primary, els.copy), els.pubNote, els.alt,
      h('p', { class: 'cz-note' }, forOrg ? 'Needs the organization\'s public repository ' : 'Needs your public profile repository ', h('b', { text: forRepo }),
        forOrg ? ' (the one that holds its profile README). ' : ' (the one that holds your profile README). ',
        h('a', { href: forOrg ? ORG_README_DOCS : PROFILE_README_DOCS, target: '_blank', rel: 'noopener noreferrer', text: forOrg ? 'How organization profiles work ↗' : 'How profile repositories work ↗' })));
  }
  function updatePublish(ctx) {
    if (!els.primary) return;
    const info = repoInfo.get(ctx.configRepo.toLowerCase());
    const branch = info?.branch || 'HEAD';
    els.alt.hidden = true;
    if (info?.exists === false) {
      els.primary.href = 'https://github.com/new';
      els.primary.textContent = `Create ${ctx.configRepo} ↗`;
      els.pubNote.textContent = `There is no ${ctx.configRepo} repository yet. Create a public repository named exactly "${ctx.configRepo.split('/')[1]}"${ctx.org ? ` in the ${ctx.login} organization` : ''}, then come back and press Publish.`;
    } else if (ctx.found) {
      els.primary.href = editFileUrl(ctx.configRepo, branch);
      els.primary.textContent = 'Edit city.json on GitHub ↗';
      els.pubNote.textContent = 'GitHub can\'t pre-fill an existing file: Copy JSON, open the editor, select everything, paste, and commit. The city updates within about 5 minutes.';
      els.alt.href = blobUrl(ctx.configRepo, branch);
      els.alt.textContent = `View the published ${CONFIG_PATH} ↗`;
      els.alt.hidden = false;
    } else {
      const url = newFileUrl(ctx.configRepo, lastJson, branch);
      const fits = url.length <= MAX_PREFILL_URL;
      els.primary.href = fits ? url : newFileUrl(ctx.configRepo, '', branch);
      els.primary.textContent = 'Publish on GitHub ↗';
      els.pubNote.textContent = fits
        ? `Opens GitHub's editor with ${CONFIG_PATH} filled in. Commit it to your default branch; the city updates within about 5 minutes. If GitHub says the file already exists, use Copy JSON and edit it instead.`
        : 'This config is too long to pre-fill in a link: Copy JSON, then paste it into the editor that opens.';
    }
  }
  // Default branch + whether the profile repo exists: one unauthenticated API call per login, per visit.
  async function lookupRepo(repo) { // "owner/name"
    const key = repo.toLowerCase();
    if (repoInfo.has(key)) return;
    repoInfo.set(key, { exists: null, branch: 'HEAD' });
    try {
      const res = await fetch(`https://api.github.com/repos/${repo.split('/').map(encodeURIComponent).join('/')}`,
        { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit' });
      if (res.status === 404) repoInfo.set(key, { exists: false, branch: 'HEAD' });
      else if (res.ok) {
        const d = await res.json();
        const b = typeof d?.default_branch === 'string' && /^[\w.\/-]{1,100}$/.test(d.default_branch) ? d.default_branch : 'HEAD';
        repoInfo.set(key, { exists: true, branch: b });
      } else repoInfo.delete(key); // rate-limited: HEAD for now, ask again next time
    } catch { repoInfo.delete(key); }
    const ctx = context();
    if (ctx?.configRepo === repo && root && !root.hidden) updatePublish(ctx);
  }
  async function copyText(text, btn, label) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const ta = h('textarea', { value: text, readOnly: true });
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    btn.textContent = ok ? 'Copied ✓' : 'Copy failed: select the text';
    setTimeout(() => { btn.textContent = label; }, 1800);
  }
  const copyJson = () => copyText(lastJson, els.copy, 'Copy JSON');
  // The browser's own zone first (you're most likely customizing from home), then every IANA zone.
  function timezoneField() {
    const cur = getIn(draft, ['look', 'timezone']);
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* old browser: just the current value */ }
    let mine = '';
    try { mine = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* no zone */ }
    if (cur && !zones.includes(cur)) zones = [cur, ...zones];
    const el = h('select', { onchange: () => set(['look', 'timezone'], el.value || undefined) },
      h('option', { value: '', text: 'Not set' }),
      mine ? h('option', { value: mine, text: `${mine} (this browser)`, selected: cur === mine }) : null,
      ...zones.filter((z) => z !== mine).map((z) => h('option', { value: z, text: z, selected: z === cur })));
    return el;
  }

  // ---- the panel ----------------------------------------------------------------
  function statusBlock(ctx) {
    const file = `${ctx.configRepo}/${CONFIG_PATH}`;
    const box = h('div', { class: 'cz-status' });
    if (ctx.found && !ctx.error) box.append(h('b', { text: 'Published. ' }), `Loaded ${file}.`);
    else if (ctx.found) { box.dataset.tone = 'bad'; box.append(h('b', { text: 'city.json ignored. ' }), ctx.error); }
    else if (ctx.error) { box.dataset.tone = 'warn'; box.append(h('b', { text: 'Couldn\'t check for city.json. ' }), ctx.error); }
    else box.append(h('b', { text: 'No city.json yet. ' }), 'This city is generated from the profile. Everything below is optional.');
    if (ctx.found && ctx.warnings?.length) {
      box.append(h('details', {}, h('summary', { text: `${ctx.warnings.length} setting${ctx.warnings.length === 1 ? '' : 's'} ignored in the published file` }),
        h('ul', { class: 'cz-warn' }, ...ctx.warnings.slice(0, 20).map((w) => h('li', { text: w })))));
    }
    return box;
  }
  const section = (title, openNow, ...kids) => h('details', { open: openNow }, h('summary', { text: title }), ...kids);

  function render(ctx) {
    for (const k of Object.keys(els)) delete els[k];
    els.json = h('pre', { class: 'cz-json', 'aria-label': 'city.json preview' });
    els.warn = h('ul', { class: 'cz-warn', hidden: true });
    const liveBox = h('input', { type: 'checkbox', checked: live, onchange: () => {
      live = liveBox.checked;
      clearTimeout(timer);
      if (live) { preview(draft); previewing = true; } else if (previewing) { restore(); previewing = false; }
      updatePill();
    } });
    root.replaceChildren(
      h('div', { class: 'cz-head' },
        h('div', {}, h('div', { class: 'eyebrow', text: 'Customize' }), h('div', { class: 'cz-title', text: `@${ctx.login}'s city` }),
          h('a', { class: 'cz-guide', href: GUIDE, target: '_blank', rel: 'noopener', text: 'How customizing works ↗' })),
        h('button', { type: 'button', class: 'cz-close', 'aria-label': 'Close', text: '×', onclick: close })),
      h('div', { class: 'cz-body' },
        statusBlock(ctx),
        section('Island', true,
          row('Name', textField(['island', 'name'], LIMITS.name, `${ctx.login}'s city`)),
          row('Biome', selectField(['island', 'biome'], OPTIONS.biome, LABELS.biome, 'Automatic (top language)')),
          row('City shape', selectField(['island', 'shape'], OPTIONS.shape, LABELS.shape, 'Automatic (from your login)')),
          row('Welcome', textField(['welcome'], LIMITS.text, 'Welcome to my city!', true), `Up to ${LIMITS.text} characters, on the welcome boards.`)),
        section('Landmarks', false, h('small', { class: 'cz-note', text: `Pick up to ${LIMITS.landmarks}; they're placed first, then the island tops up as usual.` }), landmarkPicker()),
        section('Look', false,
          row('Accent', colourField(['look', 'accent'], '#64dedb'), 'The plaza monument\'s glow.'),
          row('Time', selectField(['look', 'time'], OPTIONS.time, LABELS.time, 'Visitor\'s choice')),
          row('Weather', selectField(['look', 'weather'], OPTIONS.weather, LABELS.weather, 'Visitor\'s choice')),
          row('Old TV', flagField(['look', 'tv'], 'On', 'Off')),
          row('FX', flagField(['look', 'fx'], 'On (bloom, grade, grain)', 'Off')),
          row('Time zone', timezoneField(), 'Your local time drives the city\'s automatic day and night.'),
          h('small', { class: 'cz-note', text: 'These set how your city opens; visitors can still change them.' })),
        section('Neighbours', false, row('Logins', neighboursField(), `Up to ${LIMITS.neighbours}, reached by flying off the map. Topped up automatically.`)),
        section('Repositories', false, repoSection(ctx)),
        section('Player & plane', false,
          row('Music', selectField(['player', 'music'], OPTIONS.music, LABELS.music, 'Default')),
          row('Volume', volumeField()),
          row('Plane colour', colourField(['plane', 'color'], '#ef5b4c')),
          row('Plane name', textField(['plane', 'name'], LIMITS.planeName, 'Spirit of Rebase'))),
        h('div', { class: 'cz-preview' },
          h('label', {}, liveBox, ' Live preview on the island'),
          h('button', { type: 'button', class: 'cz-mini', text: 'Revert', title: 'Discard the draft and show the published city', onclick: revert })),
        h('div', { class: 'eyebrow dim cz-sub', text: CONFIG_PATH }),
        els.json, els.warn,
        publishBlock()));
    changed();
  }

  return {
    open, close, reset,
    get isOpen() { return !!root && !root.hidden; },
    get previewing() { return previewing; },
  };
}

// ---- styles (the app's card / accent / mono language) ------------------------
let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const css = `
#cz { position: fixed; z-index: 46; top: calc(var(--topbar-h, 58px) + 12px); left: 20px; bottom: calc(var(--transport-h, 90px) + 12px);
  width: 390px; max-width: calc(100vw - 40px); display: flex; flex-direction: column;
  background: rgba(17, 24, 36, 0.96); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 16px 50px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); font-family: var(--mono); font-size: 12px; color: var(--ink-300); }
#cz[hidden], #cz-pill[hidden], #cz [hidden] { display: none !important; }
#cz .cz-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; border-bottom: 1px solid var(--line); }
#cz .cz-title { font-family: var(--display); font-size: 18px; font-weight: 700; color: var(--ink-100); word-break: break-all; margin-top: 2px; }
#cz .cz-close { background: none; border: 0; color: var(--ink-500); font-size: 22px; line-height: 1; cursor: pointer; padding: 0 2px; }
#cz .cz-close:hover { color: var(--ink-100); }
#cz .cz-body { overflow-y: auto; padding: 12px 16px 16px; overscroll-behavior: contain; touch-action: pan-y; }
#cz .cz-status { border-left: 3px solid var(--accent); background: rgba(255, 255, 255, 0.03); border-radius: 6px; padding: 8px 10px; line-height: 1.55; margin-bottom: 6px; word-break: break-word; }
#cz .cz-status b { color: var(--ink-100); }
#cz .cz-status[data-tone="bad"] { border-left-color: #ff7a8a; }
#cz .cz-status[data-tone="warn"] { border-left-color: var(--orange); }
#cz .cz-status summary { cursor: pointer; color: var(--orange); margin-top: 4px; }
#cz details { border-top: 1px solid var(--line); padding: 6px 0; }
#cz details > summary { cursor: pointer; list-style: none; padding: 6px 0; font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); }
#cz details > summary::-webkit-details-marker { display: none; }
#cz details > summary::before { content: "▸ "; display: inline-block; width: 1.2em; }
#cz details[open] > summary::before { content: "▾ "; }
#cz .cz-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); align-items: center; gap: 8px; margin: 8px 0; }
#cz .cz-lab { color: var(--ink-500); font-size: 11px; }
#cz .cz-ctl { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
#cz .cz-ctl small, #cz .cz-note { color: var(--ink-500); font-size: 10.5px; line-height: 1.5; }
#cz .cz-note a, #cz .cz-link { color: var(--accent); }
#cz .cz-link { display: inline-block; margin-top: 6px; font-size: 11px; }
#cz input[type="text"], #cz input[type="search"], #cz select, #cz textarea {
  width: 100%; min-width: 0; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 6px;
  color: var(--ink-100); padding: 7px 9px; font: inherit; font-size: 12px; }
#cz textarea { resize: vertical; min-height: 54px; font-family: var(--display); font-size: 13px; line-height: 1.4; }
#cz input:focus, #cz select:focus, #cz textarea:focus { outline: none; border-color: var(--accent-dim); }
#cz .cz-colour { display: flex; align-items: center; gap: 8px; }
#cz input[type="color"] { width: 46px; height: 28px; padding: 0 2px; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }
#cz input[type="color"]:disabled, #cz input[type="range"]:disabled { opacity: 0.35; cursor: default; }
#cz input[type="range"] { flex: 1; accent-color: var(--accent); }
#cz input[type="checkbox"] { accent-color: var(--accent); width: 15px; height: 15px; }
#cz output { min-width: 2.5em; text-align: right; color: var(--ink-100); }
#cz .cz-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; align-items: center; }
#cz .cz-chip { background: rgba(255, 255, 255, 0.05); border: 1px solid var(--line); color: var(--ink-300); border-radius: 999px;
  padding: 5px 10px; font: inherit; font-size: 11px; cursor: pointer; }
#cz .cz-chip:hover { border-color: var(--accent-dim); color: var(--ink-100); }
#cz .cz-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
#cz .cz-chip:disabled { opacity: 0.4; cursor: default; }
#cz .cz-lm-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0 6px; font-size: 11px; color: var(--ink-300); }
#cz .cz-lm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; margin-bottom: 6px; }
#cz .cz-lm { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 6px 6px 8px; text-align: left; min-width: 0;
  background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); border-radius: 10px; color: var(--ink-300); font: inherit; cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s; }
#cz .cz-lm:hover:not(:disabled) { border-color: var(--accent-dim); color: var(--ink-100); transform: translateY(-1px); }
#cz .cz-lm:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#cz .cz-lm[aria-pressed="true"] { border-color: var(--accent); background: rgba(100, 222, 219, 0.12); color: var(--ink-100); }
#cz .cz-lm:disabled { opacity: 0.38; cursor: default; }
#cz .cz-lm-pic { position: relative; display: block; aspect-ratio: 4 / 3; border-radius: 7px; overflow: hidden;
  background: radial-gradient(ellipse at 50% 28%, #cfe4f4, #9fc6e0 70%); }
#cz .cz-lm:not(.has-pic) .cz-lm-pic { animation: cz-lm-wait 1.1s ease-in-out infinite alternate; }
#cz .cz-lm-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity 0.35s; }
#cz .cz-lm.has-pic .cz-lm-img { opacity: 1; }
#cz .cz-lm-badge { position: absolute; top: 5px; left: 5px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
  background: var(--accent); color: var(--accent-ink); font-size: 11px; font-weight: 700; line-height: 20px; text-align: center; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); }
#cz .cz-lm-badge:empty { display: none; }
#cz .cz-lm-name { margin-top: 4px; font-size: 12px; line-height: 1.25; color: inherit; overflow-wrap: anywhere; }
#cz .cz-lm-where { font-size: 10px; line-height: 1.2; color: var(--ink-500); }
@keyframes cz-lm-wait { from { opacity: 0.55; } to { opacity: 1; } }
#cz .cz-featured .cz-lab { width: 100%; }
#cz .cz-repos { max-height: 280px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; margin: 8px 0 6px; overscroll-behavior: contain; }
#cz .cz-repo + .cz-repo { border-top: 1px solid var(--line); }
#cz .cz-repo-head { display: flex; align-items: center; gap: 4px; padding: 4px 6px 4px 10px; }
#cz .cz-repo .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-100); }
#cz .cz-repo .st { color: var(--ink-500); font-size: 10px; margin-right: 2px; }
#cz .cz-repo.is-edited .nm::after { content: " ●"; color: var(--purple); font-size: 9px; }
#cz .cz-repo.is-hidden .nm { color: var(--ink-500); text-decoration: line-through; }
#cz .cz-mini { background: none; border: 1px solid transparent; color: var(--ink-500); border-radius: 5px; padding: 4px 7px; font: inherit; font-size: 11px; cursor: pointer; }
#cz .cz-mini:hover { color: var(--ink-100); border-color: var(--line); }
#cz .cz-feat[aria-pressed="true"] { color: var(--orange); border-color: rgba(255, 160, 58, 0.45); }
#cz .cz-hide[aria-pressed="true"] { color: var(--ink-100); border-color: var(--line); background: rgba(255, 255, 255, 0.06); }
#cz .cz-mini:disabled { opacity: 0.35; cursor: default; }
#cz .cz-repo-edit { padding: 0 10px 8px; }
#cz canvas.cz-graffiti { display: block; width: 100%; height: auto; margin: 6px 0 2px; border-radius: 6px; border: 1px solid var(--line);
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.1) 1px, transparent 1px) 0 0 / 100% 18px,
    linear-gradient(90deg, rgba(0, 0, 0, 0.07) 1px, transparent 1px) 0 0 / 36px 100%, #cdbba5; }
#cz .cz-guide { display: inline-block; margin-top: 4px; color: var(--accent); font-size: 11px; text-decoration: none; }
#cz .cz-guide:hover { text-decoration: underline; }
#cz .cz-preview { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid var(--line); padding: 10px 0 4px; color: var(--ink-100); }
#cz .cz-preview label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
#cz .cz-sub { margin: 10px 0 6px; }
#cz .cz-json { max-height: 220px; overflow: auto; margin: 0; padding: 10px 12px; background: #0b111a; border: 1px solid var(--line); border-radius: 8px;
  color: var(--ink-300); font: inherit; font-size: 11px; line-height: 1.5; white-space: pre; user-select: text; }
#cz .cz-warn { color: var(--orange); margin: 6px 0 0 16px; font-size: 11px; line-height: 1.5; word-break: break-word; }
#cz .cz-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
#cz .cz-btn { flex: 1 1 auto; text-align: center; text-decoration: none; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--panel2); color: var(--ink-100); font: inherit; font-weight: 600; cursor: pointer; }
#cz .cz-btn:hover { filter: brightness(1.1); }
#cz .cz-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
#cz .cz-publish .cz-note { margin: 8px 0 0; }
#cz-pill { position: fixed; z-index: 44; top: calc(var(--topbar-h, 58px) + 10px); left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; padding: 5px 5px 5px 14px; border-radius: 999px; white-space: nowrap;
  background: rgba(17, 24, 36, 0.95); border: 1px solid rgba(140, 120, 255, 0.55); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  font-family: var(--mono); font-size: 12px; color: var(--ink-100); }
#cz-pill button { background: var(--panel2); border: 1px solid var(--line); color: var(--ink-100); border-radius: 999px; padding: 5px 11px; font: inherit; cursor: pointer; }
#cz-pill button:hover { border-color: var(--purple); }
#cz-toast { position: fixed; z-index: 47; left: 50%; bottom: calc(var(--transport-h, 90px) + 18px); transform: translate(-50%, 8px);
  max-width: min(560px, calc(100vw - 24px)); padding: 10px 16px; border-radius: 10px; background: rgba(17, 24, 36, 0.96);
  border: 1px solid var(--line); border-left: 3px solid var(--accent); box-shadow: 0 12px 34px rgba(0, 0, 0, 0.4);
  font-family: var(--mono); font-size: 12px; line-height: 1.5; color: var(--ink-100); word-break: break-word;
  opacity: 0; pointer-events: none; transition: opacity 0.25s, transform 0.25s; }
#cz-toast.show { opacity: 1; transform: translate(-50%, 0); }
#guide-link { display: inline-block; margin: -8px 0 12px; font-family: var(--mono); font-size: 11px; color: var(--accent);
  text-decoration: none; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); }
#guide-link:hover { text-decoration: underline; }
/* The toolbar grew (Customize): shed the developer pills a little earlier so it never clips. */
@media (min-width: 901px) and (max-width: 1480px) { #examples { display: none; } }
#cz-toast[data-tone="bad"] { border-left-color: #ff7a8a; }
#cz-toast[data-tone="warn"] { border-left-color: var(--orange); }
@media (max-width: 900px), (max-height: 500px) {
  #cz { top: auto; left: 0; right: 0; bottom: 0; width: 100%; max-width: none; max-height: 84dvh; border-radius: 16px 16px 0 0;
    padding-bottom: env(safe-area-inset-bottom); }
  #cz input[type="text"], #cz input[type="search"], #cz select, #cz textarea { font-size: 16px; } /* no iOS zoom on focus */
  #cz .cz-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  #cz .cz-mini { padding: 8px 9px; }
  #cz .cz-chip { padding: 8px 12px; }
  #cz .cz-close { width: 44px; height: 44px; margin: -10px -12px 0 0; }
  #cz-pill { top: auto; bottom: calc(var(--transport-h, 90px) + 10px); }
  #guide-link { display: none; } /* the peek card stays one line; the Customize panel links the guide */
}
@media (prefers-reduced-motion: reduce) { #cz-toast { transition: none; } }
`;
  document.head.append(h('style', { id: 'cz-style', text: css }));
}
