# Decision Registers

This directory holds the three decision registers, kept deliberately
separate so their status is never ambiguous:

- `ratified.md` — decisions explicitly approved by a human. Safe to build
  on until explicitly reopened.
- `derived.md` — logical consequences of ratified decisions, not themselves
  separately ratified. Strong working assumptions, not license to skip
  ratification for consequential work.
- `open.md` — unresolved architectural questions, including the current
  state of D-5 (cancellation lifecycle reversibility), the most extensively
  analyzed open item in this repository's history.

A decision moves from `open.md` to `ratified.md` only on an explicit human
ratification event — never by a documentation edit alone, and never as a
side effect of an unrelated analysis or implementation task.
