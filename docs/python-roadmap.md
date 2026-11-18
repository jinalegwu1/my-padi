# My PADI — Python responsibility roadmap

Go is the main backend. It coordinates authentication, permissions, model
routing, accounts, application operations, and persistent storage in PostgreSQL.
TypeScript/React Native implements the mobile application and device integration.
Python supplies independent specialist intelligence services behind Go.

This is the agreed roadmap, not a statement that all engines already exist.
Each engine will have its own interface, dependencies, tests, and deployment
boundary. We will implement and verify one focused feature at a time.

| Engine | Python responsibilities | Status |
| --- | --- | --- |
| Memory Engine | Extract candidate memories; categorise and organise information; generate embeddings; semantic search; retrieve relevant history; summarise conversations; rank relevance/importance; detect duplicates and conflicts; recommend updates and expiration. | Planned |
| Voice Engine | Process incoming audio; detect speech and turn boundaries; speech recognition; analyse signal quality, noise, pace and pauses; reduce noise where appropriate; segment speech; convert/prepare audio; integrate specialised speech models for natural conversations. | Building / Testing |
| Language Engine | Clean and process text; detect languages; multilingual processing; spelling/grammar patterns; extract entities and dates; classify intent; identify topics/themes; prepare text collections for retrieval. | Planned |
| Document Engine | Extract text from supported documents/PDFs; split sections; generate embeddings; semantic search and retrieval; compare documents; prepare knowledge sources for learning. | Planned |
| Personalisation Engine | Analyse permitted preferences and recurring interests; rank recommendations; personalise learning; content discovery; analyse permitted interaction patterns; identify opportunities relevant to user goals. | Planned |
| Evaluation Engine | Compare models; test accuracy, relevance, instruction following, personality, emotional sensitivity, humour and culture; measure latency/resources; detect model/prompt regressions; produce reports. | Planned |
| Data Intelligence Engine | Structured data analysis; patterns/trends; statistics; justified prediction/forecasting models; recommendations; evaluate prediction performance. | Planned |
| Research & Model Lab | Experiment with ML models; justified fine-tuning; evaluate retrieval/embeddings; research specialist techniques; benchmark technologies; prepare validated models for production. | Planned |

The current Voice Engine lives in `services/voice`. Other engines will be added
as separate services when their feature requirements are agreed. They are not
empty endpoints or simulated implementations in the current application.

The existing verified personal-memory feature stays intact: Go/PostgreSQL
currently stores approved facts and uses basic relevance selection. That is
distinct from the planned Python semantic memory intelligence. Extracted
candidate memories must still require user approval before Go persists them.
Python recommendations cannot grant permissions, send messages, change memory
consent, or claim application actions succeeded. Go verifies and coordinates
those operations.

Specialist services receive only the information needed for an authorised
request. Internal credentials never go to the mobile application. New engines
must preserve account boundaries, consent, deletion, and PADI's consistent
personality across providers.
