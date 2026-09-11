# Style your repository's building: `.git-city/building.json`

In [Gitilla](https://gitilla.com/) every repository is a
building: stars make it tall, the language paints it. Maintainers can give a
repository's building some personality with one small file in the repository
itself:

```
<owner>/<repo>/.git-city/building.json
```

Commit it to the default branch. It shows up in the owner's city within about
5 minutes. (There's also a web version of this guide:
[How to customize](https://gitilla.com/customize.html#repo).)

## Example

```json
{
  "$schema": "https://gitilla.com/schema/building-config.v1.json",
  "version": 1,
  "graffiti": { "text": "ship it!", "color": "#ff5ab4", "style": "bubble" },
  "roof": "garden",
  "neon": "#8c78ff",
  "flag": "🏴‍☠️",
  "sign": "open 24/7"
}
```

With `$schema`, editors like VS Code validate the file and autocomplete every
field.

## Fields

Every field is optional; anything left out stays automatic.

| Field | Allowed values / limits | What it does |
| --- | --- | --- |
| `graffiti.text` | text, ≤ 60 characters (required for graffiti) | Spray-painted on two ground-floor walls: outline, fill, overspray, a few drips. |
| `graffiti.color` | `#rrggbb` | Paint colour (default depends on the style). |
| `graffiti.style` | `tag`, `bubble`, `stencil` | A quick marker tag, fat bubble letters, or a stencil. Default `tag`. |
| `roof` | `auto`, `garden`, `helipad`, `solar`, `pool`, `antenna`, `none` | What's on the flat roof. Cottages (pitched roofs) ignore it. |
| `neon` | `#rrggbb` | The colour the lit windows glow at night. |
| `flag` | an emoji or up to 3 characters | A small flag on the roof. |
| `style` | `auto`, `tower`, `stepped`, `cottage`, `block` | Silhouette: tower with a spire, stepped tower, cottage with a pitched roof, plain block. Height always follows the stars. |
| `color` | `#rrggbb` | Facade colour instead of the language colour. |
| `sign` | text, ≤ 40 characters | Replaces the name on the shop signs and the stats line on the rooftop board. |
| `billboard` | text, ≤ 120 characters | Replaces the description on the repository's country billboard (if it gets one). |

Text is free-form (any language, emoji, punctuation). Gitilla trims it,
removes invisible control and text-direction characters, and shortens it to
the limit. Colours must be exactly `#` plus six hex digits.

## Precedence

The city belongs to its owner. If the owner's profile config
(`<owner>/<owner>/.git-city/city.json`, see [city-config.md](city-config.md))
has an entry for this repository under `repos`, **that entry wins, field by
field**. Example: the repository sets `roof` and `graffiti`, the owner sets
`roof` and `color`. The building gets the owner's roof and colour and the
repository's graffiti. The owner can also hide the repository entirely.

## When Gitilla reads it

- Only for buildings that are on screen: when a city loads, Gitilla checks
  the **16 most-starred** repositories, and any other building **when someone
  clicks it**. Answers are cached for the visit.
- A missing file (404) means no config. The browser may log each 404 in its
  console, which is why Gitilla keeps these requests few.
- Each request is limited to **3 seconds** and **16 KB**; anything bigger,
  slower or broken is ignored and the building keeps its automatic look.
- The file is read from `raw.githubusercontent.com` (the default branch), not
  the GitHub API, and GitHub's CDN caches it for up to 5 minutes.
- Forks and archived repositories don't get buildings, so their files are
  never read.

## Security

`building.json` is data, never code, and it is handled exactly like a
`city.json` (details in
[city-config.md](city-config.md#how-git-city-treats-the-file-security-model)):

- `JSON.parse` only.
- A strict whitelist of the fields above; unknown keys are dropped.
- Named options come from fixed lists.
- Colours are validated.
- Text is capped and only ever painted onto a canvas with `fillText`, so it
  can't become HTML.
- No field is a URL, and Gitilla never loads anything a config names.
- Any failure falls back to the automatic building.
