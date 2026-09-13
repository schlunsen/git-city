/*
 * Small DOM / formatting / disposal helpers with no city state.
 */

export const $ = (id) => document.getElementById(id);

// A screen the repo guide has to cover to be readable, rather than sit beside
// the city. Below this width repo-inspector.js lays the guide out as a sheet
// across almost the whole viewport, so anything that would raise it *unasked*
// -- a tour stop, a tapped building -- offers it instead and lets the visitor
// open it. Defined once: a guide that opens on one rule and is laid out on
// another is how a panel ends up covering a city nobody asked it to cover.
export const handheld = () => matchMedia('(max-width:700px)').matches;

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function fmtNum(n) {
  if (n == null) return '0';
  if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k';
  return String(n);
}
export function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
export function prettify(lang) {
  const map = { 'c++': 'C++', 'c#': 'C#', 'jupyter notebook': 'Jupyter' };
  return map[lang] || lang;
}
export function setLoadStatus(msg) {
  const el = document.getElementById('load-status');
  if (el) el.textContent = msg;
}
export function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (m.userData.shared) return;
        if (m.map && !m.map.userData.shared) m.map.dispose();
        if (m.emissiveMap && !m.emissiveMap.userData.shared) m.emissiveMap.dispose();
        m.dispose();
      });
    }
  });
}

export function readPref(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function writePref(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }

export const hexNum = (hex) => parseInt(hex.slice(1), 16);

export const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
