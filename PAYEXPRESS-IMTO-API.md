# PayExpress — IMTO Payout Integration Spec

**Version:** 0.1 (draft for integration) · **Audience:** IMTO / bank payout engineering team (Nigeria)
**Model:** Real-time payment instructions, **settle-then-credit** — you credit the beneficiary only after PayExpress confirms the corresponding USD has **settled in the US receivable account**. No pre-funding required.

---

## 1. How the integration works

```
Sender (US) --pays USD--> PayExpress (US MSB, HHFCU-sponsored)
     |                         |
     |            1. USD settles into US receivable (FBO) account
     |                         |
     |     2. PayExpress POSTs a SIGNED "payout.instruction" webhook to YOUR endpoint (real time)
     |            (instruction carries settlement_status = "settled")
     v                         v
  You (IMTO)  --3. credit beneficiary in NGN against settled funds-->  Beneficiary
     |
     4. You POST an acknowledgement (paid | failed) back to PayExpress
     5. PayExpress remits settled USD to your nostro on the agreed cycle + reconciliation file
```

You implement **two things**: (a) a **webhook endpoint** that receives instructions, and (b) calls to the **PayExpress acknowledgement endpoint**. That's the whole integration.

---

## 2. Environments & authentication

| | Base URL |
|---|---|
| Sandbox | `https://sandbox-api.payexpress.com` |
| Production | `https://api.payexpress.com` |

- **IMTO → PayExpress calls** (ack, status, lookups): `Authorization: Bearer <API_KEY>` (issued per environment).
- **PayExpress → IMTO webhooks**: signed with **HMAC-SHA256** over the raw request body using your **webhook signing secret**, sent in header `X-PayExpress-Signature: t=<unix_ts>,v1=<hex_hmac>`. **Verify every webhook** (see §6) and respond within **10 seconds**.
- All traffic is **HTTPS/TLS 1.2+**. Optional mutual-TLS and IP allowlisting available on request.

---

## 3. Webhook you receive — `payout.instruction`

PayExpress delivers this to the endpoint you register (e.g. `https://your-imto.ng/webhooks/payexpress`) the moment a transfer's USD has settled.

```http
POST /webhooks/payexpress HTTP/1.1
Content-Type: application/json
X-PayExpress-Signature: t=1757800000,v1=6b1f...e3a
X-PayExpress-Event-Id: evt_9Qk2...
```
```json
{
  "event": "payout.instruction",
  "event_id": "evt_9Qk2m7Xa",
  "created_at": "2026-09-14T10:02:31Z",
  "reference": "PX-8842013",
  "settlement_status": "settled",
  "usd_amount": 500.00,
  "fx_rate": 1585.00,
  "amount_ngn": 792500,
  "currency_out": "NGN",
  "method": "bank_account",
  "recipient": {
    "name": "Adaeze Okafor",
    "bank_code": "058",
    "nuban": "0123454471",
    "phone": "+2348030000000"
  },
  "sender": { "name": "John Doe", "country": "US" },
  "purpose": "family_support",
  "expires_at": "2026-09-15T10:02:31Z"
}
```

**Field notes**
| Field | Meaning |
|---|---|
| `reference` | PayExpress transfer id — **idempotency key**. Treat repeated deliveries of the same `reference` as one payout. |
| `settlement_status` | Always `settled` on `payout.instruction` (USD confirmed in the US receivable account). Never credit on any other value. |
| `usd_amount` / `fx_rate` / `amount_ngn` | Pay the beneficiary exactly `amount_ngn`. |
| `method` | `bank_account` \| `card` \| `mobile_wallet` \| `cash_pickup`. |
| `recipient.bank_code` | CBN/NIP institution code (bank_account) or wallet provider code. |
| `expires_at` | Credit before this; otherwise reject with `expired` and PayExpress auto-refunds the sender. |

