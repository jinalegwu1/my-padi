# Personal memory

Date: 2026-11-20. Status: **Verified for backend, PostgreSQL, and automated web checks**.
Native device validation remains pending.

## Using memory

1. Sign in and open **Settings → Review remembered information**.
2. Enable personal memory and read the consent explanation.
3. Choose **Add memory**, select a category, enter a label and fact, then select
   **Save and approve memory**.
4. Ask PADI a relevant question. Saved names and communication preferences may
   also help personalise general replies.
5. Review, correct, pause, resume, or delete entries from the same screen.

Memory is off by default for each account. Old local demo entries and the old
device-local memory switch are not imported as facts or treated as consent.
In text or voice chat, an explicit first-person preference such as “I don't like loud music” offers **Remember this preference**. This opens the Memory editor with the user's own wording. Enable personal memory if needed, review the entry, and choose **Save and approve memory**. Reply ratings and PADI's conversation starters do not create facts.

## Account recognition and everyday questions

The authenticated account name now reaches AI replies. This is basic account
profile data, separate from opt-in personal memory. The name remains available
when memory is off. The selected account country is available in both text and voice. Asking for one's registered phone number uses a local authenticated lookup. The phone number is excluded from provider-bound profile and subsequent chat history.
Sign-up and Memory screens explain this distinction.

PADI recognises personal questions such as “Do you know me?”, “What is my name?”,
“You sabi me?”, and “Where am I coming from?”. Relevant active approved facts
are retrieved for these questions. Approved hometown, country, birthplace and
state-of-origin labels receive appropriate relevance for origin questions.
PADI must ask when the information is missing, rather than infer origin from
someone's name, phone number, or current location.

Shared companion instructions encourage warm replies using the known name,
including friendly Nigerian banter. They do not permit invented human feelings,
personal experiences, other AI friendships, or exclusive relationships. Old
assistant replies denying all profile/memory access are corrected using the
current retrieved context. The full earlier conversation history is not fetched
from PostgreSQL; current chat context remains the app's bounded recent history.

## Storage and permission rules

- PostgreSQL stores account-owned facts and the account's memory setting.
- Every API operation derives ownership from the authenticated session.
- Creation requires memory enabled and explicit per-entry approval.
- Review, correction, and deletion remain available while memory is off.
- Paused facts and all facts belonging to an account with memory off are
  excluded from AI memory context.
- A memory change advances a revision. Old recalled replies are not reused as
  AI context after a correction, pause, deletion, or consent change.
- Changes affect subsequent requests; an in-flight request may already have
  received its earlier context. Previous messages remain visible locally.
- Account changes clear cached memories and editor/consent dialogs. Delayed
  responses and stale callbacks cannot populate or change another account.
- New account-tagged chat replies are displayed only to their account.
  Legacy untagged transcripts remain local and are excluded from AI context.
- Failed operations are not optimistically displayed as successful changes.
  Reload memory after a connection failure to confirm the current server state.

Each account can keep 100 facts. Labels allow 100 Unicode characters and values
allow 500. Basic word/category matching selects up to eight relevant facts
within a conservative 4,000-byte encoded budget. Names and preferences have
general relevance. This is not semantic search or an embedding service.

Only category, label, and value are included in provider context. They are
encoded as JSON data, not action permissions. Memory content is not logged.
Disabling or deleting memory does not undo data already sent to a provider.
The development OTP bypass remains in effect; use test accounts during this
development stage.

## API

| Endpoint | Operation |
| --- | --- |
| `GET /v1/memory` | Read consent, revision, and owned facts |
| `POST /v1/memory` | Save a reviewed fact with `approved: true` |
| `PATCH /v1/memory/settings` | Set `enabled` |
| `PATCH /v1/memory/{id}` | Correct `value` or set `paused` |
| `DELETE /v1/memory/{id}` | Delete an owned fact |

Responses contain the confirmed snapshot: `enabled`, `revision`, and `items`.
Responses prohibit caching. The chat request/response carries `memory_revision`
to enforce consent boundaries across follow-up turns.

## Validation

- Backend regression tests and static checks passed.
- PostgreSQL checks passed for default-off consent, explicit approval,
  ownership isolation, corrections, pause, revocation, deletion, independent
  connection persistence, concurrent capacity enforcement, and rollback.
- Thirteen frontend checks cover failed/pending saves, expired sessions, account
  switching, delayed responses, stale callbacks, malformed data, ownership
  display, and memory revision boundaries.
- TypeScript and Expo web export passed.
- A live authenticated AI check recalled the synthetic approved project
  codename `MarigoldLamp451`, then replied `Unknown.` after the fact was paused,
  despite the request containing an old recalled reply. Its test account and
  records were removed afterward; no SMS was sent.
- November 20 checks passed for authenticated account-name retrieval, the exact
  “Do you know me?” question, a friendly named companion reply, and
  “Where am I coming from?” against an explicitly approved Ogun origin.
  Pausing the saved project prevented it appearing in the next AI reply, while
  the account name and separately approved origin remained available. All
  synthetic accounts and their records were removed.
- 49 frontend tests, TypeScript, all Go tests, Go vet and concurrency checks
  passed. A browser check confirmed Enter sends once, Shift+Enter adds a line,
  and pending or failed sends preserve the draft. Its chat responses were
  controlled for keyboard verification; real AI behaviour was checked separately.

Run routine checks from the repository root:

```sh
npm --prefix frontend test
npm run typecheck
cd backend
go test ./...
go vet ./...
```

PostgreSQL integration checks opt in using `PADI_TEST_DATABASE_URL`. The focused
memory tests create and clean up only their own synthetic accounts and rows.
Use a dedicated test database for the broader database suite.

The live AI check is opt-in with `PADI_VERIFY_MEMORY_LIVE_AI=1`, requires a
development environment and confirmed free accounts, and uses the configured
backend environment. Go tests do not load `.env` automatically.
