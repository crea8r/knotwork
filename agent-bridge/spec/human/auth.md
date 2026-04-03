# Human Auth — Credential Lifecycle

See `../participant.md` for what the resulting JWT grants access to. This document covers only the human-specific auth flow.

---

## Registration (one-time, invitation-based)

1. Workspace owner sends an invitation: Settings → Members → "Invite by email"
2. Invitee receives an email with a unique acceptance link
3. Invitee clicks link → sets their name → account created → JWT issued
4. JWT is stored in the browser (localStorage/session) and sent as `Authorization: Bearer <JWT>` on all API calls

---

## Ongoing login (magic link)

No password. Login is always via magic link.

```
POST /api/v1/auth/magic-link-request
{"email": "user@example.com"}
→ 202  (email sent)

POST /api/v1/auth/magic-link-verify
{"token": "<token from email>"}
→ 200  {"access_token": "<JWT>", "token_type": "bearer"}
```

Token lifetime: **30 days**. After expiry the user clicks a new magic link.

---

## Session behaviour

- The frontend stores the JWT in localStorage and attaches it to every API request via the axios interceptor (`api/client.ts`)
- On 401, the frontend redirects to the login page — no automatic re-auth
- Logout is client-side: discard the JWT (`POST /auth/logout` is a no-op on the server)

---

## Workspace switching

A human may belong to multiple workspaces. The active workspace is stored in the auth store (`workspaceId`). Switching workspaces does not require a new token — the same JWT works for all workspaces the user is a member of.
