# Complete flow audit and corrections

## Runtime and safety

- Fixed portable-runner branching so branch destinations are no longer overwritten by a state's default success transition.
- Fixed `successAny` evaluation to wait for every assertion and accept the step when any assertion passes.
- Added state detection to generated production runners.
- Added generated-runner support for wait, download, evidence, retry, repeat, human intervention and all declared assertions.
- Added repeat termination assertions and bounded execution.
- Added required human-intervention callback enforcement.
- Kept final submission behind both explicit approval and `allowSubmit`.

## Recording and draft generation

- Recordings are split into page states using navigation boundaries.
- Duplicate input click events are removed.
- Step and state identifiers are made unique.
- Upload actions now generate matching document declarations.
- Existing business metadata is preserved when a recording regenerates a draft.
- Generated page transitions follow the demonstrated navigation sequence.

## Validation and finalization

- Added branch-target validation, repeat-reference validation and terminal-state checks.
- Added missing-transition, duplicate-terminal and unreachable-state checks.
- Added final-submission approval checks.
- Placeholder detection and missing assertions are surfaced as readiness issues.
- Finalization now requires zero errors and zero warnings.
- Published versions cannot be overwritten.
- Published versions are read-only in the desktop app and can be duplicated as a new editable version.

## UI and UX

- Added a compact readiness dashboard for fields, documents, states and validation status.
- Added document management alongside applicant fields.
- Improved state graph transition labels.
- Added clear draft versus published behavior.
- Added one-click creation of the next editable version.
- Improved validation feedback and finalization readiness progress.
- Preserved local-only privacy messaging and protected submission boundaries.
