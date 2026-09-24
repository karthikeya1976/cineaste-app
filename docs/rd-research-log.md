# R&D Research Log

Append-only. One entry per scheduled research cycle (see
`.github/workflows/rd-department.yml` and the published architecture doc
for the full system). This is the R&D Decision Agent's own memory across
cycles — it reads this file before proposing, specifically so it doesn't
re-propose an idea that was already rejected for a stated reason.

Every cycle gets an entry, including a cycle where nothing was proposed —
"no proposal this cycle" is a normal, silent-to-the-founder outcome (the
anti-churn guard in the design doc), but it still gets a one-line log
entry so the history is complete.

**Entry format:**

```
## YYYY-MM-DD — <outcome: proposed | rejected | deferred | no-proposal>

- **Considered:** <what was looked at this cycle>
- **Outcome:** <one of the four above, plus why>
- **Plan doc:** <link to docs/plans/... if outcome was "proposed", else "n/a">
```

---

*No cycles have run yet. The first scheduled run appends its entry above
this line.*
