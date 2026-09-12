// Full README text for the in-game reader. Successful downloads are shared by
// repeat visits; failures stay retryable and one timeout covers all spellings.
const cache = new Map();
export async function readmeDocument(repo) {
  const key = repo?.full_name;
  if (!/^[\w.-]+\/[\w.-]+$/.test(key || '')) return { status: 'missing', markdown: '' };
  if (cache.has(key)) return cache.get(key);
  const request = (async () => {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      for (const name of ['README.md', 'readme.md', 'README.MD', 'README']) {
        const response = await fetch(`https://raw.githubusercontent.com/${key}/HEAD/${name}`, { signal: ctrl.signal });
        if (response.status === 404) continue;
        if (!response.ok) throw new Error('README unavailable');
        const text = await response.text();
        return { status: 'ready', markdown: text.slice(0, 100000), truncated: text.length > 100000 };
      }
      return { status: 'missing', markdown: '' };
    } catch { return { status: 'error', markdown: '' }; }
    finally { clearTimeout(timer); }
  })();
  cache.set(key, request);
  const result = await request;
  if (result.status !== 'ready') cache.delete(key);
  return result;
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
    // Raw HTML formatting is omitted, while its visible prose is retained.
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
