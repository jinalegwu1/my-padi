# My PADI — AI Provider Responsibilities

**Architecture agreement · Version 1.0**

My PADI uses multiple AI providers to support one companion, not to create
separate assistants. The user experience must retain one PADI personality,
consistent conversation context, and clear user control. Provider selection is
an internal implementation detail and should not be exposed as a different
assistant identity.

The Go backend and application services remain responsible for application
logic, memory, accounts, reminders, notifications, permissions, and actions.
An AI provider does not independently own or control those features.

## Agreed provider roles

| Provider | Routing role | Responsibility |
| --- | --- | --- |
| Groq | Primary and fast | First provider attempted for text requests. |
| OpenRouter | Secondary | Second provider attempted when Groq fails. |
| Z.ai | Tertiary and reasoning-capable | Final configured text fallback after Groq and OpenRouter fail. |
| Google Gemini | Optional, not in current route | Available only if explicitly configured and supported by the relevant integration. |

These are routing responsibilities, not fixed model selections. Model IDs,
free-tier access, capability, rate limits, and terms must be checked before
enabling a model. Free access and quotas may change. Do not assume that every
provider or model is always free.

## Google Gemini — optional model capability

**Position:** Not configured in the current route
**Potential responsibility:** General intelligence or supported multimodal
interactions only when explicitly enabled and verified.

### Everyday conversations

- Answer ordinary questions and hold natural conversations.
- Explain difficult ideas simply and discuss everyday experiences.
- Offer helpful suggestions and respond naturally to follow-up questions.
- Use the conversation context supplied by PADI to understand what the user
  means, not just the latest words in isolation.

### Personal-assistant support

- Help users organise activities, plan, prioritise, and make decisions.
- Break large tasks into smaller steps and suggest practical next steps.
- Help users think through personal challenges without claiming to replace
  qualified professional support.

### Intent understanding

- Help identify whether a user is asking a question, making a request, or
  sharing information.
- Help distinguish requests for explanations, practical assistance, or a
  specialised PADI feature.
- Provide intent information that PADI's Go application logic may use when
  selecting a provider or non-AI service.

Intent classification by a model is advisory. Go must validate requests,
enforce permissions, and decide whether an operation is allowed. A model must
not directly execute sensitive actions or bypass user approval.

### Multimodal support

- Interpret user-supplied images and supported documents.
- Support image-based questions and audio-related understanding when the
  selected model and the complete PADI integration support those inputs.

These capabilities are conditional. A text-only adapter or model must not be
presented as supporting image, document, or audio input.

### Empathetic communication

- Recognise emotional signals and adapt tone appropriately.
- Avoid jokes that are inappropriate when a user is in pain or distressed.
- Offer encouragement without pretending to provide professional care.

### General knowledge and explanations

- Explain technology, educational topics, and everyday concepts.
- Provide step-by-step explanations and simplify unfamiliar or complicated
  subjects.

### Fallback

- Gemini may receive eligible requests when a specialised provider is
  unavailable, provided the configured Gemini model supports the task.
- Fallback must preserve the same PADI identity and use only the context
  permitted for that request.

## OpenRouter — multi-model access and secondary routing

**Position:** Secondary model access and routing platform  
**Main responsibility:** Connect PADI to specifically configured models
through OpenRouter's API.

OpenRouter is a model access platform, not one model. Go chooses the exact
configured model ID for each request. This allows model changes and task
experiments without changing the user-facing PADI identity or the provider
adapter.

### Model access and selection

- Configure specific model IDs for conversation, reasoning, summarisation,
  classification, coding, or other supported tasks.
- Use only models that the operator has checked and approved for PADI.
- Change or compare configured model IDs without changing the user's
  conversation experience.
- Multimodal requests are allowed only after the selected model and PADI's
  request path support the relevant inputs.

### Backup and availability

- OpenRouter can be configured as the backup model in Go's routing settings.
- The router can try another configured candidate after provider failures,
  including a model-not-found response (HTTP 404).
- If no candidate succeeds, the error is returned to the calling Go service;
  the model must not silently change to an unconfigured choice.

### Free-model policy

- Every configured OpenRouter model must exactly match an entry in
  `PADI_AI_APPROVED_FREE_MODELS`; the Go router rejects unapproved models at
  startup.
- The allowlist is an operator approval list, not a live price feed. Before
  adding or retaining an entry, an operator must verify that the model is
  explicitly zero-priced and remains appropriate for PADI.
- Recheck the upstream catalogue and usage restrictions regularly, and remove
  entries when free access is withdrawn or cannot be confirmed.
