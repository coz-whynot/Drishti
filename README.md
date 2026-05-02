# दृष्टि Drishti

> A standalone code-intelligence dashboard for any project.

**Status:** v0.1.0-alpha — under active development. Tauri desktop shell + generic parsers in progress.

Drishti scans a code repository and produces a single visual dashboard:
graph of files / functions / dependencies, complexity warnings, dependency
audit, schema inspection (when Firestore detected), risk ranking.

It runs **offline** — your code never leaves your machine.

---

## Status by feature

| Feature | Status |
|---|---|
| Browser-based dashboard (run `node src/scan.js <project>`) | working |
| Tauri desktop shell + installer | in progress (Phase B) |
| Folder picker startup screen | planned (Phase C) |
| Generic Python parser | planned (Phase D) |
| Generic TypeScript / JavaScript parser | planned (Phase D) |
| Generic Dart parser | planned (Phase D) |
| File explorer pane | planned (Phase E) |
| Cross-platform installers (Win / Mac / Linux) | planned (Phase F) |

See [docs/spec/standalone-tool-design.md](docs/spec/standalone-tool-design.md) for the full v0.1 plan.

---

## Quick start (CLI mode, until desktop app ships)

```bash
git clone https://github.com/coz-whynot/drishti.git
cd drishti
npm install
node src/scan.js /absolute/path/to/your/project
# opens drishti.html in your default browser
```

Drishti walks the project, classifies files by language, and renders a
dashboard. For Firestore projects, the **Schema** tab shows field-by-field
usage across the codebase.

---

## Plugin architecture

Drishti's parsers are plugins. Built-in plugins (planned for v0.1):

- `python` — function/class graph, complexity, imports
- `typescript` — same for `.ts`/`.tsx`/`.js`/`.jsx`
- `dart` — same for `.dart`
- `firestore` — Schema tab when Firestore is detected

Drop your own plugin in `plugins/<name>/` with a `manifest.json` and parser
files. The plugin loader auto-detects which plugins apply to a given project.

Plugin contract documented in `docs/plugins.md` (TODO).

---

## License

MIT — see [LICENSE](LICENSE).

---

## Privacy

- Drishti runs entirely on your machine. No telemetry, no analytics, no
  network calls except whatever you explicitly trigger (e.g. dependency audit).
- The optional `sample-firebase.js` script reads field NAMES only from your
  Firestore (no values), and only if you run it explicitly with credentials.
- Scan output (`drishti-scans/*.json`, `drishti.html`) is never uploaded.