**Response:** return **HTTP 200** with `{"received": true}` to acknowledge receipt (this is *not* the payout confirmation — that's the ack in §4). Non-2xx or timeout → PayExpress retries with exponential backoff for 24h.

---

## 4. Acknowledgement you send — payout result

After you credit (or fail) the beneficiary, confirm it:

```http
POST /v1/payouts/PX-8842013/ack
Authorization: Bearer <API_KEY>
Content-Type: application/json
```
```json
{
  "status": "paid",
  "provider_reference": "GTB-TXN-556677",
  "paid_at": "2026-09-14T10:03:05Z"
}
```
On failure:
```json
{ "status": "failed", "failure_code": "invalid_account", "failure_reason": "NUBAN not found" }
```

| `status` | Effect |
|---|---|
| `paid` | Payout complete; PayExpress marks the transfer delivered and includes it in the next settlement/reconciliation cycle. |
| `failed` | PayExpress refunds the sender; funds are **not** remitted for this item. |

**Failure codes:** `invalid_account`, `account_name_mismatch`, `limit_exceeded`, `kyc_required`, `expired`, `technical_error`.
Response: `200 { "reference":"PX-8842013", "status":"paid", "settlement_batch":"stl_2026-09-14" }`.

---

## 5. Supporting endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/payouts/{reference}` | Fetch current state of a transfer (defensive lookups / reconciliation). |
| `GET` | `/v1/settlements/{batch_id}` | Settlement batch detail — the USD remitted to your nostro and the line items covered. |
| `GET` | `/v1/institutions` | Supported bank/wallet `bank_code` list you should map to. |
| `POST` | `/v1/webhooks/test` | Fire a sample `payout.instruction` at your endpoint (sandbox). |

Daily **reconciliation file** (CSV/JSON) is also delivered per settlement cycle: `reference, usd_amount, amount_ngn, status, provider_reference, settled_batch`.

---

## 6. Verifying the webhook signature (do this on every call)

```
signed_payload = "{t}." + raw_request_body
expected = HMAC_SHA256(webhook_secret, signed_payload)   // hex
// constant-time compare expected == v1 from X-PayExpress-Signature
// reject if timestamp t is older than 5 minutes (replay protection)
```
Node example:
```js
const crypto = require("crypto");
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=")));
  const expected = crypto.createHmac("sha256", secret)
    .update(parts.t + "." + rawBody).digest("hex");
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  const fresh = Math.abs(Date.now()/1000 - Number(parts.t)) < 300;
  return ok && fresh;
}
```

---

## 7. Idempotency, retries & ordering
- **Idempotency:** key every payout by `reference`. If you receive the same `reference` twice, do **not** double-credit — return your prior result.
- **Retries:** PayExpress retries un-acknowledged webhooks (backoff, up to 24h). Your endpoint must be idempotent.
- **Ack idempotency:** re-POSTing `/ack` with the same terminal status is safe and returns the stored result.

---

## 8. Security & compliance
- HTTPS only; HMAC-verify every webhook; enforce the 5-minute freshness window; constant-time compare.
- US-side **KYC/AML/OFAC** screening is completed by PayExpress (FinCEN-registered MSB, HHFCU-sponsored) **before** an instruction is sent — flows delivered to you are pre-screened and traceable.
- Operate within the **CBN IMTO / authorised-dealer framework**; apply your own recipient KYC and record-keeping.
- PII is limited to what payout requires; encrypt at rest; do not log full account numbers.

---

## 9. Go-live checklist
1. Provide your **webhook URL** + receive **sandbox API key** and **webhook secret**.
2. Map your **bank/wallet codes** to `/v1/institutions`.
3. Implement webhook receipt + signature verification + `/ack`.
4. Run sandbox flows (`/v1/webhooks/test`), verify reconciliation.
5. Certification sign-off → production keys → start with one corridor and scale.

---

*Draft integration spec (v0.1) for discussion; endpoints, fields, and the settlement cycle are finalised in the definitive agreement. PayExpress is operated by BizFormCorp and powered by Heritage Hub Federal Credit Union (HHFCU).*
