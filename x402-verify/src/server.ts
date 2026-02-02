/**
 * x402-verify Server
 *
 * HTTP 402 Payment Required verification endpoint.
 *
 * Flow:
 *   GET /resource → 402 + PaymentInstruction JSON
 *   GET /resource (with X-Payment-Proof header) → verifies → 200 + content
 *
 * The server generates a unique nonce per 402 response, which the client
 * must include when submitting payment proof. This prevents replay attacks.
 */

import express, { type Request, type Response } from "express";
import { NonceStore } from "./store.js";
import type { PaymentInstruction, PaymentProof, VerificationResult } from "./types.js";
import type { PaymentVerifier } from "./verifiers/index.js";
import { MockVerifier } from "./verifiers/mock.js";
import { EVMVerifier } from "./verifiers/evm.js";
import { RTCVerifier } from "./verifiers/rtc.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? "3402", 10);
const PAYMENT_NETWORK = process.env.PAYMENT_NETWORK ?? "mock";
const PAYMENT_TO = process.env.PAYMENT_TO ?? "merchant-wallet-001";
const PAYMENT_AMOUNT = process.env.PAYMENT_AMOUNT ?? "0.01";
const PAYMENT_CURRENCY = process.env.PAYMENT_CURRENCY ?? "USD";
const NONCE_TTL_MS = parseInt(process.env.NONCE_TTL_MS ?? String(10 * 60 * 1000), 10);

// RTC-specific config
const RTC_NODE_URL = process.env.RTC_NODE_URL ?? "https://50.28.86.131";

// EVM-specific config
const EVM_RPC_URL = process.env.EVM_RPC_URL ?? "http://localhost:8545";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

const store = new NonceStore(NONCE_TTL_MS);

// Register verifiers by network
const verifiers = new Map<string, PaymentVerifier>();
verifiers.set("mock", new MockVerifier());
verifiers.set("evm", new EVMVerifier(EVM_RPC_URL));
verifiers.set("rtc", new RTCVerifier(RTC_NODE_URL));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInstruction(req: Request, nonce: string): PaymentInstruction {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  return {
    version: "x402-draft-1",
    nonce,
    resource: `${baseUrl}${req.path}`,
    payment: {
      network: PAYMENT_NETWORK,
      to: PAYMENT_TO,
      amount: PAYMENT_AMOUNT,
      currency: PAYMENT_CURRENCY,
    },
    expiresAt: new Date(Date.now() + NONCE_TTL_MS).toISOString(),
    payTo: `${baseUrl}${req.path}`,
  };
}

function parseProofHeader(header: string): PaymentProof | null {
  try {
    // Accept base64-encoded JSON or raw JSON
    let json: string;
    if (header.startsWith("{")) {
      json = header;
    } else {
      json = Buffer.from(header, "base64").toString("utf-8");
    }
    const parsed = JSON.parse(json);

    // Validate required fields
    if (!parsed.nonce || !parsed.network || !parsed.txHash || !parsed.from) {
      return null;
    }

    return parsed as PaymentProof;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /resource
 *
 * The protected endpoint. Without valid payment proof, returns 402.
 * With valid proof in X-Payment-Proof header, returns the content.
 */
app.get("/resource", async (req: Request, res: Response): Promise<void> => {
  const proofHeader = req.get("X-Payment-Proof");

  // No proof → return 402 with payment instructions
  if (!proofHeader) {
    const instruction = buildInstruction(req, "");
    const nonce = store.create(instruction);
    // Update instruction with actual nonce
    instruction.nonce = nonce;

    res.status(402).json({
      status: 402,
      message: "Payment Required",
      instruction,
    });
    return;
  }

  // Parse the proof
  const proof = parseProofHeader(proofHeader);
  if (!proof) {
    res.status(400).json({
      status: 400,
      error: "Invalid X-Payment-Proof header. Expected base64 or JSON.",
    });
    return;
  }

  // Redeem the nonce (atomic: prevents replay)
  const session = store.redeem(proof.nonce, proof);
  if (!session) {
    res.status(402).json({
      status: 402,
      error: "Invalid, expired, or already-redeemed nonce.",
      message: "Request a new payment instruction.",
    });
    return;
  }

  // Find the right verifier
  const verifier = verifiers.get(proof.network);
  if (!verifier) {
    res.status(400).json({
      status: 400,
      error: `Unknown payment network: "${proof.network}". Supported: ${[...verifiers.keys()].join(", ")}`,
    });
    return;
  }

  // Verify the payment
  let result: VerificationResult;
  try {
    result = await verifier.verify(proof, session.instruction);
  } catch {
    res.status(502).json({
      status: 502,
      error: "Payment verification failed due to upstream error.",
    });
    return;
  }

  if (!result.valid) {
    res.status(402).json({
      status: 402,
      error: "Payment verification failed.",
      reason: result.reason,
    });
    return;
  }

  // Payment verified - return the protected content
  res.status(200).json({
    status: 200,
    message: "Payment verified. Access granted.",
    data: {
      content: "This is the protected resource content.",
      paidAmount: result.confirmedAmount,
      network: proof.network,
      nonce: proof.nonce,
    },
  });
});

/**
 * GET /health
 * Basic health check endpoint.
 */
app.get("/health", (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    service: "x402-verify",
    network: PAYMENT_NETWORK,
    activeSessions: store.size,
  });
});

/**
 * GET /networks
 * List supported payment networks.
 */
app.get("/networks", (_req: Request, res: Response): void => {
  res.json({
    networks: [...verifiers.keys()],
    default: PAYMENT_NETWORK,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`x402-verify listening on http://localhost:${PORT}`);
  console.log(`  Payment network: ${PAYMENT_NETWORK}`);
  console.log(`  Recipient: ${PAYMENT_TO}`);
  console.log(`  Amount: ${PAYMENT_AMOUNT} ${PAYMENT_CURRENCY}`);
  console.log(`  Nonce TTL: ${NONCE_TTL_MS / 1000}s`);
  console.log();
  console.log(`Try: curl http://localhost:${PORT}/resource`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  store.destroy();
  server.close();
});

export { app, store, verifiers };
