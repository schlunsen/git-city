/*
 * README excerpts for the showcase TV.
 */

// README excerpts for the showcase TV: fetched from raw.githubusercontent.com
// (no API quota), cached per repo. Text is plain text only (never HTML). The
// picture is the README's first real image, and only if GitHub hosts it —
// visitors' browsers never fetch from arbitrary sites a README points at.
const readmeCache = new Map();
export const readmeKnown = new Map(); // resolved excerpts, readable synchronously (the tour plans stop lengths with it)
const README_IMG_HOSTS = new Set(['raw.githubusercontent.com', 'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com', 'camo.githubusercontent.com', 'github.com']);
export function readmeExcerpt(repo) {
  const key = repo?.full_name;
  if (!key) return Promise.resolve({ text: '', image: '' });
  if (!readmeCache.has(key)) readmeCache.set(key, (async () => {
    // Raw URLs are case-sensitive: README.md is most common, readme.md next (e.g. sindresorhus).
    for (const name of ['README.md', 'readme.md']) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${key}/HEAD/${name}`, { signal: ctrl.signal });
        if (r.ok) {
          const md = (await r.text()).slice(0, 30000);
          const found = { text: markdownExcerpt(md), image: readmeImage(md, key) };
          readmeKnown.set(key, found);
          return found;
        }
      } catch { /* offline or slow: try the next spelling */ } finally { clearTimeout(to); }
    }
    readmeKnown.set(key, { text: '', image: '' });
    return readmeKnown.get(key);
  })());
  return readmeCache.get(key);
}
export function readmeImage(md, fullName) {
  const srcs = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)) srcs.push([m.index, m[1]]);
  for (const m of md.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) srcs.push([m.index, m[1]]);
  srcs.sort((a, b) => a[0] - b[0]);
  for (const [, raw] of srcs) {
    const src = raw.trim();
    if (/badge|shields\.io|travis|circleci|codecov|coveralls|gitter|sponsor|backer|opencollective|donate|patreon|buymeacoffee/i.test(src)) continue;
    let url;
    try {
      url = /^https?:\/\//i.test(src) ? new URL(src)
        : new URL(src.replace(/^\.?\//, ''), `https://raw.githubusercontent.com/${fullName}/HEAD/`);
    } catch { continue; }
    if (url.protocol !== 'https:' || !README_IMG_HOSTS.has(url.hostname)) continue;
    if (url.hostname === 'github.com') {
      // github.com/<o>/<r>/blob/<ref>/<path> -> raw; user-attachments pass through.
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
      if (m) url = new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`);
      else if (!url.pathname.startsWith('/user-attachments/')) continue;
    }
    return url.href;
  }
  return '';
}
export function markdownExcerpt(md) {
  const text = md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    // Whole HTML blocks (centred logos, sponsor strips, badge tables) are chrome, not prose.
    .replace(/<(div|p|table|picture|details|center|h[1-6]|sup|sub)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')   // linked badges
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                // images
    .replace(/<[^>]*>/g, ' ')                             // stray html
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // links -> their text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&[a-z]+;|&#\d+;/gi, ' ');
  const paras = text.split(/\n\s*\n/)
    .map((p) => p.replace(/^\s{0,3}(#+|>|[-*+]|\d+\.)\s*/gm, '').replace(/[*_`~|]/g, '').replace(/\s+/g, ' ').trim())
    .filter((p) => {
      const words = p.split(' ');
      if (words.length < 8 || !/[a-z]{3}/.test(p) || /^(table of contents|contents)\b/i.test(p)) return false;
      if (!/[.!?:;,]/.test(p)) return false; // prose, not a row of link labels
      const caps = words.filter((w) => /^[A-Z]/.test(w)).length;
      return caps / words.length < 0.6 && !/\bsponsor(ed|s)?\b/i.test(p);
    });
  const out = paras.slice(0, 2).join(' ');
  return out.length > 460 ? `${out.slice(0, 457).trimEnd()}…` : out;
}
