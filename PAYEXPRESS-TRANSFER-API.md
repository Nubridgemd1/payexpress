# PayExpress — Transfer API Contract

How the PayExpress app talks to your money-movement backend. The app is the
**client**; your backend (payment processor + IMTO payout, operating under HHFCU
as Transmitter of Record) is the **server**. Configure the two URLs in
**Admin → Rates & Fees → Go-live**:

| Setting | Stored as | Used for |
|---|---|---|
| **Transfer API endpoint (POST)** | `px_backend` | Create a transfer |
| **Status endpoint (GET ?ref=)** | `px_status` | Poll a transfer's current state |

Until the POST endpoint is set, the app shows "not connected" and never submits.

---

## 1. Create a transfer — `POST {Transfer API endpoint}`

Sent by the app the moment the sender taps **Send**. `Content-Type: application/json`.

### Request body (exactly what the app sends)

```json
{
  "ref": "PX-4821905",
  "createdAt": "2026-10-08T14:03:21.117Z",
  "status": "processing",
  "sender": {
    "name": "Jane Doe"
  },
  "recipient": {
    "name": "Adaeze Okafor",
    "country": "Nigeria",
    "countryCode": "NG",
    "currency": "NGN",
    "method": "Bank account",
    "institution": "Guaranty Trust Bank (GTBank)",
    "account": "0123454471"
  },
  "amount": {
    "sendUsd": 500,
    "feeUsd": 0,
    "fxRate": 1585,
    "payout": 792500,
    "payoutCurrency": "NGN"
  }
}
```

### Field reference

| Field | Type | Notes |
|---|---|---|
| `ref` | string | **Idempotency key.** Client-generated (`PX-#######`), unique per transfer. Treat a repeat `ref` as the same transfer — do not double-pay. |
| `createdAt` | string (ISO-8601 UTC) | When the sender submitted. |
| `status` | string | Always `"processing"` on create. |
| `sender.name` | string \| null | Sender's legal name from KYC (null if KYC not yet captured). |
| `recipient.name` | string | Beneficiary full name. |
| `recipient.country` | string | Destination country name. |
| `recipient.countryCode` | string | ISO-3166 alpha-2 (e.g. `NG`, `GH`, `KE`). |
| `recipient.currency` | string | ISO-4217 payout currency (e.g. `NGN`, `GHS`, `INR`). |
| `recipient.method` | string | `Bank account` \| `Mobile wallet` \| `Cash pickup` \| `Debit card`. |
| `recipient.institution` | string | Selected bank / wallet / institution (your backend maps this to the destination bank/wallet code). |
| `recipient.account` | string | Account number / NUBAN / IBAN / wallet number. |
| `amount.sendUsd` | number | USD the sender pays. |
| `amount.feeUsd` | number | Fee in USD (currently 0). |
| `amount.fxRate` | number | Units of payout currency per 1 USD quoted to the sender. |
| `amount.payout` | number | Amount to deliver, in `payoutCurrency`. |
| `amount.payoutCurrency` | string | Same as `recipient.currency`. |

### Response (what your backend returns)

Return `200`/`201` with at least a `status`. If you return a terminal status
here, the app reflects it immediately; otherwise it stays **Processing** and the
app polls the status endpoint.

```json
{
  "ref": "PX-4821905",
  "status": "processing",
  "providerRef": "IMTO-99f3ac",
  "estimatedDelivery": "2026-10-08T14:08:00Z"
}
```

`status` accepted values (case-insensitive; the app normalizes them):

| Backend status | Shown in app |
|---|---|
| `processing`, `pending`, `submitted` | **Processing** |
| `paid_out`, `delivered`, `completed`, `settled`, `success` | **Paid out** |
| `failed`, `rejected`, `cancelled`, `declined` | **Failed** |
| `refunded` | **Refunded** |

### Errors

Return a non-2xx with a JSON body `{ "error": "code", "message": "..." }`.
Because `ref` is the idempotency key, a retried create with the same `ref` must
return the **existing** transfer, not a new one.

