import { readmeBlocks, readmeLink } from './city/readme-document.js';

// Pictures in the full reader, unlike the showcase TV's single screenshot, are
// whatever the README points at: screenshots, logos and the badge strip a project
// leads with. Every request goes out with no referrer and nothing is ever run, so
// a third-party host only ever sees an image fetch.
const BADGE = /badge|shields\.io|badgen|forthebadge|travis|circleci|codecov|coveralls|gitter|sponsor|opencollective|patreon|buymeacoffee|visitor|hits\./i;
export function readmeAsset(raw, fullName) {
  const src = String(raw || '').trim().replace(/^<|>$/g, '');
  if (!src) return '';
  let url;
  try {
    url = /^[a-z][a-z0-9+.-]*:/i.test(src) ? new URL(src)
      : new URL(src.replace(/^\.?\//, ''), `https://raw.githubusercontent.com/${fullName}/HEAD/`);
  } catch { return ''; }
  if (url.protocol !== 'https:') return ''; // no http, and never javascript: / data:
  // github.com/<o>/<r>/blob/<ref>/<path> serves HTML, not the file: use the raw host.
  const blob = url.hostname === 'github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
  return blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}` : url.href;
}
export function readmePicture(src, alt, href, repo) {
  const url = readmeAsset(src, repo.full_name);
  if (!url) return null;
  const img = document.createElement('img');
  img.alt = alt || ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  if (BADGE.test(url)) img.className = 'gri-badge';
  // Small pictures are badges and icons however they are spelled: let them sit in a row.
  img.addEventListener('load', () => { if (img.naturalHeight && img.naturalHeight <= 48) img.classList.add('gri-badge'); });
  img.addEventListener('error', () => (img.parentElement?.classList.contains('gri-shot') ? img.parentElement : img).remove());
  img.src = url;
  const link = href && readmeLink(href, repo);
  if (!link) return img;
  const anchor = document.createElement('a');
  anchor.href = link; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.append(img);
  return anchor;
}

// `code`, **bold**, ![picture](src), [![badge](src)](href) and [text](href).
const TOKENS = /(`[^`]+`|\*\*[^*]+\*\*|\[!\[[^\]]*\]\([^\s)]+\)\]\([^\s)]+\)|!\[[^\]]*\]\([^\s)]+\)|\[[^\]]+\]\([^\s)]+\))/g;
function inline(parent, text, repo) {
  let end = 0;
  for (const match of text.matchAll(TOKENS)) {
    parent.append(document.createTextNode(text.slice(end, match.index)));
    const token = match[0];
    end = match.index + token.length;
    if (token[0] === '`') {
      const node = document.createElement('code'); node.textContent = token.slice(1, -1); parent.append(node); continue;
    }
    if (token.startsWith('**')) { // bold often wraps a link: **[Guide](docs/guide.md)**
      const node = document.createElement('strong'); inline(node, token.slice(2, -2), repo); parent.append(node); continue;
    }
    const badge = token.match(/^\[!\[([^\]]*)\]\(\s*<?([^)\s>]+)[^)]*\)\]\(\s*<?([^)\s>]+)[^)]*\)$/);
    if (badge) { parent.append(readmePicture(badge[2], badge[1], badge[3], repo) || ''); continue; }
    const link = token.match(/^!?\[([^\]]*)\]\(\s*<?([^)\s>]+)[^)]*\)$/);
    if (!link) { parent.append(document.createTextNode(token)); continue; }
    if (token.startsWith('!')) { parent.append(readmePicture(link[2], link[1], '', repo) || ''); continue; }
    const href = readmeLink(link[2], repo);
    const node = document.createElement(href ? 'a' : 'span');
    inline(node, link[1], repo); // link labels carry `code` and **bold** of their own
    if (href) { node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    parent.append(node);
  }
  parent.append(document.createTextNode(text.slice(end)));
}
export function renderReadme(root, markdown, repo) {
  root.replaceChildren();
  let list = null, media = null;
  for (const block of readmeBlocks(markdown)) {
    if (block.type !== 'item') list = null;
    if (block.type !== 'image') media = null;
    // Runs of pictures (a logo, then the badge strip) share one centred row.
    if (block.type === 'image') {
      if (!media) { media = document.createElement('div'); media.className = 'gri-shot'; root.append(media); }
      media.append(readmePicture(block.src, block.alt, block.href, repo) || '');
      continue;
    }
    if (block.type === 'code') {
      const pre=document.createElement('pre'), code=document.createElement('code');
      code.textContent=block.text; pre.append(code); root.append(pre); continue;
    }
    if (block.type === 'table') {
      const wrap=document.createElement('div'), table=document.createElement('table'); wrap.className='gri-table';
      block.rows.forEach((row,i)=>{const tr=document.createElement('tr'); row.forEach(cell=>{const td=document.createElement(i?'td':'th');inline(td,cell,repo);tr.append(td);});table.append(tr);});
      wrap.append(table);root.append(wrap);continue;
    }
    if (block.type === 'item') {
      const tag=block.ordered?'OL':'UL';
      if (list?.tagName!==tag) {list=document.createElement(tag);root.append(list);}
      const li=document.createElement('li');inline(li,block.text,repo);list.append(li);continue;
    }
    const node=document.createElement(block.type==='heading'?`h${Math.min(4,block.level+1)}`:block.type==='quote'?'blockquote':block.type==='rule'?'hr':'p');
    if (block.text) inline(node,block.text,repo);root.append(node);
  }
}
