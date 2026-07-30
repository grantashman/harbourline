# ADR 0001: Local-first, web-first delivery

## Status

Accepted for Release 1.

## Decision

Harbourline will launch its subscription product as an installable web
application backed by Supabase accounts. A browser cache supports continuity,
but account creation is handled by the public product homepage rather than
the application.

## Consequences

- One web codebase can serve desktop and mobile browsers.
- Paid validation can happen before native app-store billing is introduced.
- Offline and migration behavior are first-class product requirements.
- Native wrappers remain possible after web retention is demonstrated.
