# My PADI — Python responsibility roadmap

Go is the main backend. It coordinates authentication, permissions, model
routing, accounts, application operations, and persistent storage in PostgreSQL.
TypeScript/React Native implements the mobile application and device integration.
Python supplies independent specialist intelligence services behind Go.

This is the agreed roadmap, not a statement that all engines already exist.
Each engine will have its own interface, dependencies, tests, and deployment
boundary. We will implement and verify one focused feature at a time.

Python's approved scope consists of these three engines:

| Engine | Python responsibilities | Status |
| --- | --- | --- |
| Memory and Context Intelligence Engine | Process and organise memories; generate embeddings; perform semantic search and relevant retrieval; rank memories; detect duplicates and conflicts; summarise long conversations; prepare useful context for AI models. | Planned |
| Voice and Audio Intelligence Engine | Process and convert audio; detect voice activity; reduce noise; recognise speech; process transcripts; integrate specialist speech and voice models; analyse voice signals. | Testing |
| AI Quality and Evaluation Engine | Compare AI models; test reasoning and accuracy; evaluate Nigerian English and Pidgin, PADI's personality and humour; measure response speed and cost; run quality regression checks after changes. | Planned |

The current Voice and Audio Intelligence Engine lives in `services/voice`. Go
also has a bounded model-by-model evaluation runner and PADI regression cases;
the Python quality/evaluation service itself remains planned. The memory/context
and quality/evaluation engines will be added as separate Python services when
their feature requirements are agreed. They are not empty endpoints or
simulated implementations in the current application.

The existing verified personal-memory feature stays intact: Go/PostgreSQL
currently stores approved facts and uses basic relevance selection. That is
distinct from the planned Python semantic memory intelligence. Extracted
candidate memories must still require user approval before Go persists them.
Python recommendations cannot grant permissions, send messages, change memory
consent, or claim application actions succeeded. Go verifies and coordinates
those operations.

Go enforces consent and account ownership before supplying data to Python.
Specialist services receive only the information needed for an authorised
request. Internal credentials never go to the mobile application. New engines
must preserve account boundaries, consent, deletion, and PADI's consistent
personality across providers.
