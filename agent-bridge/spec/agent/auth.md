# Agent Auth — Credential Lifecycle

## Overview

Agents authenticate via ed25519 challenge-response, receiving a standard JWT bearer token. Once authenticated, agents call the same `/api/v1/*` endpoints as human operators — no separate agent API.

## Key principle

A participant is a participant. Human auth: email → magic link → JWT. Agent auth: public key → signed challenge → JWT. Same token format, same endpoints, same middleware.

## Registration (one-time, done by workspace owner)

1. Agent operator generates an ed25519 keypair:
   ```
   private_key, public_key = ed25519.generate_keypair()
   public_key_b64 = base64url_encode(public_key.raw_bytes)  # 32 bytes → ~43 chars
   ```

2. Workspace owner registers the agent in Knotwork Settings → Members → "Add agent by public key":
   - Provides: display name, base64url public key, role (operator/owner)
   - Knotwork creates: a `User` row (no email) + `WorkspaceMember(kind='agent')`
   - Returns: `MemberOut` with `member_id`

3. Agent operator stores the private key securely. The public key is the agent's identity — it never changes unless the agent is re-registered.

## Authentication flow (on each startup or token expiry)

### Step 1 — Request challenge

```
POST /api/v1/auth/agent-challenge
{"public_key": "<base64url ed25519 public key>"}

→ 201 {"nonce": "<random string>", "expires_at": "<ISO8601>"}
```

Nonce expires in **2 minutes**. Request a fresh one if it expires before step 2.

### Step 2 — Sign and exchange

```python
# Sign the nonce bytes with the ed25519 private key
signature_bytes = private_key.sign(nonce.encode("utf-8"))
signature_b64 = base64url_encode(signature_bytes)  # 64 bytes → ~86 chars
```

```
POST /api/v1/auth/agent-token
{
  "public_key": "<base64url public key>",
  "nonce": "<nonce from step 1>",
  "signature": "<base64url(ed25519_sign(private_key, nonce.encode()))>"
}

→ 200 {"access_token": "<JWT>", "token_type": "bearer"}
```

### Step 3 — Use the token

```
Authorization: Bearer <JWT>
```

All `/api/v1/*` endpoints accept this token. The JWT identifies the agent's User row, which is linked to its WorkspaceMember row.

Token lifetime: **30 days** (same as human sessions). Re-authenticate before expiry.

## Error handling

| HTTP | Meaning | Action |
|---|---|---|
| 404 on `/agent-challenge` | Public key not registered | Stop — contact workspace owner |
| 401 on `/agent-token` | Invalid signature or expired/used nonce | Retry from step 1 |
| 401 on any API call | Token expired | Re-authenticate (steps 1–2) |

## Renewal

- JWT expires after 30 days. Re-run the challenge-response flow.
- If the private key is lost: workspace owner removes the old agent member and re-registers with a new keypair.
- If the agent is deactivated (member removed): 401 on all API calls. No automatic recovery — requires owner action.

## Implementation notes

- The nonce is single-use. A consumed or expired nonce returns 401.
- The challenge table (`agent_auth_challenges`) is cleaned up automatically (TTL 2 min). Old rows can be pruned periodically.
- Signature verification uses `cryptography.hazmat.primitives.asymmetric.ed25519.Ed25519PublicKey.verify()`. A wrong signature raises `InvalidSignature` → 401.
- The JWT `sub` claim is the agent's `user_id` (UUID). The agent's `workspace_member_id` is resolved at request time via the usual member lookup.
