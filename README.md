# My PADI

**Built with Nigeria in mind. Designed to connect with the world.**

My PADI is a conversation-first, multilingual AI companion in development. It
aims to help people learn, communicate, think, create, stay organised, and enjoy
meaningful conversations through text and voice.

## Technology direction

- **Go:** Main backend, APIs, provider routing, business logic, and application
  services.
- **React Native + TypeScript:** Android/iOS application and user interface.
- **Python:** Specialist AI services when needed.
- **PostgreSQL:** Persistent application data and source of truth.
- **Gemini, OpenRouter, Groq, and Mistral AI:** One configurable AI layer behind
  PADI's consistent identity.

The provider responsibilities, routing policy, free-model safeguards, and
implementation status are documented in the
[AI provider and technology responsibility agreement](./docs/ai-provider-responsibilities.md).

## Current status

The mobile app now has a real-chat connection path: phone sign-in by Termii
one-time code, secure session storage, and authenticated messages to the Go
chat API. Go routes those messages through the configured AI provider adapters
and usage limits. This path still requires operator-provided Termii credentials,
PostgreSQL, and approved provider model credentials before it can return live
responses. Live SMS delivery, real provider responses, and provider free-tier
pricing have not been verified here. Voice remains simulated; reminders remain
local and are not scheduled as background notifications. Chat transcripts are
still stored on the phone, not PostgreSQL; persistent memory and specialist
Python services are not connected.

See the [backend README](./backend/README.md) for Go setup and tests. The
development goal is **one feature at a time: implement, test, and verify before
claiming it works.**
