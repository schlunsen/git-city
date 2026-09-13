import { pickNearbyRepo } from './city/nearby-repo.js';
import { readmeDocument } from './city/readme-document.js';
import { gourceUrl, miniAvailable } from './city/gource-player.js';
import { renderReadme } from './readme-reader.js';
import { fmtNum, handheld } from './city/util.js';

export function createRepoInspector(THREE, { camera, buildings, onOpen, onClose, onRepo }) {
  const prompt = document.createElement('button');
  prompt.type = 'button'; prompt.className = 'gri-prompt'; prompt.hidden = true;
  prompt.innerHTML = '<span class="gri-eyebrow">NEARBY REPOSITORY</span><strong></strong><span class="gri-summary"></span><span class="gri-action"><kbd>E</kbd> Inspect repo <span>↗</span></span>';
  const dialog = document.createElement('aside'); dialog.className = 'gri-dialog'; dialog.hidden = true;
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'false');
  dialog.setAttribute('aria-labelledby', 'gri-title');
  dialog.innerHTML = `<div class="gri-warp" aria-hidden="true"></div><div class="gri-beam" aria-hidden="true"></div>
    <div class="gri-transit" aria-hidden="true"><span class="gri-transit-name"></span><span class="gri-transit-sub">tuning in…</span></div>
    <button class="gri-close" type="button" aria-label="Close repository details">×</button>
    <header class="gri-header"><div class="gri-eyebrow">Field guide <span class="gri-status">paused</span></div><h2 id="gri-title"></h2><p class="gri-owner"></p></header>
    <nav class="gri-tabs" aria-label="Repository views"><button type="button" data-view="overview" aria-pressed="true">Overview</button><button type="button" data-view="readme" aria-pressed="false">Readme <kbd>R</kbd></button><button type="button" data-view="history" aria-pressed="false" hidden>History <kbd>H</kbd></button></nav>
    <div class="gri-content"><section class="gri-overview"><p class="gri-description"></p><p class="gri-stats"></p><p class="gri-updated"></p><p class="gri-reader-hint">Get to know the project. Open its README for setup instructions, examples, and documentation.</p></section>
    <section class="gri-readme" hidden><p class="gri-readme-status" role="status"></p><button type="button" class="gri-retry" hidden>Retry README</button><article class="gri-markdown" aria-label="Repository README"></article></section>
    <section class="gri-history" hidden><div class="gri-screen"></div><p class="gri-history-note">The whole commit history, replayed. Files appear as they are written.</p><a class="gri-history-open" target="_blank" rel="noopener">Open in Gource View \u2197</a></section></div>
    <footer class="gri-footer"><a class="gri-github" target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a><button class="gri-resume" type="button">Continue exploring <kbd>Esc</kbd></button><span class="gri-footer-note">Your position is saved while you read.</span></footer>`;
  const style = document.createElement('style');
  style.textContent = `
    .gri-prompt,.gri-dialog{box-sizing:border-box;color:#e5f3f4;background:rgba(12,24,34,.96);border:1px solid #4ca4a8;border-radius:14px;box-shadow:0 10px 35px #0006;font:13px system-ui,sans-serif}
    .gri-prompt{position:fixed;z-index:36;right:20px;bottom:155px;width:290px;text-align:left;padding:16px;cursor:pointer}
    .gri-prompt[hidden],.gri-dialog [hidden]{display:none}.gri-eyebrow{display:block;font:10px monospace;letter-spacing:1.5px;color:#74d8d8}.gri-prompt strong{display:block;font-size:19px;margin:7px 0;overflow-wrap:anywhere}.gri-summary{display:block;color:#b6c8d2;font-size:12px}.gri-action{display:flex;align-items:center;gap:8px;border-top:1px solid #ffffff20;margin-top:12px;padding-top:12px;color:#79e5df}.gri-action span{margin-left:auto}
    .gri-prompt kbd,.gri-dialog kbd{font:11px monospace;border:1px solid #689295;border-radius:4px;padding:2px 5px}.gri-prompt:focus-visible,.gri-dialog :focus-visible{outline:3px solid #77eee7;outline-offset:4px}
    .gri-dialog{touch-action:none;position:fixed;z-index:46;inset:20px 24px 20px auto;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 40px);overflow:auto;padding:28px;margin:0}.gri-dialog h2{margin:16px 0 4px;font-size:25px;overflow-wrap:anywhere}.gri-owner{color:#93aeba;font-size:12px;overflow-wrap:anywhere}.gri-description{font-size:15px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.gri-stats{padding:15px 0;border-block:1px solid #ffffff20;line-height:1.9;color:#7ededa}.gri-updated{color:#93aeba;font-size:12px}.gri-close{position:absolute;right:12px;top:8px;background:none;border:0;color:#c3d9df;font-size:27px;cursor:pointer}.gri-github,.gri-resume{box-sizing:border-box;display:block;width:100%;padding:12px;border-radius:7px;text-align:center;font:600 13px system-ui;text-decoration:none;cursor:pointer}.gri-github{color:#10262d;background:#79ded8;margin:20px 0 8px}.gri-resume{color:#d2e9ec;background:transparent;border:1px solid #56747e}.gri-resume kbd{margin-left:8px}
    @media(max-width:700px){.gri-prompt{right:12px;bottom:170px;width:230px;padding:12px}.gri-dialog{margin:auto}.gri-prompt strong{font-size:16px}}@media(max-height:520px){.gri-prompt{bottom:85px;right:12px;width:220px;padding:10px}.gri-eyebrow{font-size:9px}.gri-action{margin-top:7px;padding-top:7px}}
  `;
  style.textContent += `
    .gri-dialog{width:min(650px,calc(100vw - 32px));height:min(760px,calc(100dvh - 40px));padding:0;overflow:hidden;border-radius:16px;border-top:3px solid #79ded8;background:linear-gradient(145deg,#152d3a,#0a1722 65%);box-shadow:0 24px 90px #000a;transform-origin:right center}
    .gri-dialog[data-hud="true"]{position:fixed;z-index:46;top:calc(var(--topbar-h,58px) + 14px);right:max(20px,env(safe-area-inset-right));bottom:calc(var(--transport-h,90px) + 14px);left:auto;height:auto;max-height:none;margin:0}
    .gri-dialog[open]{display:flex;flex-direction:column}
    .gri-dialog[data-anim="in"],.gri-dialog[data-anim="tune"]{animation:gri-warp-in .74s cubic-bezier(.16,1,.3,1) both}
    .gri-dialog[data-anim="out"]{animation:gri-warp-out .4s cubic-bezier(.6,0,.9,.2) both;pointer-events:none}
    .gri-dialog[data-anim="in"] .gri-header,.gri-dialog[data-anim="tune"] .gri-header{animation:gri-section .42s .3s ease-out both}
    .gri-dialog[data-anim="in"] .gri-tabs,.gri-dialog[data-anim="tune"] .gri-tabs{animation:gri-section .42s .36s ease-out both}
    .gri-dialog[data-anim="in"] .gri-content,.gri-dialog[data-anim="tune"] .gri-content{animation:gri-section .5s .42s ease-out both}
    .gri-dialog[data-anim="in"] .gri-footer,.gri-dialog[data-anim="tune"] .gri-footer{animation:gri-section .42s .5s ease-out both}
    .gri-warp,.gri-beam{position:absolute;pointer-events:none;opacity:0;z-index:5;mix-blend-mode:screen}
    .gri-warp{inset:0;background:repeating-linear-gradient(90deg,rgba(150,255,247,.5) 0 2px,transparent 2px 9px)}
    .gri-beam{left:0;right:0;top:50%;height:2px;background:#cafff9;box-shadow:0 0 34px 12px rgba(121,222,216,.75);mix-blend-mode:normal}
    .gri-dialog[data-anim="in"] .gri-warp,.gri-dialog[data-anim="tune"] .gri-warp,.gri-dialog[data-anim="out"] .gri-warp{animation:gri-streak .74s ease-out both}
    .gri-dialog[data-anim="in"] .gri-beam,.gri-dialog[data-anim="tune"] .gri-beam{animation:gri-beam .74s ease-out both}
    .gri-dialog[data-anim="out"] .gri-beam{animation:gri-beam-out .4s ease-in both}
    .gri-transit{position:absolute;inset:0;z-index:6;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px;background:radial-gradient(120% 80% at 50% 50%,#0d2732e6,#061018f2)}
    .gri-dialog[data-state="transit"] .gri-transit{display:flex;animation:gri-section .3s ease-out both}
    .gri-dialog[data-state="transit"] .gri-warp{opacity:.34;animation:gri-streak-loop 1.05s linear infinite}
    .gri-transit-name{font:600 16px system-ui,sans-serif;color:#cdeff1;overflow-wrap:anywhere}
    .gri-transit-sub{font:11px monospace;letter-spacing:.22em;text-transform:uppercase;color:#79ded8}
    .gri-transit-sub::after{content:"";display:block;height:2px;margin-top:10px;border-radius:2px;background:linear-gradient(90deg,transparent,#79ded8,transparent);animation:gri-tune-bar 1.1s ease-in-out infinite}
    .gri-header{padding:26px 28px 20px;border-bottom:1px solid #ffffff18}.gri-header .gri-eyebrow{display:flex;align-items:center;gap:18px;padding-right:16px}.gri-status{font-size:9px;letter-spacing:1px;color:#bce6b3;border:1px solid #608b63;border-radius:20px;padding:4px 8px}.gri-header h2{font-size:29px;margin:15px 0 4px}.gri-close{z-index:1}
    .gri-tabs{display:flex;gap:8px;padding:12px 28px;background:#07141b55}.gri-tabs button,.gri-retry{background:transparent;border:1px solid #ffffff24;border-radius:6px;color:#91aebd;font:12px monospace;padding:10px 15px;cursor:pointer}.gri-tabs button[aria-pressed="true"]{background:#77ddd51a;border-color:#77ddd5;color:#9cfff1}.gri-tabs kbd{margin-left:12px}
    .gri-content{touch-action:pan-y;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 28px 24px;scrollbar-color:#426974 #101e29}.gri-description{margin:16px 0}.gri-reader-hint{margin-top:24px!important;padding:18px;border-left:2px solid #79ded8;color:#a5c2cc;line-height:1.7;background:#77ddd508}.gri-footer{padding:14px 28px 18px;border-top:1px solid #ffffff20;display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#07141b99}.gri-footer .gri-github{margin:0}.gri-footer-note{grid-column:1/-1;color:#7598a5;font:10px monospace;text-align:center}.gri-readme-status{color:#a1bdc8;line-height:1.7;margin:12px 0!important}.gri-retry{color:#79ded8}
    .gri-markdown{font-size:14px;line-height:1.75;color:#d6e5eb;overflow-wrap:anywhere}.gri-markdown img{display:block;max-width:100%;max-height:280px;object-fit:contain;margin:16px auto;border-radius:6px}.gri-markdown img.gri-badge{display:inline-block;max-height:22px;width:auto;margin:3px 5px 3px 0;border-radius:3px;vertical-align:middle}.gri-shot{margin:18px 0;text-align:center;line-height:1}.gri-shot img{margin:8px auto}.gri-shot a{display:inline-block;text-decoration:none}.gri-shot a+a{margin-left:0}.gri-markdown p{margin:12px 0!important}.gri-markdown h2,.gri-markdown h3,.gri-markdown h4{font-size:22px;line-height:1.3;margin:26px 0 12px;border-bottom:1px solid #ffffff18;padding-bottom:9px}.gri-markdown h3{font-size:18px}.gri-markdown h4{font-size:16px}.gri-markdown a{color:#7ee4dc;text-decoration:underline}.gri-markdown ul,.gri-markdown ol{padding-left:24px;margin:12px 0}.gri-markdown li{margin:6px 0}.gri-markdown pre{background:#050f18;border:1px solid #ffffff18;padding:16px;border-radius:8px;overflow:auto;max-width:100%;font:12px/1.7 monospace;white-space:pre;overflow-wrap:normal}.gri-markdown code{font-family:monospace;color:#9ce5ca;background:#07141b;padding:2px 4px;border-radius:3px}.gri-markdown pre code{padding:0;background:transparent}.gri-markdown blockquote{margin:15px 0;border-left:3px solid #79ded8;padding:8px 16px;background:#77ddd508}.gri-table{overflow:auto}.gri-markdown table{border-collapse:collapse;width:100%;font-size:12px}.gri-markdown td,.gri-markdown th{border:1px solid #ffffff20;padding:8px 12px;text-align:left}.gri-markdown hr{border:0;border-top:1px solid #ffffff20;margin:20px 0}
    /* The island-hop warp, in a panel: a bright line races in from the right,
       opens like an iris, streaks unwind, and the guide settles onto the glass. */
    @keyframes gri-warp-in{0%{opacity:0;transform:translateX(190px) scale(.66,.012);filter:brightness(3.4) saturate(.15)}
      20%{opacity:1;transform:translateX(0) scale(1,.012);filter:brightness(3.6) saturate(.15)}
      44%{opacity:1;transform:translateX(0) scale(1,.09);filter:brightness(2.4) saturate(.45)}
      72%{transform:translateX(0) scale(1,1.035);filter:brightness(1.3) saturate(1)}100%{transform:none;filter:none}}
    @keyframes gri-warp-out{0%{opacity:1;transform:none;filter:none}
      46%{opacity:1;transform:scale(1,.07);filter:brightness(2.8) saturate(.3)}
      100%{opacity:0;transform:translateX(190px) scale(.66,.012);filter:brightness(3.6) saturate(.15)}}
    @keyframes gri-streak{0%{opacity:.95;transform:translateX(0) scaleX(1)}55%{opacity:.3;transform:translateX(-38%) scaleX(2.6)}100%{opacity:0;transform:translateX(-115%) scaleX(3.4)}}
    @keyframes gri-streak-loop{from{transform:translateX(0)}to{transform:translateX(-11px)}}
    @keyframes gri-beam{0%{opacity:1;transform:scaleX(.15)}26%{opacity:1;transform:scaleX(1)}62%{opacity:.55}100%{opacity:0}}
    @keyframes gri-beam-out{0%{opacity:0;transform:scaleX(1)}45%{opacity:1;transform:scaleX(1)}100%{opacity:0;transform:scaleX(.15)}}
    @keyframes gri-tune-bar{0%,100%{width:26px;opacity:.5}50%{width:120px;opacity:1}}
    @keyframes gri-section{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
    @media(max-width:700px){.gri-dialog{height:calc(100dvh - 24px);width:calc(100vw - 24px)}.gri-header{padding:22px 18px 16px}.gri-header h2{font-size:24px}.gri-tabs{padding:10px 18px}.gri-tabs button{padding:9px 11px}.gri-content{padding:8px 18px 20px}.gri-footer{padding:12px 18px;grid-template-columns:1fr}.gri-footer-note{display:none}.gri-status{font-size:8px}}
    @media(prefers-reduced-motion:reduce){.gri-dialog,.gri-dialog *{animation:none!important}.gri-dialog[data-anim="out"]{opacity:0}}
  `;

  // ---------------------------------------------------------------------
  // The guide as a printed page.
  //
  // The island is hand-drawn: ink outlines, cel shading, cut paper. The guide
  // was lit like a telemetry readout -- teal on near-black, monospace
  // micro-caps, hairline rules -- which is a different product's furniture
  // standing on a storybook. This is the same panel rebuilt as something the
  // island could plausibly contain: a page from a guidebook, laid on the
  // scene, with ink for its rules and paper for its ground.
  //
  // An override sheet rather than edits in place, so the whole look can be
  // tuned, or lifted out, as one piece while we settle it.
  // ---------------------------------------------------------------------
  style.textContent += `
    /* The guide had its own palette baked in, from before the page had themes.
       That was invisible until the rest of the interface learned to follow the
       sky: everything else went dark at night and the guide stayed cream, lit
       like a window into another time of day. It reads the same tokens now, so
       there is one page and it turns all at once. The literals are fallbacks,
       for the guide standing on its own. */
    .gri-dialog{
      --paper:var(--sheet-b,#f7f0e2); --paper-edge:var(--sheet-c,#e8dcc6);
      --ink:var(--ink-100,#241f18); --ink-soft:var(--ink-300,#5d5446);
      --ink-faint:var(--ink-500,#8b8171); --accent:var(--accent,#136b64);
      --rule:var(--line,#241f1826);
      --display:'Baloo 2','Trebuchet MS',system-ui,sans-serif;
      --prose:'Nunito',system-ui,-apple-system,sans-serif;
      --ui:'Nunito',system-ui,sans-serif;
      border-radius:16px; border:none; border-top:none;
      background:
        repeating-linear-gradient(92deg,rgba(128,128,128,.05) 0 1px,transparent 1px 3px),
        radial-gradient(120% 90% at 22% 8%,var(--sheet-a,#fffaf0),var(--paper) 46%,var(--paper-edge));
      box-shadow:0 18px 50px -18px #0e1a20b3, 0 2px 0 var(--rule);
      color:var(--ink);
    }
    .gri-header{border-bottom:none;padding:22px 30px 14px}
    .gri-eyebrow{
      font:700 13px/1 var(--ui) !important;
      letter-spacing:.02em !important; text-transform:none; color:var(--ink-soft) !important;
    }
    .gri-status{
      font:700 11px/1 var(--ui); letter-spacing:.04em; text-transform:lowercase;
      color:#2c5f2b; background:#cfe6a6; border:1.5px solid #2c5f2b40;
      border-radius:20px; padding:4px 10px; transform:rotate(-1.2deg);
    }
    .gri-header h2{
      font:700 37px/1.05 var(--display); color:var(--ink);
      margin:10px 0 3px; letter-spacing:-.01em;
    }
    .gri-owner{font:500 13px/1.4 var(--ui);color:var(--ink-faint);letter-spacing:.01em}
    .gri-close{color:var(--ink-soft);text-shadow:none}
    .gri-close:hover{color:var(--ink)}
    .gri-tabs{background:transparent;padding:14px 30px 12px;gap:10px;border-bottom:2px dashed var(--rule)}
    .gri-tabs button{
      background:none;border:2px solid transparent;border-radius:20px;padding:7px 14px;
      font:700 13.5px/1 var(--ui);color:var(--ink-faint);letter-spacing:.01em;
    }
    .gri-tabs button[aria-pressed="true"]{
      background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink);border-color:var(--rule);
    }
    .gri-tabs kbd{margin-left:8px;color:var(--ink-faint);border-color:var(--rule);background:#0000000a}
    /* --gri-pad is the reading margin, named here so the full-bleed replay can
       cancel exactly it. Both come from this one declaration: when they were
       set in two places the replay cancelled 18px of a 30px margin and sat
       inset by the difference. */
    .gri-content{--gri-pad:30px;padding:14px var(--gri-pad) 26px;scrollbar-color:#c9bda5 transparent}
    .gri-description{font:400 17px/1.62 var(--prose);color:var(--ink)}
    .gri-stats,.gri-updated{font:500 13px/1.6 var(--ui);color:var(--ink-soft)}
    .gri-reader-hint{
      border-left:none !important;background:none !important;padding:18px 0 0 !important;
      font:400 15.5px/1.7 var(--prose);color:var(--ink-soft);border-top:2px dashed var(--rule);
    }
    .gri-markdown{font:400 16.5px/1.7 var(--prose);color:var(--ink)}
    .gri-markdown h2,.gri-markdown h3,.gri-markdown h4{
      font-family:var(--display);font-weight:600;color:var(--ink);letter-spacing:-.005em;
      border-bottom:1px solid var(--rule);padding-bottom:7px;
    }
    .gri-markdown a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:2px}
    .gri-markdown code{color:var(--accent);background:color-mix(in srgb,var(--ink) 7%,transparent);border-radius:2px}
    .gri-markdown pre{background:color-mix(in srgb,var(--ink) 88%,var(--paper));border:none;border-radius:3px;color:var(--paper)}
    .gri-markdown pre code{color:var(--paper)}
    .gri-markdown blockquote{border-left:3px solid var(--ink);background:none;color:var(--ink-soft);font-style:italic}
    .gri-markdown img{border-radius:2px;box-shadow:0 2px 14px -4px #241f1859}
    .gri-markdown td,.gri-markdown th{border-color:var(--rule)}
    .gri-markdown hr{border-top:1px solid var(--rule)}
    .gri-footer{background:color-mix(in srgb,var(--ink) 4%,transparent);border-top:2px dashed var(--rule);padding:16px 30px 18px}
    .gri-footer .gri-github,.gri-resume{
      font:700 14px/1 var(--ui);border:2px solid var(--ink);border-radius:22px;letter-spacing:.01em;
      background:none;color:var(--ink);padding:11px 14px;text-align:center;
    }
    .gri-footer .gri-github{background:var(--accent);color:var(--paper);border-color:var(--accent)}
    .gri-resume kbd{color:var(--ink-faint);border-color:var(--rule)}
    .gri-footer-note{
      font:400 12.5px/1.4 var(--prose) !important;letter-spacing:0 !important;
      color:var(--ink-faint) !important;
    }
    .gri-transit{background:radial-gradient(120% 80% at 50% 50%,var(--paper),var(--paper-edge))}
    .gri-transit-name{font:700 22px var(--display);color:var(--ink)}
    .gri-transit-sub{
      font:600 14px var(--prose) !important;letter-spacing:.01em !important;
      text-transform:none !important;color:var(--ink-soft) !important;
    }
    .gri-transit-sub::after{background:linear-gradient(90deg,transparent,var(--ink-soft),transparent)}
    /* The focus ring was teal on black; on paper it has to be ink too, or the
       first thing the eye lands on is a leftover from the old palette. */
    .gri-dialog :focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:2px}
    /* The replay, let into the page as a screen rather than a panel of its own:
       the guide is a printed page, and this is the plate on it. The frame keeps
       a 16/10 picture on a roomy sheet; where the sheet is short, height is the
       scarce thing, so it takes what is left instead of forcing a scroll. */
    .gri-history{display:flex;flex-direction:column;gap:12px}
    .gri-screen{
      position:relative;flex:none;width:100%;aspect-ratio:16/9;
      border:1px solid var(--rule);border-radius:10px;overflow:hidden;
      background:var(--sheet-c,#ece0c9);
    }
    .gri-screen iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;transition:opacity .35s ease}
    .gri-screen.loading iframe{opacity:0}
    /* Something has to be happening in here: a replay can take a while to wind
       back through a long history, and a single grey line in a large empty box
       reads as a view that failed rather than one that is working. */
    .gri-screen-load{
      position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;
      align-items:center;justify-content:center;text-align:center;padding:0 24px;
    }
    .gri-screen-load b{font:700 14px/1.35 var(--display);color:var(--ink-soft);display:block}
    .gri-screen-load i{font:400 11px/1.4 var(--ui);font-style:normal;color:var(--ink-faint);overflow-wrap:anywhere}
    .gri-screen-load u{
      display:block;width:120px;height:3px;border-radius:3px;text-decoration:none;
      background:var(--rule);overflow:hidden;position:relative;
    }
    .gri-screen-load u::after{
      content:"";position:absolute;top:0;bottom:0;width:40%;border-radius:3px;background:var(--accent);
      animation:gri-wind 1.15s ease-in-out infinite;
    }
    @keyframes gri-wind{0%{left:-40%}100%{left:100%}}
    @media(prefers-reduced-motion:reduce){.gri-screen-load u::after{animation:none;left:0;width:100%;opacity:.5}}
    .gri-history-note{margin:0!important;font:12px/1.6 var(--prose);color:var(--ink-soft)}
    .gri-history-open{
      align-self:flex-start;font:700 12px var(--ui);color:var(--accent);text-decoration:none;
      border:1px solid var(--rule);border-radius:8px;padding:8px 12px;
    }
    .gri-history-open:hover{border-color:var(--accent-dim)}
    @media(max-width:700px){
      /* No room for both on a sheet: the picture is the point, the caption is not.
         The link out is not a caption -- on a handset it is how the replay gets
         watched at a size worth watching -- so it stays, and stretches. */
      .gri-history-note{display:none}
      .gri-history-open{align-self:stretch;text-align:center}
      /* A phone has no R or H key to press. The hints were costing the replay
         about thirty pixels of height to advertise shortcuts nobody there has. */
      .gri-tabs kbd{display:none}
      /* The replay is bound by width here, not height: Gource View letterboxes
         its own 16:9 picture inside whatever box it gets, so a taller sheet
         bought nothing but cream bands above and below. The box takes the
         picture's shape and the sheet stays the size it was.
         Width is the scarce thing, so it takes all of it: the replay runs out
         to the sheet's edges instead of sitting inside the reading margin that
         the prose either side of it needs. */
      .gri-screen{
        width:auto;margin-inline:calc(var(--gri-pad, 18px) * -1);
        border-inline:0;border-radius:0;
      }
      /* A 16:9 picture across the full width of the sheet is taller than the
         gap between the tabs and the footer, so the replay was arriving cut in
         half. The sheet gives the replay more of the screen while it is the
         thing on show, and the picture then takes the height that is actually
         there rather than the height its ratio asks for -- Gource View
         letterboxes itself, so a shorter box costs a band, not a crop. */
      .gri-dialog[data-hud="true"][data-view="history"]{height:min(82dvh,760px);max-height:82dvh}
      .gri-dialog[data-view="history"] .gri-content{display:flex;flex-direction:column;overflow:hidden}
      .gri-dialog[data-view="history"] .gri-history{flex:1;min-height:0}
      .gri-dialog[data-view="history"] .gri-screen{flex:1;min-height:130px;aspect-ratio:auto}
      /* Two stacked full-width buttons under it is most of a phone screen spent
         on ways to leave; side by side they cost one row. */
      .gri-dialog[data-view="history"] .gri-footer{grid-template-columns:1fr 1fr}
    }
    /* On a phone the guide was the whole screen: 366x672 of a 390x844 display,
       with the tour card stacked on top of it, which measured out at 136% of
       the viewport covered -- the interface overlapping itself and the island
       reduced to a strip at the top. It becomes a sheet pulled up from the
       bottom instead, so the thing being described stays on screen above the
       description of it. */
    @media(max-width:700px){
      .gri-dialog[data-hud="true"]{
        top:auto; left:8px; right:8px; width:auto;
        height:min(60dvh, 560px); max-height:60dvh;
        bottom:calc(var(--transport-h,90px) + 8px);
        border-radius:20px 20px 12px 12px;
      }
      /* A handle, because it now reads as something you could pull. */
      .gri-dialog[data-hud="true"] .gri-header::before{
        content:"";position:absolute;left:50%;top:8px;transform:translateX(-50%);
        width:38px;height:4px;border-radius:4px;background:var(--rule);
      }
      .gri-dialog[data-hud="true"] .gri-header{padding-top:20px}
      .gri-header h2{font-size:27px}
    }
    .gri-warp{background:repeating-linear-gradient(90deg,#fff8e8cc 0 2px,transparent 2px 9px)}
    .gri-beam{background:#fff8e8;box-shadow:0 0 34px 12px #e6d5aec2}
  `;

  document.head.append(style); document.body.append(prompt, dialog);
  let target = null, timer = 0, candidates = null, modeNow = 'walk', readVersion = 0, readerRepo = null, loaded = false, inspectClose = null, openNow = false;
  let animTimer = 0, hideTimer = 0, historyRepo = '', historyTimer = 0, historyListener = null;
  // The History tab stands in for the corner screen on anything too small for it.
  const historyTab = () => !miniAvailable();
  // On a phone the guide is a 60dvh sheet over the island. Opening it straight
  // into the README buried the repo under a wall of prose and left no sign the
  // history was there at all. It opens on the overview instead -- what the repo
  // is, in a few lines -- and the tabs offer the README and the replay.
  const openingView = () => (handheld() ? 'overview' : 'readme');
  function syncTabs() {
    dialog.querySelector('[data-view="history"]').hidden = !historyTab();
  }
  const forward = new THREE.Vector3(), ray = new THREE.Raycaster();
  const IN_MS = 740, OUT_MS = 400;
  const nameOf = (r) => r?.full_name || r?.name || '';
  // Restart one of the warp animations from its first frame (the class alone
  // will not replay while it is already on the element).
  function animate(name, ms) {
    clearTimeout(animTimer);
    delete dialog.dataset.anim;
    void dialog.offsetWidth;
    dialog.dataset.anim = name;
    animTimer = setTimeout(() => { if (dialog.dataset.anim === name) delete dialog.dataset.anim; }, ms);
  }
  // Why the guide closed matters to whoever opened it: "Continue tour" means
  // carry on where we were, Escape means back out of it. The buttons pass
  // 'button' (their click Event must not arrive as the reason), Esc passes
  // 'escape', and anything programmatic leaves it undefined.
  function close(reason) {
    if (!openNow) return;
    const why = typeof reason === 'string' ? reason : undefined;
    const finish = inspectClose; inspectClose = null;
    readVersion++; readerRepo = null;
    openNow = false;
    stopHistory(); // the replay must not keep running behind a closed guide
    onRepo?.(null);
    delete dialog.dataset.state;
    // Collapse back to the warp line and shoot off to the right before it goes.
    animate('out', OUT_MS);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (openNow) return; // reopened mid-exit: leave it on screen
      dialog.removeAttribute('open'); dialog.hidden = true;
      delete dialog.dataset.hud; delete dialog.dataset.anim;
    }, OUT_MS - 20);
    onClose();
    prompt.hidden = !target;
    if (!prompt.hidden) prompt.focus({ preventScroll: true });
    finish?.(why);
  }
  // Fill the guide with a repo. Shared by a fresh open and by a mid-tour retune.
  function fill(r, options) {
    readerRepo = r; loaded = false; readVersion++;
    stopHistory(); syncTabs(); // a new repo means a new replay, and a re-check of where it belongs
    onRepo?.(r); // the host's corner screen follows whichever repo is on air
    inspectClose = typeof options.onClose === 'function' ? options.onClose : null;
    delete dialog.dataset.state;
    dialog.querySelector('.gri-status').textContent = options.status || (modeNow === 'drive' ? 'PARKED' : 'ON FOOT · PAUSED');
    const resume = dialog.querySelector('.gri-resume');
    resume.childNodes[0].textContent = options.resumeLabel || 'Continue exploring ';
    dialog.querySelector('.gri-footer-note').textContent = options.note || 'Your position is saved while you read.';
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
  }
  function open(repo = target?.repo, options = {}) {
    if (!repo) return false;
    // Already on air: the tour hops between stops without tearing the guide
    // down, so re-tune it to the new repo the way an island change warps in.
    if (openNow) {
      if (nameOf(readerRepo) === nameOf(repo) && !dialog.dataset.state) return true;
      fill(repo, options);
      animate('tune', IN_MS);
      setView(openingView());
      return true;
    }
    clearTimeout(hideTimer);
    fill(repo, options);
    onOpen(); prompt.hidden = true;
    document.getElementById('tooltip')?.classList.remove('show');
    if (document.pointerLockElement) document.exitPointerLock?.();
    // One layout everywhere: the right-side HUD the tour uses, walking or driving
    // up to a building, and clicking one from the orbit.
    dialog.dataset.hud = String(options.modal !== true);
    dialog.hidden = false; dialog.setAttribute('open', ''); openNow = true;
    animate('in', IN_MS);
    dialog.querySelector('.gri-close').focus({ preventScroll: true });
    setView(openingView());
    return true;
  }
  // Between tour stops: hold the guide open, veiled, while the camera flies on.
  function transit(repo) {
    if (!openNow) return false;
    readVersion++; // a README still downloading for the last stop must not land here
    dialog.dataset.state = 'transit';
    dialog.querySelector('.gri-transit-name').textContent = repo ? `→ ${repo.full_name || repo.name}` : 'Next stop';
    dialog.querySelector('.gri-status').textContent = 'TOUR · IN TRANSIT';
    return true;
  }
  async function loadReadme() {
    const repo = readerRepo, version = ++readVersion;
    if (!repo) return;
    const status = dialog.querySelector('.gri-readme-status'), retry = dialog.querySelector('.gri-retry'), article = dialog.querySelector('.gri-markdown');
    status.textContent = 'Loading README…'; retry.hidden = true; article.replaceChildren();
    article.setAttribute('aria-busy', 'true');
    const result = await readmeDocument(repo);
    if (version !== readVersion || readerRepo !== repo || !openNow) return;
    article.setAttribute('aria-busy', 'false');
    if (result.status === 'ready') {
      loaded = true; renderReadme(article, result.markdown, repo);
      status.textContent = result.truncated ? 'Showing the first 100,000 characters. Open GitHub for the complete README.' : result.markdown.trim() ? '' : 'This README is empty.';
    } else {
      status.textContent = result.status === 'missing' ? 'No README found at the repository root. You can explore the project on GitHub.' : 'Couldn’t load the README. Check your connection and try again.';
      retry.hidden = false;
    }
  }
  // The replay is an iframe, so it only exists while its tab is the one on
  // screen: leaving the tab, changing repo or closing the guide tears it down,
  // the way the corner screen does. Otherwise a phone keeps a video decoding
  // behind a README it is no longer showing.
  // A replay on a phone is two heavy pictures at once -- the city behind the
  // sheet and the history inside it -- competing for one GPU, which is what
  // made the replay stutter once it had finally loaded. The city is the one
  // nobody can see while the sheet is up, so it stands down: the same trade
  // the full-screen player makes with gourceCovering. On a roomy screen the
  // guide is a column beside a city that is still worth drawing, so it stays.
  function markReplaying(on) {
    const root = document.documentElement;
    if (on && handheld()) root.dataset.replay = '1';
    else delete root.dataset.replay;
  }
  function mountHistory() {
    const screen = dialog.querySelector('.gri-screen');
    const repo = readerRepo;
    if (!repo?.full_name || historyRepo === repo.full_name) return;
    historyRepo = repo.full_name;
    const frame = document.createElement('iframe');
    frame.src = gourceUrl(repo, { chrome: false });
    frame.title = `Commit history: ${repo.full_name}`;
    frame.allow = 'autoplay';
    frame.loading = 'lazy';
    // Gource View puts up its own header and progress readout while it works
    // through a history. That is its interface, not the guide's: in here the
    // replay should arrive as a picture and nothing else. So the frame is held
    // blank behind one line of our own until it reports the first frame on
    // screen -- with a fallback, because a replay that never announces itself
    // should still be watchable rather than hidden for good.
    const note = document.createElement('div');
    note.className = 'gri-screen-load';
    note.setAttribute('role', 'status');
    note.innerHTML = '<b></b><u></u><i></i>';
    note.querySelector('b').textContent = 'Winding back to the first commit';
    note.querySelector('i').textContent = `${repo.full_name} \u00b7 every file, as it was written`;
    screen.classList.add('loading');
    const reveal = () => {
      clearTimeout(historyTimer); historyTimer = 0;
      screen.classList.remove('loading');
      note.remove();
    };
    clearTimeout(historyTimer);
    historyTimer = setTimeout(reveal, 20000);
    const out = dialog.querySelector('.gri-history-open');
    out.href = gourceUrl(repo);
    out.setAttribute('aria-label', `Open ${repo.full_name} in Gource View, new tab`);
    const origin = new URL(frame.src, location.href).origin;
    historyListener = (e) => {
      if (e.origin !== origin || e.data?.source !== 'gource-view') return;
      if (e.source !== frame.contentWindow) return; // the mini screen and the full player answer for themselves
      if (e.data.type === 'video-ready') reveal();
      else if (e.data.type === 'video-open') { clearTimeout(historyTimer); historyTimer = setTimeout(reveal, 2500); }
    };
    window.addEventListener('message', historyListener);
    screen.replaceChildren(frame, note);
    markReplaying(true);
  }
  function stopHistory() {
    historyRepo = '';
    markReplaying(false);
    clearTimeout(historyTimer); historyTimer = 0;
    if (historyListener) { window.removeEventListener('message', historyListener); historyListener = null; }
    const screen = dialog.querySelector('.gri-screen');
    screen?.classList.remove('loading');
    screen?.replaceChildren();
  }
  function setView(view) {
    // Nothing to show in a tab that is not there: the History tab is hidden
    // wherever the corner screen already plays the same thing.
    if (view === 'history' && !historyTab()) view = 'overview';
    dialog.querySelector('.gri-overview').hidden = view !== 'overview';
    dialog.querySelector('.gri-readme').hidden = view !== 'readme';
    dialog.querySelector('.gri-history').hidden = view !== 'history';
    dialog.dataset.view = view; // the sheet lays itself out differently for the replay
    dialog.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    dialog.querySelector('.gri-content').scrollTop = 0;
    if (view === 'readme' && !loaded) loadReadme();
    if (view === 'history') mountHistory(); else stopHistory();
  }
  dialog.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  dialog.querySelector('.gri-retry').addEventListener('click', loadReadme);
  prompt.addEventListener('click', () => open());
  dialog.querySelector('.gri-close').addEventListener('click', () => close('button'));
  dialog.querySelector('.gri-resume').addEventListener('click', () => close('button'));
  return {
    get open() { return openNow; },
    close(reason) { close(reason); },
    inspect(repo, options) { return open(repo, options); },
    transit,
    key(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (openNow && e.code === 'KeyR') { e.preventDefault(); e.stopImmediatePropagation(); setView('readme'); return true; }
      if (openNow && e.code === 'KeyH' && historyTab()) { e.preventDefault(); e.stopImmediatePropagation(); setView('history'); return true; }
      if ((e.code === 'KeyE' && (target || openNow)) || (e.code === 'Escape' && openNow)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) { if (openNow) close(e.code === 'Escape' ? 'escape' : 'button'); else open(); }
        return true;
      }
      return false;
    },
    update(dt, mode, position) {
      if (mode !== 'walk' && mode !== 'drive') { this.reset(); return; }
      modeNow = mode;
      if (openNow) return;
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
    dispose() { close(); clearTimeout(animTimer); clearTimeout(hideTimer); prompt.remove(); dialog.remove(); style.remove(); },
  };
}
