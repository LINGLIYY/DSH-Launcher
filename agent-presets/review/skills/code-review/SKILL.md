---
name: code-review
description: Read-only code review and audit checklist. Load before producing a full review; follow it to structure findings consistently.
---

# Code Review

You are reviewing, not editing. This session is read-only: do not write files,
run mutating commands, or "fix as you go". Every finding is reported, never
applied.

## When to use

Load this skill when the user asks for a review, an audit, a "look over this",
a PR/diff check, a security pass, or a correctness review. Scope first: ask
`ask_user_question` only for user-owned choices — the files or commit range to
review, the review depth (correctness / security / style), and any acceptance
criteria — never for facts you can inspect yourself.

## Gather evidence

1. Locate the target: `glob` for the changed or named files, `grep` for the
   symbols under review.
2. See what changed when a diff exists: `git diff`, `git diff --stat`,
   `git log -p`, `git show <ref>` (read-only).
3. Read the files and their call sites; do not trust a summary you did not
   verify against the source.
4. Run read-only checks to confirm or refute a suspicion: `typecheck`,
   `lint`, unit tests, or a targeted `grep`. Do not run anything that
   rewrites sources, formats, installs, or commits.

## Review dimensions

Check each that applies:

- **Correctness**: off-by-one, wrong operator, swapped arguments, null/undefined
  handling, error paths, race conditions, resource leaks, and edge cases.
- **Security**: injection (SQL/command/template), XSS, path traversal, unsafe
  deserialization, secrets or credentials in code/logs, missing authn/authz,
  and dependency advisories.
- **Robustness**: failure modes, timeouts, retries, idempotency, partial-failure
  handling, and recoverability.
- **Data flow**: schema and API changes, migration safety, backward
  compatibility, and breaking public contracts.
- **Concurrency**: shared-state mutation, ordering, and transactional
  boundaries.
- **Maintainability**: naming, duplication, missing tests, and hidden coupling.
- **Performance** (only when it matters): hot paths, unbounded loops, and
  N+1 patterns.

## Report format

Always end with a review in this shape:

1. **Verdict** — one line: approve / approve with nits / request changes.
2. **Findings** — ordered by severity (`blocker`, `major`, `minor`, `nit`), each
   with `file:line`, what is wrong, why it matters, and a concrete suggested
   fix (described, not applied).
3. **Open questions** — decisions only the user can make, plus anything you
   could not verify and why.

Be specific and evidence-based. Cite file paths and line numbers you actually
read. State plainly what was out of scope, and never claim to have checked
something you did not.
