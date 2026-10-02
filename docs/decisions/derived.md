# Derived Decision Register

Status: **DERIVED.** Every item in this register follows logically from the
RATIFIED decisions in `ratified.md`, but has not itself been put to a human
as a separate, standalone ratification event. Treat these as strong working
assumptions consistent with the ratified baseline — not as license to skip
ratification before building anything consequential on top of them.

**Important status note:** the relationships recorded below were already
derived through prior conversation-based architecture analysis (the D-5
series). They are recorded here **for the first time as repository content**,
not created fresh in this pass. Recording them here does not upgrade their
status to RATIFIED, and does not constitute a "new decision" — it is a
transcription of an existing analytical conclusion into canonical,
version-controlled form.

## P1 / P2 cancellation relationship

**P1 — Business / Decision Cancellation:** "This previously approved
business action must no longer be carried out."

**P2 — Execution / Operation Cancellation:** "This particular pending
operation must no longer execute or retry."

Derived relationships between P1 and P2:

- P1 can exist without any Operation ever having been created.
- P2 can exist without P1 — an individual Operation can be cancelled without
  the underlying business action being cancelled.
- P1 constrains future descendant Operations — once P1 is true for a
  business action, no new Operation may be created against it.
- P2 does not imply P1 — cancelling one Operation says nothing about the
  business action's own status.
- P1 dominates P2 at governed checkpoints — where both could apply, P1's
  effect is the binding one; the reverse (P2 dominating P1) does not hold.
- **Operation creation** must check applicable P1 state before allowing a
  new Operation to be created.
- **Send-time execution** must check applicable P1 + P2 + integrity/
  authorization conditions before allowing an Operation to actually
  transmit.
- Cancellation does **not** retroactively alter an already-transmitted
  historical fact — an Operation that reached SENT (or external acceptance)
  remains historically SENT/accepted regardless of any later-recorded
  cancellation. This is the F-1 constraint referenced throughout the D-5
  analysis series.

## Scope and status of this section

This P1/P2 relationship set is DERIVED and governs how cancellation
constrains Operations *once a cancellation exists*. It does **not** settle
whether, or how, a cancellation's operative effect can later be reversed,
whether continuation after cancellation requires a new business artifact,
or what "same business identity" means after such continuation. Those
questions are the subject of the still-**OPEN** D-5 cancellation-lifecycle
decision — see `open.md` and `docs/analysis/D-5-cancellation/README.md`.
Nothing in this document should be read as resolving D-5.
