# Customize your city: `.git-city/city.json`

Gitilla builds your island automatically from your GitHub profile: the login
seeds the coastline, your top language picks the biome, stars decide the
attractions. With **one file in your profile repository** you take over the
parts you care about: the island's name, a welcome message, the landmarks,
which repositories lead the skyline, colours, signs, billboards, your
neighbours, the look, the player's soundtrack and your plane.

Every field is optional. Anything you leave out stays automatic.

Prefer a web page? The same guide, with copy buttons and live examples, is at
**[gitilla.com/customize.html](https://gitilla.com/customize.html)**.
Maintainers styling a single repository's building: see
[building-config.md](building-config.md).

## Quick start

1. **Have a profile repository.** It's the public repository named exactly like
   your login (`octocat/octocat`), the one that holds your profile README.
   An **organization** uses its `.github` repository instead (`acme/.github`),
   the one that holds the organization profile README.
   [GitHub's guide to profile READMEs](https://docs.github.com/en/account-and-profile/how-tos/profile-customization/managing-your-profile-readme)
   explains how to create it.
2. **Add `.git-city/city.json`** to its default branch:

   ```json
   {
     "$schema": "https://gitilla.com/schema/city-config.v1.json",
     "version": 1,
     "island": { "name": "Octo Isle", "biome": "tropical", "horizon": "isles" },
     "welcome": "Welcome to my city!"
   }
   ```

3. **Reload your city** (`https://gitilla.com/?user=<login>`)
   after about **5 minutes**. GitHub's CDN caches the file for up to 5 minutes.

Or skip the typing: open your city, press **Customize**, and **Publish**
(see [below](#the-customize-panel)).

## Field reference

`version` should be `1`. Unknown keys are ignored (with a warning), so a
typo never breaks your city; it just doesn't do anything.

| Field | Type | Allowed values / limits | What it does |
| --- | --- | --- | --- |
| `version` | number | `1` | Schema version. |
| `island.name` | text | ≤ 40 characters | Replaces "*login*'s city" on the welcome boards (and the farewell side), and heads your profile card. |
| `island.biome` | name | `meadow`, `alpine`, `tropical`, `savanna`, `lakeland` | Ground palette, relief, trees, beaches. Default: from your top language. |
| `island.shape` | name | `square`, `wide`, `tall`, `round`, `plus`, `octagon`, `blob` | Footprint of the paved city block. Default: from your login. |
| `island.horizon` | one of `hills`, `peaks`, `mesas`, `isles`, `pines`, `skyline`, `volcano`, `dunes`, `glacier`, `farmland`, `canyon` | What stands on the far horizon. Left out, the island draws one that suits its biome — alpine leans to snowy peaks and glaciers, savanna to mesas, dunes and canyons, tropical to islands and volcanoes — so two cities in the same biome rarely look out on the same thing. |
| `island.streets` | number | `3`–`6` (default `4`) | Width of the inner streets, in world units. The buildings keep their size whatever you choose — the cell grows with the street, so wider streets spread the city out over more of the island rather than thinning the towers. |
| `welcome` | text | ≤ 120 characters | Your message on the welcome boards where the roads leave town (wrapped to 4 lines). |
| `look.accent` | colour | `#rrggbb` | Glow colour of the plaza monument and its inlays. |
| `look.time` | name | `auto`, `day`, `sunset`, `night`, `cycle` | How the light starts: viewer's clock, fixed day, fixed low sun, fixed night, or the 60 s cycle. |
| `look.weather` | name | `clear`, `rain`, `snow` | How the weather starts. |
| `look.tv` | boolean | `true` / `false` | Old-television (CRT) look when your city opens. |
| `look.fx` | boolean | `true` / `false` | Bloom, colour grade and grain when your city opens. |
| `look.timezone` | name | an IANA time zone, ≤ 64 characters (`Europe/Copenhagen`, `Asia/Tokyo`, `UTC`) | Your local time: the city's automatic day and night follow it instead of the visitor's clock. |
| `landmarks` | list of names | ≤ 6 of `rollerCoaster`, `carousel`, `circusTent`, `dropTower`, `windTurbines`, `windmill`, `farm`, `campsite`, `radioTower`, `observatory`, `balloonPad`, `lighthouse`, `recordShop`, `robotMonument` | Attractions placed first, in your order. The island still tops up to its usual count (which grows with stars and followers). |
| `neighbours` | list of logins | ≤ 6 GitHub logins | The islands you reach by flying off the map. Yours come first; the rest are filled automatically (who you follow, contributors, featured developers). |
| `featured` | list of repo names | ≤ 12 of your repositories | Built next to the plaza and advertised first on the country billboards, in this order. |
| `hide` | list of repo names | ≤ 50 of your repositories | Left out of the city (no building, no billboard). Wins over `featured`. |
| `repos.<name>.color` | colour | `#rrggbb` | Facade colour instead of the language colour. |
| `repos.<name>.sign` | text | ≤ 40 characters | Replaces the name on the building's shop signs and the stats line on its rooftop board. |
| `repos.<name>.billboard` | text | ≤ 120 characters | Replaces the description on this repository's country billboard. |
| `repos.<name>.style` | name | `auto`, `tower`, `stepped`, `cottage`, `block` | Silhouette: tower with a spire, stepped tower, cottage with a pitched roof, or a plain block. Height still follows the stars. |
| `repos.<name>.graffiti` | object | `text` (≤ 60 characters, required), `color` (`#rrggbb`), `style` (`tag`, `bubble`, `stencil`) | Spray-painted on two ground-floor walls, below the shop sign. |
| `repos.<name>.roof` | name | `auto`, `garden`, `helipad`, `solar`, `pool`, `antenna`, `none` | What's on the flat roof (cottages ignore it). |
| `repos.<name>.neon` | colour | `#rrggbb` | The colour the lit windows glow at night. |
| `repos.<name>.flag` | text | an emoji or up to 3 characters | A small flag on the roof. |
| `player.music` | name | `floating-cities`, `deliberate-thought`, `cipher`, `digital-lemonade`, `crypto`, `none` | Soundtrack of the in-page Gource View player (music by Kevin MacLeod, CC BY 4.0). |
| `player.volume` | number | 0–100 | Its volume. |
| `plane.color` | colour | `#rrggbb` | Fuselage and tail of your biplane in fly mode. |
| `plane.name` | text | ≤ 24 characters | Painted on both sides of the fuselage. |

More details:

- **Repository names** must be your own (public, as Gitilla loads them) and
  are matched case-insensitively. `repos` holds at most 100 entries. Forks and
  archived repositories never get a building.
- **Text is free-form**: any language, emoji, punctuation. Gitilla only trims
  it, turns line breaks into spaces, removes invisible control and
  text-direction characters, and shortens it to the limit.
- **Colours** are exactly `#` plus six hex digits (`#8c78ff`). Names like `red`
  or short forms like `#fff` are ignored.
- **Numbers** outside their range are clamped (`"volume": 150` becomes 100).
- **Visitors stay in charge during a visit.** `look.time`, `look.weather`,
  `look.tv` and `look.fx` decide how your city *opens*; visitors can still flip
  the toolbar buttons. Their toggles last for the visit and don't change their
  saved TV / FX preference for other cities. A city without these fields
  keeps the visitor's own choices.
- **Preview parameters win**: `?biome=`, `?city=` and `?streets=` in the URL
  override `island.biome` / `island.shape` / `island.streets`, so you can try
  looks without editing.
- **Landmarks are best effort.** Each needs a free site of the right kind
  (the roller coaster needs the big fairground, wind turbines a hillside, the
  campsite a coast or wild spot). If the island has no room, it's skipped.

## Building config

Every building can be styled. The fields under `repos.<name>` (`style`,
`color`, `sign`, `billboard`, `graffiti`, `roof`, `neon`, `flag`) are the
**building config**, and they can come from two places:

1. **Your `city.json`**, under `repos["<name>"]`, for any of your repositories.
2. **The repository itself**, in `<owner>/<repo>/.git-city/building.json`
   (same fields, at the top level), so maintainers can style their own
   building. See [building-config.md](building-config.md).

**Your `city.json` wins, field by field.** For example, if a repository's file
sets `roof` and `graffiti` and you set `roof` and `color`, the building gets
your roof and colour and the repository's graffiti.

Gitilla reads `building.json` lazily: for the 16 most-starred buildings of a
city when it loads, and for any building someone clicks. Each file is limited
to 3 seconds and 16 KB, and cached for the visit.

```json
"repos": {
  "git-city": {
    "graffiti": { "text": "ship it!", "color": "#ff5ab4", "style": "bubble" },
    "roof": "helipad",
    "neon": "#8c78ff",
    "flag": "🏙️",
    "style": "tower"
  }
}
```

In **Customize** › Repositories, *edit* a repository to set these fields with
a live graffiti preview. **Copy as building.json** turns the result into a
file for the repository itself.

## Examples

A name and a message:

```json
{
  "version": 1,
  "island": { "name": "Schlunsen Isle" },
  "welcome": "Welcome to my city! I'm the creator of git city",
  "featured": ["git-city", "gource-view"],
  "landmarks": ["rollerCoaster", "observatory", "balloonPad"],
  "player": { "music": "cipher", "volume": 20 }
}
```

Everything:

```json
{
  "$schema": "https://gitilla.com/schema/city-config.v1.json",
  "version": 1,
  "island": { "name": "Schlunsen Isle", "biome": "tropical", "shape": "round" },
  "welcome": "Welcome to the island of broken builds",
  "look": { "accent": "#8c78ff", "time": "sunset", "weather": "snow", "tv": false, "fx": true, "timezone": "Europe/Copenhagen" },
  "landmarks": ["rollerCoaster", "observatory", "campsite"],
  "neighbours": ["gaearon", "antfu", "sindresorhus"],
  "featured": ["git-city", "gource-view"],
  "hide": ["dotfiles"],
  "repos": {
    "git-city": { "style": "tower", "color": "#64dedb", "sign": "you are here" },
    "gource-view": { "billboard": "Watch your repo grow" }
  },
  "player": { "music": "cipher", "volume": 20 },
  "plane": { "color": "#e4574f", "name": "Spirit of Rebase" }
}
```

## The Customize panel

Open any city and press **Customize** in the toolbar (in the ☰ menu on
phones). The panel shows whether that profile has a `city.json`, and whether
it was loaded, ignored or partly ignored. Then:

1. **Edit**: island name, biome, shape, welcome message, landmarks, look
   (accent, time, weather, TV, FX), neighbours, and per repository ★ feature,
   hide, facade colour, sign, billboard and building style, plus the player
   music / volume and your plane.
2. **Preview**: with *Live preview* on, every change is applied to the island
   around you within half a second. The draft goes through exactly the same
   validation and build as a published file, so what you see is what visitors
   will see. The JSON below updates as you go, with any warnings. *Revert*
   drops the draft. If you close the panel while previewing, a small "Previewing
   your unpublished draft" bar stays at the top until you reload or revert.
3. **Publish**: no tokens, no OAuth. Gitilla only ever opens GitHub's own
   editor in a new tab:
   - **No `city.json` yet**: *Publish on GitHub* opens
     `https://github.com/<login>/<login>/new/<branch>?filename=.git-city/city.json&value=…`,
     GitHub's "new file" page with the file already filled in. Commit it.
   - **`city.json` exists**: GitHub can't pre-fill an existing file, so press
     *Copy JSON*, then *Edit city.json on GitHub* (`…/edit/<branch>/.git-city/city.json`),
     select everything, paste, and commit.
   - **No profile repository**: the button offers to create it first.

   `<branch>` is your profile repository's default branch, looked up with
   one unauthenticated GitHub API request when the panel opens (`HEAD` if the
   API is rate-limited). You need to be signed in to GitHub and own the
   repository, as for any commit.

Anyone can open the panel on any city and preview ideas; only someone who can
commit to `<login>/<login>` (or to `<org>/.github`) can save the result.

## Organizations

Every GitHub organization has a city as well: `?user=<org>` builds it from the
organization's public repositories, its members (they become the neighbouring
islands) and its public activity. Everything on this page applies to it.

The one difference is where the file lives. Organizations have no repository
named after themselves; their profile repository is **`.github`**, so the
config is `<org>/.github/.git-city/city.json`. Gitilla looks for
`<org>/<org>/.git-city/city.json` first and falls back to `.github`, and the
Customize panel points its Publish button at whichever one applies.

```
a developer   schlunsen/schlunsen/.git-city/city.json
an org        Lunar-Rails/.github/.git-city/city.json
```

## Caching and updates

- Gitilla reads `https://raw.githubusercontent.com/<login>/<login>/HEAD/.git-city/city.json`
  (your default branch), and for an organization
  `https://raw.githubusercontent.com/<org>/.github/HEAD/.git-city/city.json`. It doesn't use the GitHub API, so it never eats into
  the 60-requests-per-hour budget.
- GitHub's CDN caches the file for **up to 5 minutes**, so changes can take
  that long to appear. A hard reload doesn't skip that cache.
- A missing file (404) is simply the automatic city.
- Your city waits at most **4 seconds** for the file. If it's slower than that
  (a slow network, or a slow device still warming up its graphics), the
  automatic city appears first and your settings are applied as soon as the
  file arrives. After 12 seconds Gitilla gives up for that visit.
- Pinned `neighbours` apply immediately. Only the automatic top-up is cached
  in the visitor's browser for a week.

## How Gitilla treats the file (security model)

`city.json` is **data, never code**, and other people's cities load it into
your browser, so it is handled defensively:

- **Size first**: files over **32 KB** are ignored unread, and the download
  stops once 32 KB have arrived.
- **`JSON.parse` only**: no `eval`, no `new Function`, no templates.
- **Strict whitelist** (`public/city-config.js`, `normalizeCityConfig`): only
  the fields above are read; unknown keys are dropped; named options must be
  from the fixed lists; colours must match `#rrggbb`; numbers are clamped;
  logins must follow GitHub's rules; repository names must be the profile's
  own repositories; lists and text are capped. Keys like `__proto__` and
  `constructor` can't reach any object prototype (repository settings live in
  a prototype-less map).
- **Text is free-form but inert**: it reaches the page only through canvas
  `fillText` (boards, signs, the plane) or DOM `textContent` (profile card,
  Customize panel). It's never parsed as HTML.
- **No URLs**: v1 has no URL fields, and Gitilla never loads an image, font,
  frame or link named by a config. (`$schema` is an editor hint and is never
  fetched.) Neighbour avatars come from `github.com/<login>.png`, built from a
  validated login.
- **Any failure means no config**: bad JSON, a wrong shape, a timeout or a
  network error leaves the automatic city and logs a console warning. It never
  breaks the page.
- **Content-Security-Policy** (`public/index.html`) as defence in depth.
  Scripts come only from this site, `cdn.jsdelivr.net` (three.js) and the
  inline import map, which is allowed by its SHA-256 hash (update the hash
  if the map changes). Connections go only to `api.github.com` and
  `raw.githubusercontent.com`, images to this site, `github.com` and
  `avatars.githubusercontent.com`, frames to the Gource View player on
  `schlunsen.github.io`. There are no plugins, no workers and no `<base>`.
  Styles allow `'unsafe-inline'` because the app uses inline `<style>` and
  style attributes; inline scripts are not allowed.

There is no content moderation: your text is yours. Gitilla only makes sure
it fits on the signs and can't do anything but be text.

## Editor support

Add the `$schema` line (as in the examples) and editors like VS Code validate
the file and autocomplete every field as you type. The schema is
[`public/schema/city-config.v1.json`](../public/schema/city-config.v1.json).
It is a little stricter than Gitilla itself: the editor flags an over-long
text, while Gitilla just shortens it.

## Troubleshooting

- **"city.json ignored: …"**: a short notice at the bottom of the city (shown
  to anyone viewing it) means the file exists but couldn't be used at all:
  invalid JSON (the message says where), larger than 32 KB, or not a JSON
  object. Fix it and wait up to 5 minutes.
- **"city.json: N settings ignored"**: the file loaded, but some fields were
  dropped (a misspelt key, a colour like `red`, a repository that isn't
  yours). Open **Customize** for the list, or look in the browser console,
  where each one is logged with the reason
  (`[git-city] login/login/.git-city/city.json: …`).
- **Nothing changes**:
  - Wait out the 5-minute cache.
  - Check the path is exactly `.git-city/city.json`, on the default branch.
  - Check the repository is public and named exactly like your login.
- **A landmark is missing**: the island had no free site of the right kind
  (see *Landmarks are best effort* above). Try a different biome, fewer
  landmarks, or swap one for another.
- **A featured repository isn't there**: forks and archived repositories don't
  get buildings, and Gitilla shows at most 100 repositories.