---

## 2. Status / payout callback — "flip to Paid out"

A transfer starts **Processing**. When your IMTO partner confirms the payout,
the app needs to move it to **Paid out**. Two mechanisms — use either or both:

### 2a. Status polling (what this app does today)

If a **Status endpoint** is configured, the app polls it (on load and every
60s) for every transfer still `processing`:

```
GET {Status endpoint}?ref=PX-4821905
```

Response:

```json
{ "ref": "PX-4821905", "status": "paid_out", "providerRef": "IMTO-99f3ac", "paidAt": "2026-10-08T14:07:52Z" }
```

The app maps `status` (see table above) and updates that transfer to **Paid
out** / **Failed** in Activity and the admin console.

### 2b. Server-to-server webhook (recommended once you run a PayExpress server)

A static front-end can't receive webhooks, but your production PayExpress server
should. Your backend `POST`s to your PayExpress webhook URL on every state change:

```
POST {your PayExpress server}/webhooks/payexpress/transfer
X-PayExpress-Signature: t=1696771672,v1=hex_hmac_sha256(secret, payload)
```

```json
{
  "event": "transfer.paid_out",
  "ref": "PX-4821905",
  "providerRef": "IMTO-99f3ac",
  "status": "paid_out",
  "payout": 792500,
  "payoutCurrency": "NGN",
  "paidAt": "2026-10-08T14:07:52Z"
}
```

- Events: `transfer.processing`, `transfer.paid_out`, `transfer.failed`, `transfer.refunded`.
- **Verify** `X-PayExpress-Signature` (HMAC-SHA256 over the raw body with a shared secret) and reject on mismatch.
- Respond `200` within 5s; retry with backoff on non-2xx (at-least-once delivery — dedupe on `ref` + `event`).

---

## 3. Account-name verification (name enquiry) — `POST {Account-resolution endpoint}`

Called from the recipient form when the sender enters the account number (and
bank). Resolves the account holder's name so it auto-fills — preventing mis-sends.
Configure the URL in **Admin → Go-live → Account-resolution endpoint**.

**Request**

```json
{ "currency": "NGN", "institution": "Guaranty Trust Bank (GTBank)", "account": "0123454471" }
```

**Response (success)** — the app fills the recipient's name (and bank if returned):

```json
{ "accountName": "ADAEZE N OKAFOR", "institution": "Guaranty Trust Bank (GTBank)", "bankCode": "058" }
```

**Response (not found)**

```json
{ "accountName": null, "message": "Account not found for the selected bank." }
```

Notes: for Nigerian NUBAN this maps to NIBSS name enquiry (needs `bankCode` +
`account`); your backend resolves `institution` → bank code. For wallets/other
corridors, resolve via the relevant provider. If no resolver is configured, the
form shows "verification activates once the backend is connected" and the sender
types the name manually.

---

## 4. Transfer lifecycle

```
Sender taps Send
   │  POST /transfer  (status: processing)
   ▼
Processing ──► (card charged, screened: KYC/AML/OFAC) ──► routed to IMTO
   │                                                         │
   │ status endpoint / webhook                               ▼
   └──────────────► Paid out        Failed ◄─── payout rejected / screening block
                                     Refunded ◄─ funds returned to sender
```

---

## 5. What the backend must still own (outside this contract)

The app only quotes, collects the order, and reflects status. Real money
movement requires your backend to:

1. **Charge the sender** (card / ACH processor) for `sendUsd`.
2. **Screen** — KYC on the sender, AML & OFAC/sanctions on both parties.
3. **Settle & pay out** via the licensed IMTO in the destination country to the
   `institution` + `account`, honoring state/CBN rules.
4. Operate under **HHFCU (Transmitter of Record)** per the Program & BSA/AML
   oversight agreements.
5. Drive status via the callback/webhook above.

---

*PayExpress · Powered by BizFormCorp and HHFCU · Confidential.*