- OpenRouter must not discover and automatically select an unapproved or paid
  model.

The allowlist prevents accidental use of a model that was not approved in the
deployment configuration. It cannot guarantee that upstream pricing has not
changed since the operator last checked. Live free-catalogue discovery and
automatic provider-price or provider-quota verification are not implemented;
Go's separate PADI-side usage caps are documented below.

## Groq — fast AI processing and lightweight tasks

**Position:** Fast-response AI provider  
**Main responsibility:** Process suitable text tasks quickly and efficiently.

### Fast responses

- Handle general PADI text conversations as the configured primary route.
- Also handle explicitly task-labeled lightweight work such as extraction,
  classification, summarisation, and text processing.
- Use the same provider order for complex requests; if reached, Z.ai receives
  the task metadata needed to enable its reasoning mode.

### Classification and intent

- Support classification requests that identify a message category or whether
  it is a question, command, reminder request, planning request, emotional
  support request, or specialised task.
- Support intent and action extraction so Go can select the appropriate
  application service or another model.
- Classification is advisory. Go must validate the result and retain authority
  over permissions, reminders, notifications, and all actions. The model
  cannot create or send anything by itself.

### Summarisation and lightweight text work

- Summarise long conversations into concise summaries, discussion points,
  decisions, and pending tasks for a permitted memory-processing workflow.
- Rewrite and format text, correct grammar, summarise passages, extract
  information, categorise content, and create short descriptions.
- Return machine-readable JSON when requested and supported by the selected
  model. Go must validate the output against the task's expected schema before
  using extracted fields.

### Efficiency, limits, and fallback

- Use the fast route for work that does not need advanced reasoning, reducing
  avoidable use of the primary or reasoning models.
- Groq may serve as a configured fallback for supported lightweight tasks.
- Respect provider rate limits and bounded retries. A free tier is limited and
  must not be treated as unlimited processing.

## Z.ai (GLM-4.7-Flash) — third fallback and reasoning capability

**Position:** Third configured text fallback
**Main responsibility:** Handle text requests after failures from
Groq and OpenRouter, including requests that benefit from deeper reasoning.

### Advanced reasoning and decisions

- Break complicated questions into smaller parts, compare alternatives, and
  explain advantages, disadvantages, trade-offs, risks, and likely
  consequences.
- Help users evaluate options and offer reasoned recommendations with
  supporting explanations rather than unsupported certainty.
- Explain complex subjects in an understandable way.

### Planning and organisation

- Help create structured plans, break projects into manageable tasks,
  establish priorities, identify dependencies and possible obstacles, and
  suggest practical approaches.
- Plans and dependencies are proposals for the user to review. Go remains the
  source of truth for task state and must not schedule or execute a plan
  without the relevant application workflow and user approval.

### Technical assistance

- Explain programming concepts, code, software architecture, databases, and
  APIs.
- Help analyse technical problems, explain debugging approaches, and provide
  technical recommendations.
- Treat suggested code and diagnoses as generated assistance; do not imply
  code has been run or a bug has been fixed unless verified.

### Complex text analysis and learning

- Analyse longer supplied text, extract important information, identify
  relationships between ideas, compare supplied documents, and organise
  unstructured information.
- Produce structured reports when requested and supported by the model.
- Explain difficult educational or technical topics step by step, use
  examples, generate practice questions, and explain mistakes and corrections.

### Quality checking and specialist fallback

- Review a selected AI response for coverage, missing information,
  contradictions, and possible improvements.
- Provide an alternative configured reasoning model when another approved
  provider is unavailable and the task is supported.
- A review is an aid, not proof of correctness. Go or the user must apply
  appropriate validation, and no response should be described as verified
  solely because another model reviewed it.

