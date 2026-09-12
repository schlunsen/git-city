import { readmeImage } from './city/readme.js';
import { readmeBlocks, readmeLink } from './city/readme-document.js';

function inline(parent, text, repo) {
  const tokens = /(`[^`]+`|\*\*[^*]+\*\*|!\[[^\]]*\]\([^\s)]+\)|\[[^\]]+\]\([^\s)]+\))/g;
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(document.createTextNode(text.slice(end, match.index)));
    const token = match[0];
    if (token.startsWith('`') || token.startsWith('**')) {
      const node = document.createElement(token[0] === '`' ? 'code' : 'strong');
      node.textContent = token[0] === '`' ? token.slice(1,-1) : token.slice(2,-2); parent.append(node);
    } else {
      const link = token.match(/^!?\[([^\]]*)\]\(([^)]+)\)$/);
      if (token.startsWith('!')) {
        const src = readmeImage(token, repo.full_name);
        if (src) {
          const img = document.createElement('img'); img.alt = link[1]; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
          img.src = src; img.addEventListener('error', () => img.remove()); parent.append(img);
        }
      } else {
        const href = readmeLink(link[2], repo);
        const node = document.createElement(href ? 'a' : 'span'); node.textContent = link[1];
        if (href) { node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
        parent.append(node);
      }
    }
    end = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(end)));
}
export function renderReadme(root, markdown, repo) {
  root.replaceChildren();
  let list = null;
  for (const block of readmeBlocks(markdown)) {
    if (block.type !== 'item') list = null;
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
