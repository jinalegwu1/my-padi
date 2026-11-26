# Project memory

## Product intent & audience

- Project is being built inside Bolt; specific product/domain not yet identified.
- User expects standard developer workflows (git, pushing to a repo) and treats Bolt output as production-bound code.

## Brand personality & voice

- Not yet inferred; no user-facing copy or brand direction encountered.

## Visual design & UX direction

- Not yet inferred; no UI/design context encountered this turn.

## Decisions, constraints & rationale

- Bolt's environment cannot run git or push to external repos; no GitHub remote is connected.
- Bolt auto-saves file changes; explicit commits/pushes must happen outside Bolt.
- Suggested export path: download project locally, then `git init`, commit, add remote, push.

## Open questions & assumptions

- Project purpose, stack, and feature scope still unknown — need more turns to infer.
- Unknown whether a GitHub integration is available on the user's Bolt account.
- "the work" implies prior edits were made this session; their nature/content not captured yet.