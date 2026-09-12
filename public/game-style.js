// ---------------------------------------------------------------------------
// game-style.js — the bomb run's injected stylesheet (HUD, countdown, target
// card, damage bars, end card). Imported by game.js.
// ---------------------------------------------------------------------------

export function injectGameStyle() {
  if (document.getElementById('gbr-style')) return;
  const s = document.createElement('style');
  s.id = 'gbr-style';
  s.textContent = `
  .gbr-hud { position: fixed; left: 50%; top: calc(var(--topbar-h, 58px) + 12px); transform: translateX(-50%); z-index: 32;
    display: flex; align-items: center; gap: 4px; padding: 5px; max-width: calc(100vw - 20px); flex-wrap: wrap; justify-content: center;
    background: rgba(17, 24, 36, 0.86); border: 1px solid rgba(255, 160, 58, 0.45); border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    font: 12px/1.1 var(--mono, ui-monospace, Menlo, monospace); color: var(--ink-300, #c2cad8); user-select: none; -webkit-user-select: none; }
  .gbr-hud[hidden], .gbr-count[hidden], .gbr-end[hidden], .gbr-combo[hidden], .gbr-warn[hidden], .gbr-arrow[hidden],
  .gbr-cross[hidden], .gbr-target[hidden], .gbr-bar[hidden], .gbr-num[hidden], .gbr-list[hidden], .gbr-list-head[hidden] { display: none !important; }
  .gbr-stat { display: inline-flex; align-items: baseline; gap: 4px; padding: 6px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.05);
    font-variant-numeric: tabular-nums; white-space: nowrap; }
  .gbr-stat b { color: var(--ink-100, #f1f4f9); font-size: 15px; font-weight: 700; }
  .gbr-stat small { font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-500, #7f8ca3); }
  .gbr-score b { color: #ffc15a; }
  .gbr-bombs { gap: 5px; align-items: center; }
  .gbr-bombs i { position: relative; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #0a0d16; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
  .gbr-bombs i.on { background: #2a2f3a; box-shadow: inset 0 -3px 0 #ef5b4c; }
  .gbr-bombs i.regen::after { content: ""; position: absolute; inset: 0; transform-origin: bottom; transform: scaleY(var(--k, 0)); background: rgba(239, 91, 76, 0.55); }
  .gbr-combo { position: relative; color: #0a0d16; background: #ffc15a; overflow: hidden; }
  .gbr-combo b { color: #0a0d16; }
  .gbr-combo::after { content: ""; position: absolute; left: 0; bottom: 0; height: 3px; width: calc(var(--k, 1) * 100%); background: #ef5b4c; }
  .gbr-mute, .gbr-exit { font: inherit; border: 0; cursor: pointer; border-radius: 8px; padding: 7px 10px; background: rgba(255, 255, 255, 0.06); color: var(--ink-300, #c2cad8); }
  .gbr-mute:hover, .gbr-exit:hover { background: rgba(255, 255, 255, 0.12); color: var(--ink-100, #f1f4f9); }
  .gbr-exit kbd { font: 600 9px/1 var(--mono, monospace); padding: 2px 4px; border-radius: 4px; border: 1px solid rgba(110, 135, 175, 0.3); margin-right: 4px; }
  .gbr-count { position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%); z-index: 74; pointer-events: none;
    font: 800 clamp(64px, 12vw, 128px)/1 var(--display, system-ui, sans-serif); color: #ffc15a;
    -webkit-text-stroke: 5px #0a0d16; paint-order: stroke fill; text-shadow: 0 8px 0 rgba(10, 13, 22, 0.35); }
  .gbr-count.pop { animation: gbr-pop 0.75s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
  @keyframes gbr-pop { 0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; } 25% { opacity: 1; } 70% { transform: translate(-50%, -50%) scale(1); opacity: 1; } 100% { transform: translate(-50%, -50%) scale(1.15); opacity: 0.85; } }
  .gbr-feed { position: fixed; left: 50%; top: calc(var(--topbar-h, 58px) + 66px); transform: translateX(-50%); z-index: 31;
    display: flex; flex-direction: column; align-items: center; gap: 5px; pointer-events: none; }
  .gbr-toast { padding: 5px 11px; border-radius: 999px; background: rgba(17, 24, 36, 0.8); border: 1px solid rgba(110, 135, 175, 0.3);
    color: var(--ink-300, #c2cad8); font: 600 11px var(--mono, monospace); white-space: nowrap; animation: gbr-in 0.25s ease both; transition: opacity 0.45s, transform 0.45s; }
  .gbr-toast.kill { padding: 7px 13px; font-size: 12px; color: var(--ink-100, #f1f4f9); border-color: rgba(255, 160, 58, 0.55); background: rgba(40, 24, 12, 0.9); }
  .gbr-toast.out { opacity: 0; transform: translateY(-6px); }
  @keyframes gbr-in { from { opacity: 0; transform: translateY(8px) scale(0.95); } }
  .gbr-warn { position: fixed; left: 50%; bottom: calc(var(--transport-h, 96px) + 70px); transform: translateX(-50%); z-index: 33; pointer-events: none;
    padding: 8px 16px; border-radius: 999px; background: #ffc15a; color: #0a0d16; font: 700 13px var(--mono, monospace);
    border: 2px solid #0a0d16; box-shadow: 0 6px 0 rgba(10, 13, 22, 0.35); animation: gbr-blink 0.9s ease-in-out infinite; }
  @keyframes gbr-blink { 50% { opacity: 0.55; } }
  .gbr-arrow { position: fixed; left: 0; top: 0; z-index: 31; pointer-events: none; display: flex; align-items: center; gap: 6px;
    padding: 5px 10px 5px 6px; border-radius: 999px; background: rgba(17, 24, 36, 0.82); border: 1px solid rgba(255, 160, 58, 0.5);
    color: var(--ink-100, #f1f4f9); font: 600 11px var(--mono, monospace); white-space: nowrap; }
  .gbr-arrow i { width: 0; height: 0; border-left: 10px solid #ffa03a; border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
  .gbr-cross { position: fixed; left: 0; top: 0; z-index: 29; width: 34px; height: 34px; pointer-events: none; border-radius: 50%;
    border: 2px solid rgba(241, 244, 249, 0.75); box-shadow: 0 0 0 1.5px rgba(10, 13, 22, 0.55); transition: border-color 0.12s, width 0.12s, height 0.12s; }
  .gbr-cross i { position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%; background: rgba(241, 244, 249, 0.9); }
  .gbr-cross.lock { width: 28px; height: 28px; border-color: #ff5a4e; box-shadow: 0 0 0 1.5px rgba(10, 13, 22, 0.7), 0 0 12px rgba(255, 90, 78, 0.6); }
  .gbr-cross.lock i { background: #ff5a4e; }
  .gbr-target { position: fixed; left: max(16px, env(safe-area-inset-left)); top: calc(var(--topbar-h, 58px) + 14px); z-index: 30; width: 230px; pointer-events: none;
    padding: 11px 13px 12px 15px; border-radius: 10px; background: var(--panel, rgba(17, 24, 36, 0.86)); border: 1px solid var(--line, rgba(110, 135, 175, 0.22));
    border-left: 4px solid var(--lang, #64dedb); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    font: 11px/1.3 var(--mono, ui-monospace, monospace); color: var(--ink-300, #c2cad8); }
  .gbr-t-kicker { font-size: 9px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #ffa03a; }
  .gbr-t-name { margin: 3px 0 2px; font: 700 17px/1.15 var(--display, system-ui, sans-serif); color: var(--ink-100, #f1f4f9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gbr-t-meta { display: flex; gap: 10px; color: var(--ink-500, #7f8ca3); }
  .gbr-t-bar, .gbr-bar i { position: relative; height: 7px; margin: 8px 0 5px; border-radius: 4px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
  .gbr-t-bar i, .gbr-bar em { position: absolute; inset: 0; transform-origin: left; background: #58c99b; transition: transform 0.15s; }
  [data-tone="warn"] .gbr-t-bar i, .gbr-bar[data-tone="warn"] em { background: #f6c343; }
  [data-tone="bad"] .gbr-t-bar i, .gbr-bar[data-tone="bad"] em { background: #ef5b4c; }
  .gbr-t-row { display: flex; justify-content: space-between; gap: 8px; }
  .gbr-t-hp { color: var(--ink-100, #f1f4f9); font-weight: 600; }
  .gbr-t-stage { color: #ffb45c; }
  .gbr-t-prog { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(110, 135, 175, 0.18); color: var(--ink-500, #7f8ca3); }
  .gbr-layer { position: fixed; inset: 0; z-index: 28; pointer-events: none; overflow: hidden; }
  .gbr-bar { position: absolute; left: 0; top: 0; min-width: 108px; padding: 4px 7px 2px; border-radius: 7px; background: rgba(17, 24, 36, 0.82);
    border: 1px solid rgba(110, 135, 175, 0.3); font: 600 10px/1.1 var(--mono, monospace); color: var(--ink-100, #f1f4f9); text-align: center; white-space: nowrap; }
  .gbr-bar span { display: block; font-size: 9px; font-weight: 500; color: #ffb45c; }
  .gbr-bar i { display: block; height: 5px; margin: 3px 0 2px; }
  .gbr-num { position: absolute; transform: translate(-50%, -50%); font: 800 14px var(--display, system-ui, sans-serif); color: #fff3c4;
    -webkit-text-stroke: 3px #0a0d16; paint-order: stroke fill; white-space: nowrap; }
  .gbr-num.big { font-size: 24px; color: #ffb45c; }
  .gbr-num.go { animation: gbr-rise 0.9s ease-out forwards; }
  @keyframes gbr-rise { 0% { opacity: 0; transform: translate(-50%, -30%) scale(0.7); } 15% { opacity: 1; transform: translate(-50%, -60%) scale(1.1); } 100% { opacity: 0; transform: translate(-50%, -260%) scale(1); } }
  .gbr-end { position: fixed; inset: 0; z-index: 75; display: grid; place-items: center; padding: 16px; background: rgba(8, 11, 18, 0.45); }
  .gbr-card { width: min(420px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 22px 22px 18px; border-radius: 16px; text-align: center;
    background: var(--panel-solid, #131b28); border: 1px solid var(--line, rgba(110, 135, 175, 0.22)); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    font-family: var(--mono, ui-monospace, monospace); color: var(--ink-300, #c2cad8); animation: gbr-in 0.35s ease both; }
  .gbr-kicker { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #ffa03a; }
  .gbr-card h2 { margin: 6px 0 4px; font: 700 28px/1.1 var(--display, system-ui, sans-serif); color: var(--ink-100, #f1f4f9); }
  .gbr-end.win .gbr-card { border-color: rgba(100, 222, 219, 0.5); }
  .gbr-end.win .gbr-kicker { color: var(--accent, #64dedb); }
  .gbr-why { margin: 0 0 14px; font-size: 12px; color: var(--ink-500, #7f8ca3); }
  .gbr-why b { color: var(--ink-100, #f1f4f9); }
  .gbr-grid { display: grid; grid-template-columns: 1fr auto; gap: 7px 14px; margin: 0 0 14px; padding: 12px 14px; border-radius: 10px;
    background: rgba(255, 255, 255, 0.04); text-align: left; font-size: 12px; }
  .gbr-grid dt { color: var(--ink-500, #7f8ca3); }
  .gbr-grid dd { margin: 0; text-align: right; color: var(--ink-100, #f1f4f9); font-weight: 600; font-variant-numeric: tabular-nums; }
  .gbr-list-head { margin: 0 0 6px; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-500, #7f8ca3); }
  .gbr-list { list-style: none; margin: 0 0 16px; padding: 0; max-height: 168px; overflow-y: auto; text-align: left; font-size: 11px; }
  .gbr-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 10px; align-items: baseline; padding: 5px 2px; border-bottom: 1px solid rgba(110, 135, 175, 0.12); }
  .gbr-list .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-100, #f1f4f9); padding: 0 0 0 8px; border: 0; border-left: 3px solid var(--lang, #64dedb);
    background: none; font: inherit; text-align: left; cursor: pointer; text-decoration: underline dotted rgba(241, 244, 249, 0.35); text-underline-offset: 3px; }
  .gbr-list .n:hover, .gbr-list .n:focus-visible { color: var(--accent, #64dedb); text-decoration-color: currentColor; }
  .gbr-list .s { color: var(--ink-500, #7f8ca3); }
  .gbr-list .st { color: #f6c343; }
  .gbr-list .st.done { color: #58c99b; }
  .gbr-list .d { color: #ffb45c; font-variant-numeric: tabular-nums; }
  .gbr-actions { display: flex; gap: 8px; justify-content: center; }
  .gbr-actions button { flex: 1; font: 600 13px var(--mono, monospace); border: 0; border-radius: 8px; padding: 11px 14px; cursor: pointer; }
  .gbr-again { background: var(--accent, #64dedb); color: var(--accent-ink, #082524); }
  .gbr-leave { background: rgba(255, 255, 255, 0.08); color: var(--ink-100, #f1f4f9); }
  .gbr-actions button:hover { filter: brightness(1.08); }
  /* While playing: the city's cards step aside, the explore HUD offers no travel. */
  body.gbr-on #showcase-card, body.gbr-on #feed, body.gbr-on #legend, body.gbr-on #explorer, body.gbr-on #tooltip { visibility: hidden !important; }
  .gcx-game { flex: none; font: inherit; border: 0; cursor: pointer; border-radius: 999px; padding: 6px 11px; background: rgba(255, 160, 58, 0.16); color: #ffb45c; }
  .gcx-game:hover { background: rgba(255, 160, 58, 0.28); }
  .gcx-hud.gcx-gaming .gcx-game, .gcx-hud.gcx-gaming .gcx-next-hud, body.gbr-on .gcx-next { display: none; }
  @media (max-width: 900px), (max-height: 500px) {
    .gcx-game .gcx-lbl { display: none; }
    .gcx-game { padding: 6px 9px; }
    .gbr-hud { top: calc(var(--topbar-h, 58px) + 62px); gap: 3px; padding: 4px; }
    .gbr-stat { padding: 5px 7px; }
    .gbr-stat small, .gbr-exit kbd { display: none; }
    .gbr-feed { top: calc(var(--topbar-h, 58px) + 112px); left: auto; right: 10px; transform: none; align-items: flex-end; }
    .gbr-toast { font-size: 10px; }
    .gbr-target { top: calc(var(--topbar-h, 58px) + 112px); left: 10px; width: 150px; padding: 8px 10px 9px 12px; }
    .gbr-t-name { font-size: 14px; }
    .gbr-t-meta, .gbr-t-prog, .gbr-t-kicker { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .gbr-count.pop, .gbr-toast, .gbr-card, .gbr-warn { animation: none; } .gbr-num.go { animation-duration: 0.01s; } }`;
  document.head.append(s);
}
