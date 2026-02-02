# x402-verify

HTTP 402 Payment Required verification endpoint prototype, implementing the x402 payment protocol.

## Protocol Overview

The x402 protocol adds machine-readable payment instructions to the HTTP 402 status code:

```
Client                          Server
  │                                │
  │  GET /resource                 │
  │──────────────────────────────▶ │
  │                                │
  │  402 + PaymentInstruction      │
  │◀────────────────────────────── │  (includes nonce, amount, recipient)
  │                                │
  │  [Client makes payment]        │
  │                                │
  │  GET /resource                 │
  │  X-Payment-Proof: <proof>      │
  │──────────────────────────────▶ │
  │                                │
  │  200 + Content                 │
  │◀────────────────────────────── │  (nonce consumed, replay blocked)
  │                                │
```

### Payment Instruction (402 Response)

```json
{
  "status": 402,
  "message": "Payment Required",
  "instruction": {
    "version": "x402-draft-1",
    "nonce": "unique-uuid-v4",
    "resource": "http://localhost:3402/resource",
    "payment": {
      "network": "mock",
      "to": "merchant-wallet-001",
      "amount": "0.01",
      "currency": "USD"
    },
    "expiresAt": "2025-12-06T12:10:00.000Z",
    "payTo": "http://localhost:3402/resource"
  }
}
```

### Payment Proof (Client Header)

The client submits proof via the `X-Payment-Proof` header as base64-encoded JSON (or raw JSON):

```json
{
  "nonce": "the-nonce-from-402",
  "network": "mock",
  "txHash": "0xPAID_transaction_reference",
  "from": "payer-address"
}
```

## Quick Start

```bash
npm install
npm run dev
```

Server starts on `http://localhost:3402`.

## Demo

```bash
# Start the server in one terminal
npm run dev

# Run the demo in another terminal
npm run demo
```

The demo shows the full 3-step flow: 402 → payment → 200, plus replay rejection.

## Testing

```bash
npm test
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3402` | Server port |
| `PAYMENT_NETWORK` | `mock` | Default payment network |
| `PAYMENT_TO` | `merchant-wallet-001` | Recipient address |
| `PAYMENT_AMOUNT` | `0.01` | Required payment amount |
| `PAYMENT_CURRENCY` | `USD` | Currency symbol |
| `NONCE_TTL_MS` | `600000` | Nonce expiry (10 min) |
| `RTC_NODE_URL` | `https://50.28.86.131` | RustChain node URL |
| `EVM_RPC_URL` | `http://localhost:8545` | Ethereum RPC URL |

## Payment Networks

### Mock (default)

For testing. Accepts any proof where `txHash` starts with `"0xPAID"`.

### EVM

Verifies Ethereum/L2 transactions by querying an RPC endpoint. Checks:
- Transaction exists on chain
- Recipient matches payment instruction
- Amount is sufficient

### RTC (RustChain)

Verifies RustChain RTC token transfers by querying a RustChain node's ledger API. Checks:
- Transaction exists in ledger
- Recipient matches
- Amount >= required

## Replay Protection

Each 402 response contains a unique nonce (UUIDv4). Nonces are:
- **Single-use**: Once redeemed with a valid proof, the nonce is consumed
- **Time-limited**: Nonces expire after `NONCE_TTL_MS` (default 10 minutes)
- **Server-side tracked**: The nonce store prevents any nonce from being used twice

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/resource` | Protected endpoint (402 without proof, 200 with valid proof) |
| GET | `/health` | Health check |
| GET | `/networks` | List supported payment networks |

## Architecture

```
src/
├── types.ts              # PaymentInstruction, PaymentProof, etc.
├── store.ts              # NonceStore for replay protection
├── server.ts             # Express server with 402 flow
└── verifiers/
    ├── index.ts          # PaymentVerifier interface
    ├── mock.ts           # Mock verifier (testing)
    ├── evm.ts            # EVM on-chain verifier
    └── rtc.ts            # RustChain RTC verifier
```

## Adding a Custom Verifier

Implement the `PaymentVerifier` interface:

```typescript
import type { PaymentVerifier } from "./verifiers/index.js";

class MyVerifier implements PaymentVerifier {
  readonly network = "my-network";

  async verify(proof, instruction) {
    // Check proof against your payment network
    // Return { valid: true/false, reason?, confirmedAmount? }
  }
}
```

Then register it in `server.ts`:

```typescript
verifiers.set("my-network", new MyVerifier());
```

## License

MIT
