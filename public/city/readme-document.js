// Full README text for the in-game reader. The spelling is resolved once per
// repository by readme-source, and shared with the showcase TV, so opening the
// reader for a repo the TV has already shown costs no request at all.
import { readmeSource } from './readme-source.js';

const LIMIT = 100000;
export async function readmeDocument(repo) {
  const found = await readmeSource(repo?.full_name);
  if (found.status !== 'ready') return { status: found.status, markdown: '' };
  return {
    status: 'ready',
    markdown: found.markdown.slice(0, LIMIT),
    truncated: found.markdown.length > LIMIT,
  };
}

export function readmeLink(raw, repo) {
  try {
    const url = new URL(raw, `https://github.com/${repo.full_name}/blob/HEAD/README.md`);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

// A deliberately small Markdown reader: content becomes text/DOM nodes, never
// innerHTML. Keep prose, headings, lists, tables and fenced code readable.
export function readmeBlocks(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++; blocks.push({ type: 'code', text: code.join('\n'), language: fence[2].trim() }); continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); i++; continue; }
    if (i + 1 < lines.length && /^\s*(={3,}|-{3,})\s*$/.test(lines[i + 1])) {
      blocks.push({ type: 'heading', level: lines[i + 1].trim()[0] === '=' ? 1 : 2, text: line }); i += 2; continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push({type:'rule'}); i++; continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const row = s => s.trim().replace(/^\||\|$/g, '').split('|').map(c=>c.trim());
      const rows = [row(line)]; i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(row(lines[i++]));
      blocks.push({ type: 'table', rows }); continue;
    }
    const item = line.match(/^\s*(?:[-*+] |\d+\. )(.+)/);
    if (item) { blocks.push({ type: 'item', text: item[1], ordered: /^\s*\d/.test(line) }); i++; continue; }
    if (/^\s*>/.test(line)) { blocks.push({ type:'quote', text:line.replace(/^\s*>\s?/, '') }); i++; continue; }
    // A raw HTML run (centred logos, badge strips, <picture> screenshots): read it
    // whole, because its tags wrap over several lines. Pictures become image blocks
    // in document order; the formatting goes, the visible prose stays.
    if (/^\s*</.test(line)) {
      const html = [];
      while (i < lines.length && lines[i].trim()) html.push(lines[i++]);
      for (const block of htmlBlocks(html.join('\n'))) blocks.push(block);
      continue;
    }
    const text = line.replace(/<[^>]*>/g, '').trim();
    if (text) {
      const prev = blocks.at(-1);
      if (prev?.type === 'paragraph' && i > 0 && lines[i - 1].trim()) prev.text += ' ' + text;
      else blocks.push({ type: 'paragraph', text });
    }
    i++;
  }
  return blocks;
}

// Pull the pictures (and the links wrapped around them) out of a raw HTML run,
// keeping them in order with whatever prose sits between them.
const IMG_TAG = /(?:<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>\s*)?<img\b([^>]*?)\/?>/gi;
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '';
export function htmlBlocks(html) {
  const blocks = [];
  const prose = (raw) => {
    const text = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ type: 'paragraph', text });
  };
  let end = 0;
  for (const match of html.matchAll(IMG_TAG)) {
    prose(html.slice(end, match.index));
    end = match.index + match[0].length;
    const src = attr(match[2], 'src');
    if (src) blocks.push({ type: 'image', src, alt: attr(match[2], 'alt'), href: match[1] || '' });
  }
  prose(html.slice(end));
  return blocks;
}
