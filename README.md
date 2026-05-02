# दृष्टि Drishti

> A standalone code-intelligence dashboard for any project.

**v1.0.0** — works on any code repository. Walks the project, classifies files
by language, builds a graph of files / functions / dependencies, scores
complexity, audits dependencies, inspects schemas (Firestore / Prisma / SQLite
/ Supabase / Mongoose / Postgres), and ranks risk. Runs **offline**.

---

## Quick start

### Easiest: launcher script (Windows)

```
git clone https://github.com/coz-whynot/Drishti.git
cd Drishti
npm install
Drishti.cmd
```

`Drishti.cmd` opens a folder picker, scans the chosen project, and opens the
dashboard in your default browser. Pin it to your taskbar for one-click access.

### CLI: run the scanner directly

```bash
git clone https://github.com/coz-whynot/Drishti.git
cd Drishti
npm install
node src/scan.js /absolute/path/to/your/project
# opens drishti.html in your default browser
```

### Watch mode (auto-rescan on file change, live Refresh button)

```bash
npm run watch
# open the URL it prints (usually http://localhost:8765)
```

---

## What's covered

### Languages
- **Python** — module/class/function graph, imports, complexity, silent failures
  (`try/except: pass`)
- **TypeScript / JavaScript** — same + swallowed promises, empty catches
- **Dart** — same + missing await on Future-returning functions
- **Plus** — generic file walk + dep audit on any source language

### Databases
The Schema tab populates from any of these when detected in the project:
- **Firestore** — collections from `firestore.rules`, indexed fields from
  `firestore.indexes.json`, field-usage refs from Python `firebase_admin` /
  TS `firebase v9` / Dart `cloud_firestore`
- **Prisma** — `prisma/schema.prisma` model declarations
- **SQLite** — CREATE TABLE in `migrations/`, `db/migrations/`, `sql/`
- **Supabase** — Postgres tables + CREATE POLICY (RLS) + ENABLE RLS detection
- **Mongoose** — `new Schema({...})` definitions
- **Postgres** — Knex.js builder migrations + raw SQL DDL

### Tabs
- **📊 Overview** — health score, top risks, what changed since last scan
- **🗺️ Map** — interactive node/edge graph
- **📐 Schema** — per-collection field-by-field usage across surfaces
- **📁 Files** — left tree + right read-only preview
- **🚨 Risks** — ranked list of red nodes
- **📋 Issues** — filterable issue list

---

## Plugin architecture

Drishti's parsers are plugins. Built-in:

| Plugin | Detects | Output |
|---|---|---|
| `python` | any `.py` file | Modules · classes · functions · imports · silent failures |
| `typescript` | any `.ts`/`.tsx`/`.js`/`.jsx` file | Same + swallowed promises + empty catches |
| `dart` | any `.dart` file or `pubspec.yaml` | Same + missing-await on Future fns |
| `firestore` | `firestore.rules` or Firestore SDK import | Collections + Schema-tab field usage |
| `prisma` | `prisma/schema.prisma` | Model collections + Schema-tab rows |
| `sqlite` | `.sql` files in `migrations/` | CREATE TABLE → Schema-tab rows |
| `supabase` | `supabase/` dir or `@supabase/supabase-js` import | Tables + RLS policies + RLS coverage issues |
| `mongoose` | `mongoose` in package.json | Schema definitions |
| `postgres` | `knexfile.js` or `pg` in package.json | Knex builder + raw SQL DDL |

Drop your own plugin in `plugins/<name>/` with a `manifest.json`, optional
`detect.js`, and parser files. Plugins under `plugins/` are gitignored by
default, so private/proprietary plugins never accidentally get pushed.

---

## Tauri desktop app (in development)

A Tauri 2.x desktop wrapper exists at `src-tauri/` (window, native folder
picker, recent-projects, file-preview path-traversal guard). The build is
not yet validated on the developer's primary machine due to a Windows
Application Control policy. See [src-tauri/README.md](src-tauri/README.md)
for build instructions on machines without WDAC blocking.

For everyday use, `Drishti.cmd` (Windows) or `node src/scan.js` (any OS)
work today.

---

## License

MIT — see [LICENSE](LICENSE).

## Privacy

- Drishti runs entirely on your machine. No telemetry, no analytics.
- Optional `sample-firebase.js` reads only Firestore field NAMES (no values),
  only when you run it explicitly with your service-account credentials.
- Scan output (`drishti-scans/*.json`, `drishti.html`) is never uploaded.
- The Files tab's preview pane refuses to read files matching a sensitive
  deny-list: `.env*`, `*credentials*`, `*.key`, `*.pem`, ssh keys.