Z.ai is configured through `PADI_AI_REASONING_MODEL` as the final fallback
after `PADI_AI_PRIMARY_MODEL` and `PADI_AI_BACKUP_MODEL` fail. Task labels no
longer select Z.ai ahead of those providers; when a request reaches Z.ai, the
adapter can still enable its reasoning behavior for `reasoning`, `planning`,
`technical`, `decision_support`, `complex_analysis`, `learning`, and
`quality_review` tasks and complex requests. The selected model is
**GLM-4.7-Flash**, API ID
`glm-4.7-flash`, using `ZAI_API_KEY` and the standard endpoint
`https://api.z.ai/api/paas/v4/chat/completions`. Z.ai
[lists this model as free](https://docs.z.ai/guides/overview/pricing).
PADI currently accepts only this Z.ai model in runtime configuration.
The adapter disables thinking for short conversations and structured JSON,
and enables it for the existing reasoning tasks and complex requests.
Live account availability still requires a successful generation test.
The verifier records published pricing separately from account availability;
PADI does not automatically discover Z.ai account rate limits.

## Provider coordination and one PADI personality

The Go router is the central controller. It selects a configured model by
trusted task metadata; the providers do not negotiate with one another or
select arbitrary models.

| Request type | Preferred route |
| --- | --- |
| Normal conversation and personal-assistant questions | Groq → OpenRouter → Z.ai on provider failures |
| Short conversation or small talk | Groq → OpenRouter → Z.ai on provider failures |
| Image understanding | Only a configured model whose input integration supports it |
| Classification, extraction, text-processing, and conversation summaries | Groq → OpenRouter → Z.ai on provider failures |
| Complex reasoning, technical analysis, and complex planning | Groq → OpenRouter → Z.ai on provider failures |
| Alternative model | Exact model configured through OpenRouter |
| Provider failure | Go tries other configured and approved role models |

Task and complexity labels do not change this provider order. Groq is attempted
first; OpenRouter and then Z.ai are tried after provider failures. Transient
failures may retry the same model within its configured limit. Classification is not currently run automatically on every chat
message. Provider fallback does not change PADI's identity or freely discover
models.

Every provider receives the same shared PADI system instructions from Go,
alongside the request's application context. The instructions cover identity,
communication style, language preference, respect, cultural caution,
emotional awareness, privacy, uncertainty, safety, and honest reporting of
application actions. The user should not see a different assistant persona
when the route changes.

The shared personality foundation guides PADI to move naturally between
playful, friendly, encouraging, empathetic, serious, informative, celebratory,
and reflective replies. It treats emotional cues as uncertain conversational
signals, respects direct requests about tone, and prohibits humour that
dismisses suffering or sensitive experiences. Humour remains optional and
context-dependent. This foundation is shared across provider routes; it is not
a diagnosis or a persistent mood classifier.

Go assesses lightweight signals from the current user turn and adds private
response guidance without storing mood labels. Signed-in users can save
account-scoped humour and tone preferences. Response ratings are also
account-scoped and store only a message ID and rating, not reply text. Learning
from humour feedback is off by default, requires at least three consistent
recent ratings, and cannot override an explicit humour choice. Regression
scenarios cover invited humour, grief, rejected humour, celebrations, Pidgin
distress, explicit tone choices, and spoken empathy.

Users may separately opt into morning, afternoon, and evening PADI check-ins.
Schedule preferences are account-scoped in PostgreSQL; notifications are
scheduled locally by the mobile app only after device permission is granted.
Quiet hours suppress conflicting local schedules. This is not a server push
notification service, does not schedule the separate personal reminders, and
still needs physical-device verification.

Friendly chat replies are guided to use one or two context-appropriate Unicode
emojis. Emojis supplement clear wording, use restraint in sensitive discussions,
and are omitted when users request plain text, no emojis, or formal documents.
Code, quoted text, and structured data are not decorated with emojis.

## Responsibilities owned by Go

Go owns AI connections and API credentials; provider and model selection;
approved-model policy; request/response orchestration; timeouts; bounded
retries; fallback; error handling; and current usage/cost telemetry. Go and
the application services also own authentication, permissions, security,
database operations, conversation history, preference management, memory
retrieval/storage coordination, reminder scheduling, notification delivery,
external service integration, action permissions, and audit trails.

AI output is data, not authority. Go must validate structured responses and
must not execute an AI-suggested action without the relevant permission and
confirmation. A model must not say an action succeeded unless the application
service confirms success.

## Python specialist-service boundary

Python is not another conversational provider. It is reserved for specialist
services when needed: embeddings, semantic search, retrieval-augmented
generation (RAG), document processing, advanced text processing, AI
evaluation, model comparisons, specialist audio/DSP, data analysis, machine
learning experiments, personalisation, memory relevance, recommendations,
and specialist classification.

Go coordinates these services. PostgreSQL remains the source of truth for
persistent application data. The independent Python Voice Engine now exists in
`services/voice`, with VAD, audio preparation, speech recognition, and expressive
speech generation. Browser conversation/interruption checks pass; native phone
compilation and device verification remain pending. The memory/context and
quality/evaluation specialist
engines are planned in the [Python roadmap](python-roadmap.md).

## Free API and billing protection

Every configured conversational/text provider/model pair must exactly match an entry in
`PADI_AI_APPROVED_FREE_MODELS`, a comma-separated environment variable using
`provider:model-id` entries. For example:

```sh
export PADI_AI_APPROVED_FREE_MODELS='gemini:verified-model,groq:verified-model,zai:verified-model,openrouter:provider/verified-model'
```

This is an operator-maintained approval list, not a live price or quota
verification service. Verify each model's zero price, account entitlement,
limits, terms, and data-retention policy before adding it. Remove models when
free access is withdrawn or cannot be confirmed. The Go router cannot verify
upstream price changes or guarantee that a provider will never bill for
requests.

The router has bounded retries, request timeouts, failure circuits, fallback,
provider-error classification, and usage/cost observation. Rate-limit
responses (HTTP 429) go to another configured route instead of being retried
against the limited model. Model-not-found responses can also fall back.
Before each provider attempt, Go reserves that provider's request and token
budget in a PostgreSQL daily and monthly ledger. Reservation uses UTF-8 prompt
bytes plus the enforced output-token ceiling as a conservative token-unit
budget; actual provider input/output tokens are stored separately. Failed
attempts still consume a request and reservation because a provider may have
processed or billed the request before the failure was observed. AI requests
fail closed when PostgreSQL or the ledger is unavailable.

Live provider-side quota/price verification, quota exhaustion alerts, and a
user-facing “no free provider available” response are not implemented. The
model allowlist and PADI caps reduce risk but cannot guarantee that upstream
pricing and terms remain unchanged.

API keys are read by Go from backend environment variables and are not part
of mobile configuration. The authenticated chat path sends only the bounded
current conversation; successful same-account, same-revision exchanges may be
included as follow-up context. Relevant active approved memory facts may also
be included with account consent. Local greetings, other device preferences,
and unrelated personal data are excluded. The app tells users that submitted context is forwarded to the
configured AI provider. Provider data-retention policies still require review.

## PADI features and source-of-truth services

| Feature | Responsibility |
| --- | --- |
| Daily conversation, check-ins, emotional awareness, personal assistance | Groq → OpenRouter → Z.ai |
| Learning and explanations | Groq → OpenRouter → Z.ai |
| Complex planning and technical explanations | Groq → OpenRouter → Z.ai |
| Fast classification and conversation summaries | Groq → OpenRouter → Z.ai |
| Image understanding | Gemini only after multimodal request support is implemented |
| Alternative models and AI fallback | Go router with approved configured models |
| Memory search | Future Python retrieval service with PostgreSQL |
| Memory generation/organisation | Go-coordinated workflow; Python or approved model as appropriate |
| Reminders and notifications | Go scheduling/notification services |
| Sports information | Sports data service for facts; AI may explain retrieved data |
| Weather information | Weather service for facts; AI may explain retrieved data |
| Calendar assistance | Calendar integration coordinated by Go |
| Voice conversation | Speech services plus AI providers |
| User preferences | Go and PostgreSQL |

The relevant production service must supply authoritative current data; an
AI model should interpret it, not invent it.

## Technology responsibility agreement

- **Go:** Main backend, APIs, authentication, provider orchestration, business
  logic, reminders, notifications, integrations, and security.
- **Python:** Specialist AI engineering services coordinated by Go.
- **PostgreSQL:** Persistent application source of truth.
- **Gemini, OpenRouter, Groq, and Z.ai:** Configured AI intelligence
  providers behind one PADI experience.
- **React Native and TypeScript:** Android/iOS application and user interface.

## Consistency, privacy, and control

- Go and application services, not an individual model, are the source of truth
  for accounts, approved memory, preferences, reminders, notifications, and
  permissions.
- Send a provider only the conversation and other context needed for its
  assigned request, subject to PADI's consent and privacy rules.
- Keep PADI's shared behavior and safety instructions provider-neutral so
  changing providers does not create a different companion.
- Get user approval before sensitive actions such as sending messages.
- Never claim that a capability is live until it has been implemented and
  tested.

## Current implementation status

- Account-owned personal memory is connected to PostgreSQL and authenticated
  APIs. Consent defaults to off; explicit saves, correction, pause, deletion,
  bounded relevance selection, and consent-aware chat context are implemented.
  Conversation-based automatic saving and semantic retrieval remain planned.
  See [personal-memory verification](personal-memory-verification.md).
- An explicit development-only switch can skip PADI's daily/monthly usage
  caps while preserving the PostgreSQL ledger. Default enforcement remains
  enabled. Vendor limits still apply; no upstream quota is reset. See the
  [development usage-cap instructions](../backend/README.md#temporary-development-usage-cap-bypass).
- Separate Go adapters exist for Gemini, Groq, Z.ai, and OpenRouter.
- The Go router supports configurable primary, fast, reasoning, and backup
  model IDs. Provider roles and model IDs are supplied through environment
  configuration; this document does not select live models.
- Every configured provider/model pair is checked against the exact
  `PADI_AI_APPROVED_FREE_MODELS` allowlist at router construction. This is a
  deployment-time operator check, not live pricing verification.
- A PostgreSQL migration creates daily/monthly provider budget rows. A request
  requires the persistent usage limiter; PADI caps are 20 requests/day, 300
  requests/month, 25,000 reserved token units/day, and 250,000/month per
  provider. Provider usage is reserved before each network call, and actual
  token counts are recorded after a successful response.
- Real disposable-PostgreSQL integration tests passed for migrations,
  auth/session and usage ledger paths, transaction rollback, all four budget
  caps, and concurrent requests. See [the quota verification results](postgresql-quota-verification.md).
- Groq is the configured primary for PADI text requests. OpenRouter is the
  second candidate and Z.ai is the third candidate after provider failures;
  structured JSON mode is available for supported models and invalid JSON is
  rejected before returning a response.
- Z.ai retains its reasoning behavior when reached for explicit reasoning,
  planning, technical, decision-support, complex-analysis, learning, and
  quality-review tasks, as well as requests marked complex.
- The Go router injects shared PADI system instructions for each provider
  request and tries configured routing roles in order. HTTP 429 errors trigger
  fallback instead of retrying the rate-limited provider.
- These task labels are routing metadata, not automatic model classification.
  The application must assign them deliberately. There is no project/task
  manager, code execution or patching workflow, multi-document upload
  pipeline, or automatic response-review flow connected to Z.ai.
- There is no production conversation classifier, reminder/planning workflow,
  or persisted conversation summarisation service connected to the router.
  Callers must explicitly label task requests; model-provided classifications
  are not trusted as authorization or action instructions.
- The current adapters send text requests. Gemini image/document/audio
  ingestion and multimodal conversation are not implemented.
- The mobile chat calls a protected Go `/v1/chat` endpoint and displays real
  provider replies when authenticated and configured. Phone OTP, Termii SMS,
  PostgreSQL sessions, revocation, and rate-limited challenge issuance are
  implemented. Live Termii delivery still needs operator credentials and
  device/account verification. All four AI providers returned real greetings in
  the [free-provider verification](provider-verification.md). Z.ai's separate
  reasoning check remains pending after provider rate limits.
- Chat history stays on the device. Only successfully completed backend-chat
  exchanges for the same account and memory revision are used as follow-up
  context. Relevant active approved memories may be included when enabled;
  simulated exchanges, greetings, other device preferences, and unrelated
  personal data are excluded. Server-side
  PostgreSQL conversation persistence is not implemented.
- Live greetings from Gemini, Groq, OpenRouter, and Z.ai plus a controlled
  primary-to-backup fallback were verified. The selected free Z.ai model's
  pricing and account access are checked; its thinking-enabled reasoning
  check remains Testing after HTTP 429 responses.
  Vendor account rate limits were not deliberately exhausted.
- The Python Voice Engine uses separately configured, checked speech models
  through protected Go endpoints, with server-side keys and usage tracking.
  See [voice verification](voice-verification.md). Speech models are not added
  to the conversational/text model registry.
- Current-turn personality guidance, user-controlled tone and humour settings,
  privacy-minimized feedback, and opt-in adaptation are implemented in Go and
  covered by regression tests. Tests exercise three separate chat turns before
  adaptation, distress overriding a learned humour preference, and account
  separation at authenticated API boundaries. A local HTTP fixture sends the
  router-composed system guidance through all eight registered Go provider
  adapters and checks that the serialized instructions match. These fixtures
  do not test live model behavior or PostgreSQL persistence.
- Account-backed check-in preferences can use the Go/PostgreSQL scheduler and
  Expo Push Service for native devices; local scheduling remains the fallback.
  The worker applies saved timezone and quiet-hour settings and deduplicates
  delivery attempts. Regression tests cover schedule boundaries, permission
  denial, and local schedule replacement. Expo ticket acceptance is not proof
  of device delivery, which still needs EAS/APNs/FCM setup and physical-device
  verification. This push integration currently covers check-ins only.
- The application does not automatically monitor future provider pricing.
The Python memory/context and quality/evaluation engines, PostgreSQL
conversation storage, reminder scheduling, and push integrations beyond
check-ins remain planned. Chat payloads are bounded and minimized to the current
  conversation; the app tells users that submitted messages are forwarded to
  the configured AI provider and displays quota/provider errors.

The responsibility descriptions above define product direction. They do not
represent completed or verified capabilities unless the implementation status
explicitly says otherwise.
