import { pickNearbyRepo } from './city/nearby-repo.js';
import { readmeDocument } from './city/readme-document.js';
import { renderReadme } from './readme-reader.js';
import { fmtNum } from './city/util.js';

export function createRepoInspector(THREE, { camera, buildings, onOpen, onClose }) {
  const prompt = document.createElement('button');
  prompt.type = 'button'; prompt.className = 'gri-prompt'; prompt.hidden = true;
  prompt.innerHTML = '<span class="gri-eyebrow">NEARBY REPOSITORY</span><strong></strong><span class="gri-summary"></span><span class="gri-action"><kbd>E</kbd> Inspect repo <span>↗</span></span>';
  const dialog = document.createElement('dialog'); dialog.className = 'gri-dialog';
  dialog.setAttribute('aria-labelledby', 'gri-title');
  dialog.innerHTML = `<button class="gri-close" type="button" aria-label="Close repository details">×</button>
    <header class="gri-header"><div class="gri-eyebrow">▣ REPO FIELD GUIDE <span class="gri-status">PAUSED</span></div><h2 id="gri-title"></h2><p class="gri-owner"></p></header>
    <nav class="gri-tabs" aria-label="Repository views"><button type="button" data-view="overview" aria-pressed="true">01 / Overview</button><button type="button" data-view="readme" aria-pressed="false">02 / README <kbd>R</kbd></button></nav>
    <div class="gri-content"><section class="gri-overview"><p class="gri-description"></p><p class="gri-stats"></p><p class="gri-updated"></p><p class="gri-reader-hint">Get to know the project. Open its README for setup instructions, examples, and documentation.</p></section>
    <section class="gri-readme" hidden><p class="gri-readme-status" role="status"></p><button type="button" class="gri-retry" hidden>Retry README</button><article class="gri-markdown" aria-label="Repository README"></article></section></div>
    <footer class="gri-footer"><a class="gri-github" target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a><button class="gri-resume" type="button">Continue exploring <kbd>Esc</kbd></button><span class="gri-footer-note">Your position is saved while you read.</span></footer>`;
  const style = document.createElement('style');
  style.textContent = `
    .gri-prompt,.gri-dialog{box-sizing:border-box;color:#e5f3f4;background:rgba(12,24,34,.96);border:1px solid #4ca4a8;border-radius:14px;box-shadow:0 10px 35px #0006;font:13px system-ui,sans-serif}
    .gri-prompt{position:fixed;z-index:36;right:20px;bottom:155px;width:290px;text-align:left;padding:16px;cursor:pointer}
    .gri-prompt[hidden],.gri-dialog [hidden]{display:none}.gri-eyebrow{display:block;font:10px monospace;letter-spacing:1.5px;color:#74d8d8}.gri-prompt strong{display:block;font-size:19px;margin:7px 0;overflow-wrap:anywhere}.gri-summary{display:block;color:#b6c8d2;font-size:12px}.gri-action{display:flex;align-items:center;gap:8px;border-top:1px solid #ffffff20;margin-top:12px;padding-top:12px;color:#79e5df}.gri-action span{margin-left:auto}
    .gri-prompt kbd,.gri-dialog kbd{font:11px monospace;border:1px solid #689295;border-radius:4px;padding:2px 5px}.gri-prompt:focus-visible,.gri-dialog :focus-visible{outline:3px solid #77eee7;outline-offset:4px}
    .gri-dialog{width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 40px);overflow:auto;padding:28px;margin:auto 24px auto auto}.gri-dialog::backdrop{background:#07111c66}.gri-dialog h2{margin:16px 0 4px;font-size:25px;overflow-wrap:anywhere}.gri-owner{color:#93aeba;font-size:12px;overflow-wrap:anywhere}.gri-description{font-size:15px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.gri-stats{padding:15px 0;border-block:1px solid #ffffff20;line-height:1.9;color:#7ededa}.gri-updated{color:#93aeba;font-size:12px}.gri-close{position:absolute;right:12px;top:8px;background:none;border:0;color:#c3d9df;font-size:27px;cursor:pointer}.gri-github,.gri-resume{box-sizing:border-box;display:block;width:100%;padding:12px;border-radius:7px;text-align:center;font:600 13px system-ui;text-decoration:none;cursor:pointer}.gri-github{color:#10262d;background:#79ded8;margin:20px 0 8px}.gri-resume{color:#d2e9ec;background:transparent;border:1px solid #56747e}.gri-resume kbd{margin-left:8px}
    @media(max-width:700px){.gri-prompt{right:12px;bottom:170px;width:230px;padding:12px}.gri-dialog{margin:auto}.gri-prompt strong{font-size:16px}}@media(max-height:520px){.gri-prompt{bottom:85px;right:12px;width:220px;padding:10px}.gri-eyebrow{font-size:9px}.gri-action{margin-top:7px;padding-top:7px}}
  `;
  style.textContent += `
    .gri-dialog{width:min(650px,calc(100vw - 32px));height:min(760px,calc(100dvh - 40px));padding:0;overflow:hidden;border-radius:16px;border-top:3px solid #79ded8;background:linear-gradient(145deg,#152d3a,#0a1722 65%);box-shadow:0 24px 90px #000a}
    .gri-dialog[open]{display:flex;flex-direction:column}.gri-header{padding:26px 28px 20px;border-bottom:1px solid #ffffff18}.gri-header .gri-eyebrow{display:flex;align-items:center;gap:18px;padding-right:16px}.gri-status{font-size:9px;letter-spacing:1px;color:#bce6b3;border:1px solid #608b63;border-radius:20px;padding:4px 8px}.gri-header h2{font-size:29px;margin:15px 0 4px}.gri-close{z-index:1}
    .gri-tabs{display:flex;gap:8px;padding:12px 28px;background:#07141b55}.gri-tabs button,.gri-retry{background:transparent;border:1px solid #ffffff24;border-radius:6px;color:#91aebd;font:12px monospace;padding:10px 15px;cursor:pointer}.gri-tabs button[aria-pressed="true"]{background:#77ddd51a;border-color:#77ddd5;color:#9cfff1}.gri-tabs kbd{margin-left:12px}
    .gri-content{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 28px 24px;scrollbar-color:#426974 #101e29}.gri-description{margin:16px 0}.gri-reader-hint{margin-top:24px!important;padding:18px;border-left:2px solid #79ded8;color:#a5c2cc;line-height:1.7;background:#77ddd508}.gri-footer{padding:14px 28px 18px;border-top:1px solid #ffffff20;display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#07141b99}.gri-footer .gri-github{margin:0}.gri-footer-note{grid-column:1/-1;color:#7598a5;font:10px monospace;text-align:center}.gri-readme-status{color:#a1bdc8;line-height:1.7;margin:12px 0!important}.gri-retry{color:#79ded8}
    .gri-markdown{font-size:14px;line-height:1.75;color:#d6e5eb;overflow-wrap:anywhere}.gri-markdown img{display:block;max-width:100%;max-height:280px;object-fit:contain;margin:16px auto;border-radius:6px}.gri-markdown p{margin:12px 0!important}.gri-markdown h2,.gri-markdown h3,.gri-markdown h4{font-size:22px;line-height:1.3;margin:26px 0 12px;border-bottom:1px solid #ffffff18;padding-bottom:9px}.gri-markdown h3{font-size:18px}.gri-markdown h4{font-size:16px}.gri-markdown a{color:#7ee4dc;text-decoration:underline}.gri-markdown ul,.gri-markdown ol{padding-left:24px;margin:12px 0}.gri-markdown li{margin:6px 0}.gri-markdown pre{background:#050f18;border:1px solid #ffffff18;padding:16px;border-radius:8px;overflow:auto;max-width:100%;font:12px/1.7 monospace;white-space:pre;overflow-wrap:normal}.gri-markdown code{font-family:monospace;color:#9ce5ca;background:#07141b;padding:2px 4px;border-radius:3px}.gri-markdown pre code{padding:0;background:transparent}.gri-markdown blockquote{margin:15px 0;border-left:3px solid #79ded8;padding:8px 16px;background:#77ddd508}.gri-table{overflow:auto}.gri-markdown table{border-collapse:collapse;width:100%;font-size:12px}.gri-markdown td,.gri-markdown th{border:1px solid #ffffff20;padding:8px 12px;text-align:left}.gri-markdown hr{border:0;border-top:1px solid #ffffff20;margin:20px 0}
    @media(max-width:700px){.gri-dialog{height:calc(100dvh - 24px);width:calc(100vw - 24px)}.gri-header{padding:22px 18px 16px}.gri-header h2{font-size:24px}.gri-tabs{padding:10px 18px}.gri-tabs button{padding:9px 11px}.gri-content{padding:8px 18px 20px}.gri-footer{padding:12px 18px;grid-template-columns:1fr}.gri-footer-note{display:none}.gri-status{font-size:8px}}
  `;
  document.head.append(style); document.body.append(prompt, dialog);
  let target = null, timer = 0, candidates = null, modeNow = 'walk', readVersion = 0, readerRepo = null, loaded = false, inspectClose = null;
  const forward = new THREE.Vector3(), ray = new THREE.Raycaster();
  function close() {
    if (!dialog.open) return;
    const finish = inspectClose; inspectClose = null;
    readVersion++; readerRepo = null;
    dialog.close(); onClose();
    prompt.hidden = !target;
    if (!prompt.hidden) prompt.focus({ preventScroll: true });
    finish?.();
  }
  function open(repo = target?.repo, options = {}) {
    if (!repo || dialog.open) return false;
    const r = repo;
    readerRepo = r; loaded = false; readVersion++;
    inspectClose = typeof options.onClose === 'function' ? options.onClose : null;
    dialog.querySelector('.gri-status').textContent = options.status || (modeNow === 'drive' ? 'PARKED' : 'ON FOOT · PAUSED');
    dialog.querySelector('.gri-markdown').replaceChildren();
    dialog.querySelector('h2').textContent = r.name;
    dialog.querySelector('.gri-owner').textContent = r.full_name || '';
    dialog.querySelector('.gri-description').textContent = r.description || 'No description provided for this repository.';
    dialog.querySelector('.gri-stats').textContent = `${fmtNum(r.stargazers_count || 0)} stars · ${fmtNum(r.forks_count || 0)} forks · ${r.language || 'Unknown language'}${r.archived ? ' · Archived' : ''}`;
    dialog.querySelector('.gri-updated').textContent = r.pushed_at ? `Last push ${r.pushed_at.slice(0, 10)}` : '';
    const link = dialog.querySelector('.gri-github');
    const fullName = r.full_name || '';
    link.hidden = !/^[\w.-]+\/[\w.-]+$/.test(fullName);
    if (!link.hidden) link.href = `https://github.com/${fullName.split('/').map(encodeURIComponent).join('/')}`;
    else link.removeAttribute('href');
    onOpen(); prompt.hidden = true;
    document.getElementById('tooltip')?.classList.remove('show');
    if (document.pointerLockElement) document.exitPointerLock?.();
    dialog.showModal();
    setView('readme');
    return true;
  }
  async function loadReadme() {
    const repo = readerRepo, version = ++readVersion;
    if (!repo) return;
    const status = dialog.querySelector('.gri-readme-status'), retry = dialog.querySelector('.gri-retry'), article = dialog.querySelector('.gri-markdown');
    status.textContent = 'Loading README…'; retry.hidden = true; article.replaceChildren();
    article.setAttribute('aria-busy', 'true');
    const result = await readmeDocument(repo);
    if (version !== readVersion || readerRepo !== repo || !dialog.open) return;
    article.setAttribute('aria-busy', 'false');
    if (result.status === 'ready') {
      loaded = true; renderReadme(article, result.markdown, repo);
      status.textContent = result.truncated ? 'Showing the first 100,000 characters. Open GitHub for the complete README.' : result.markdown.trim() ? '' : 'This README is empty.';
    } else {
      status.textContent = result.status === 'missing' ? 'No README found at the repository root. You can explore the project on GitHub.' : 'Couldn’t load the README. Check your connection and try again.';
      retry.hidden = false;
    }
  }
  function setView(view) {
    dialog.querySelector('.gri-overview').hidden = view !== 'overview';
    dialog.querySelector('.gri-readme').hidden = view !== 'readme';
    dialog.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    dialog.querySelector('.gri-content').scrollTop = 0;
    if (view === 'readme' && !loaded) loadReadme();
  }
  dialog.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  dialog.querySelector('.gri-retry').addEventListener('click', loadReadme);
  prompt.addEventListener('click', () => open());
  dialog.querySelector('.gri-close').addEventListener('click', close);
  dialog.querySelector('.gri-resume').addEventListener('click', close);
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  return {
    get open() { return dialog.open; },
    inspect(repo, options) { return open(repo, options); },
    key(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (dialog.open && e.code === 'KeyR') { e.preventDefault(); e.stopImmediatePropagation(); setView('readme'); return true; }
      if ((e.code === 'KeyE' && (target || dialog.open)) || (e.code === 'Escape' && dialog.open)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) { if (dialog.open) close(); else open(); }
        return true;
      }
      return false;
    },
    update(dt, mode, position) {
      if (mode !== 'walk' && mode !== 'drive') { this.reset(); return; }
      modeNow = mode;
      if (dialog.open) return;
      timer -= dt; if (timer > 0) return; timer = 0.15;
      if (!candidates) candidates = buildings().map(building => ({ building, x: building.mesh.position.x, z: building.mesh.position.z, half: (building.body.geometry.parameters.width || 2.2) / 2 }));
      camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
      ray.setFromCamera({x:0,y:0}, camera);
      const aimed = ray.intersectObjects(candidates.flatMap(c=>c.building.bodies), false)[0]?.object.userData.building;
      const pick = pickNearbyRepo(candidates, position, forward, target, mode === 'drive' ? 16 : 11, aimed);
      target = pick?.building || null; prompt.hidden = !target;
      if (!target) return;
      prompt.querySelector('strong').textContent = target.repo.name;
      prompt.querySelector('.gri-summary').textContent = `${target.repo.language || 'Repository'} · ★ ${fmtNum(target.repo.stargazers_count || 0)} · ${Math.round(pick.distance * 1.6)} m away`;
      prompt.setAttribute('aria-label', `Inspect ${target.repo.full_name || target.repo.name}. Press E.`);
    },
    reset() { close(); prompt.hidden = true; target = null; candidates = null; timer = 0; },
    dispose() { close(); prompt.remove(); dialog.remove(); style.remove(); },
  };
}
