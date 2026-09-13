/**
 * Gitilla — sponsors.
 *
 * Sponsorship pays for one island: the author's. A sponsor buys a car in the
 * traffic with their name on its doors, a hoarding on a plot out in the
 * country, or -- for the big ones -- the banner behind the plane that circles
 * the city. Everywhere else, every other
 * developer's city, is untouched: sponsors.json names the single login they
 * apply to, and a sponsor cannot appear on anybody else's island by accident,
 * whoever is looking at it or however the city was reached.
 *
 * The data is a file in the repository (public/sponsors.json), so taking a
 * sponsorship is an edit and a deploy, with the usual review and history.
 * Nothing here reaches the network beyond that one same-origin file, and a
 * missing or broken file simply means no sponsors.
 */

let loaded = null; // the in-flight (then settled) promise: fetched once per page

/** Fetch sponsors.json once. Never throws: no file, bad JSON, offline -> no sponsors. */
export function loadSponsors() {
  if (loaded) return loaded;
  loaded = fetch('./sponsors.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && typeof d === 'object' ? d : null))
    .catch(() => null);
  return loaded;
}

let data = null;
loadSponsors().then((d) => { data = d; });

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Only #rgb / #rrggbb, so a colour out of the file can never be a url() or an
// expression: this string ends up in a canvas fillStyle.
const colour = (s, fallback) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(s ?? '')) ? String(s) : fallback);

/**
 * The sponsors for a login, or null. Synchronous: whatever has arrived by the
 * time a city is built. app.js awaits loadSponsors() first, so by then it has.
 */
export function sponsorsFor(login) {
  const who = clean(login, 64).toLowerCase();
  if (!data || !who || clean(data.island, 64).toLowerCase() !== who) return null;
  const cars = (Array.isArray(data.cars) ? data.cars : [])
    .map((c) => ({
      name: clean(c?.name, 18),
      color: colour(c?.color, '#e4574f'),
      ink: colour(c?.ink, '#fff8e8'),
    }))
    .filter((c) => c.name)
    .slice(0, 8); // more than this stops reading as traffic
  // Roadside plots: a hoarding out in the country, on the sponsor's own colour.
  const plots = (Array.isArray(data.plots) ? data.plots : [])
    .map((b) => ({
      name: clean(b?.name, 22),
      tagline: clean(b?.tagline, 46),
      color: colour(b?.color, '#fffaf0'),
      ink: colour(b?.ink, '#1a2233'),
    }))
    .filter((b) => b.name)
    .slice(0, 6); // one per road out of town, and there are not many roads
  const p = data.plane;
  const plane = p && clean(p.name, 28)
    ? { name: clean(p.name, 28), text: clean(p.text, 64) || `${clean(p.name, 28)} supports Gitilla`,
        url: httpUrl(p.url), logo: localLogo(p.logo) }
    : null;
  return cars.length || plots.length || plane ? { cars, plots, plane } : null;
}

/**
 * A sponsor's logo, as a path to a file in this repository. Deliberately not a
 * URL: an image from the sponsor's own domain would be blocked by the page's
 * content-security-policy, would taint the canvas it is drawn on (which breaks
 * the WebGL texture outright), and would put their uptime in front of ours. So
 * the artwork is vendored under public/sponsors/ and reviewed like any other
 * file. Anything with a scheme, a protocol-relative start, a parent segment or
 * a leading slash is refused.
 */
function localLogo(v) {
  const s = clean(v, 120);
  if (!s || !s.startsWith('sponsors/')) return null;
  if (/[:\\]|\/\/|\.\./.test(s)) return null;
  return /\.(png|jpe?g|webp|svg)$/i.test(s) ? `./${s}` : null;
}

/** http(s) only, and only if it parses: this becomes a link somebody can click. */
function httpUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}
