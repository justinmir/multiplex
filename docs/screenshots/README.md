# Screenshots

These images are referenced by the top-level [`README.md`](../../README.md) and are
generated from seeded demo data — they are **not** committed by default.

Generate (or refresh) them with:

```bash
npm run screenshots
```

That builds the app, launches it with `MULTIPLEX_SEED=1` against a throwaway
profile (your real data is untouched), and writes:

- `home.png` — the Home triage view
- `project.png` — the project Overview view
- `session.png` — the live session view

On headless Linux the script wraps itself in `xvfb-run` automatically; otherwise
run it on a machine with a display.
