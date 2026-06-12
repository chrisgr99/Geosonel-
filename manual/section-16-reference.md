# Section 16 — Reference

_Status: outline._

The look-it-up section. These tables are meant to be generated from and checked against
the code so they do not drift; treat the code as the source of truth.

## In this section

- **Keyboard shortcuts** — transport, editing, canvas, zoom, and tab navigation.
- **The scripting API** — every function callable from a callback (playNote, playSound,
  applyForce, print, the construction operations) with arguments and forms.
- **The firing context** — every value readable as `this.*` inside each callback kind.
- **The colour signals** — the full list of `this.col.*` channels and what each means.
- **Inspector field reference** — every field, by band and object kind: meaning, range,
  default.
- **Scene file reference** — the top-level scene fields and the per-object fields, for
  anyone editing the JSON or a score by hand.
- **Selectors** — the target forms (id, current, all, selection, group).

> Maintenance note: prefer generating these tables from the schema and source modules
> (for example the inspector schema, the id and field definitions, and the API surface)
> rather than hand-writing them, so the reference stays in step with the app.
