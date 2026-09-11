/*
 * HUD cards: the profile explorer (stats, tallest towers, legend) and the
 * activity feed.
 */
import { $, escapeHtml, fmtNum, prettify } from './util.js';
import { KIND_COLORS, langHex } from './constants.js';
import { updateDevClock } from './timezone.js';
import { dateParts } from '../history.js';

export function renderExplorer(user, repos) {
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const langCount = {};
  for (const r of repos) {
    if (!r.language) continue;
    const k = r.language.toLowerCase();
    langCount[k] = (langCount[k] || 0) + 1;
  }
  const langs = Object.entries(langCount).sort((a, b) => b[1] - a[1]);
  const topLang = langs[0]?.[0];
  $('hud-login').textContent = user.login;
  $('hud-status').innerHTML = `${repos.length} repos · <span class="live">fetching activity…</span>`;
  $('stat-card').innerHTML = `
    <div class="head"><span class="dot"></span>${escapeHtml(user.name || 'Profile')}</div>
    <div class="row"><span>Repositories</span><b class="tnum">${repos.length}</b></div>
    <div class="row"><span>Stars</span><b class="tnum">${fmtNum(totalStars)}</b></div>
    <div class="row"><span>Followers</span><b class="tnum">${fmtNum(user.followers)}</b></div>
    <div class="row"><span>Top language</span><b>${topLang ? escapeHtml(prettify(topLang)) : '—'}</b></div>
    <div class="row"><span>Local time</span><b class="tnum" id="dev-time">—</b></div>`;
  updateDevClock();
  renderTopCard('Tallest towers', repos.slice(0, 5).map(r => ({
    full_name: r.full_name, name: r.name, language: r.language, value: `★ ${fmtNum(r.stargazers_count)}`,
  })), 'var(--orange)');
  $('legend-rows').innerHTML = langs.slice(0, 8).map(([lang]) =>
    `<div class="row"><span class="swatch" style="background:${langHex(lang)}"></span>${escapeHtml(prettify(lang))}</div>`
  ).join('') || '<div class="row">—</div>';
}

export function renderTopCard(title, rows, dot) {
  $('top-card').innerHTML =
    `<div class="head"><span class="dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>${escapeHtml(title)}</div>` +
    rows.map(r => `<div class="row repo" data-repo="${escapeHtml(r.full_name || '')}" title="Focus ${escapeHtml(r.name)}">
      <span class="nm"><span class="sw" style="background:${langHex(r.language)}"></span>${escapeHtml(r.name)}</span>
      <b class="tnum">${escapeHtml(r.value)}</b></div>`).join('');
}

export function announceStep(step) {
  const feed = $('feed');
  const card = document.createElement('div');
  card.className = 'card feed-card';
  card.style.setProperty('--c', KIND_COLORS[step.label] || '#c2cad8');
  const short = step.repo.split('/').pop();
  const meta = step.kind === 'PushEvent'
    ? `${step.commits} commit${step.commits === 1 ? '' : 's'}`
    : step.count > 1 ? `${step.verb} ×${step.count}` : step.verb;
  card.innerHTML = `<div class="fc-kind">${escapeHtml(step.label)}</div>
    <div class="fc-repo">${escapeHtml(short)}</div>
    <div class="fc-meta">${escapeHtml(meta)} · ${dateParts(step.ts).iso}</div>
    ${step.commits > 1 ? `<div class="fc-n">${step.commits}</div>` : ''}`;
  feed.prepend(card);
  while (feed.children.length > 4) feed.lastElementChild.remove();
  [...feed.children].forEach((c, i) => c.classList.toggle('fading', i >= 3));
}
export function clearFeed() { $('feed').innerHTML = ''; }
