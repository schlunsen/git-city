/*
 * Gitilla: the "Customize your city" guide page (customize.html).
 * Example tabs, copy buttons, and the field reference tables, generated from
 * the JSON Schemas so the page can't drift from what Gitilla accepts.
 * DOM text only (textContent); no innerHTML.
 */

// ---- tabs --------------------------------------------------------------------
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      select(next); next.focus();
    });
  });
}

// ---- copy buttons ------------------------------------------------------------------
for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy)?.textContent || '';
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(btn.dataset.copy));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    btn.textContent = ok ? 'Copied ✓' : 'Selected: press Ctrl+C';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
  });
}

// ---- field reference from the JSON Schemas ---------------------------------------------
const LIMIT_NOTES = { color: '#rrggbb', login: 'GitHub login', repo: 'your repository name' };
function allowed(d, schema) {
  const ref = d.$ref && d.$ref.split('/').pop();
  if (ref && LIMIT_NOTES[ref]) return LIMIT_NOTES[ref];
  if (d.const !== undefined) return String(d.const);
  if (d.enum) return d.enum.join(' · ');
  if (d.type === 'boolean') return 'true · false';
  if (d.type === 'number') return `${d.minimum ?? ''}–${d.maximum ?? ''}`;
  if (d.type === 'string') return d.maxLength ? `text, ≤ ${d.maxLength}` : 'text';
  if (d.type === 'array') {
    const item = d.items ? allowed(d.items, schema) : '';
    return `list of ${item.includes('·') ? 'names' : item}, ≤ ${d.maxItems}`;
  }
  if (d.type === 'object') return 'object';
  return '';
}
function rows(props, schema, prefix = '') {
  const out = [];
  for (const [key, d] of Object.entries(props)) {
    if (key === '$schema') continue;
    const name = prefix + key;
    if (d.type === 'object' && d.properties) {
      out.push(...rows(d.properties, schema, `${name}.`));
    } else if (d.type === 'object' && d.additionalProperties?.properties) {
      out.push([`${name}["<name>"]`, `≤ ${d.maxProperties} entries`, `${d.description || ''} Fields: see the building table below.`]);
    } else {
      out.push([name, allowed(d, schema), d.description || '']);
    }
  }
  return out;
}
async function fill(tableId, url) {
  const body = document.querySelector(`#${tableId} tbody`);
  try {
    const res = await fetch(url);
    const schema = await res.json();
    const list = rows(schema.properties, schema);
    body.replaceChildren(...list.map((cells) => {
      const tr = document.createElement('tr');
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.append(td); }
      return tr;
    }));
  } catch {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = 3; td.textContent = 'Couldn\'t load the schema: see docs/city-config.md on GitHub.';
    tr.append(td); body.replaceChildren(tr);
  }
}
fill('ref-city', './schema/city-config.v1.json');
fill('ref-building', './schema/building-config.v1.json');
