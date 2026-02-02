import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app, store } from "../src/server.js";
import type { Server } from "http";

let server: Server;
const BASE = "http://localhost:13402";

beforeAll(async () => {
  // Start on a test port
  server = app.listen(13402);
});

afterAll(() => {
  store.destroy();
  server.close();
});

async function fetchResource(headers?: Record<string, string>) {
  return fetch(`${BASE}/resource`, { headers });
}

// ---------------------------------------------------------------------------
// Core 402 Flow
// ---------------------------------------------------------------------------

describe("x402 payment flow", () => {
  it("returns 402 with payment instruction when no proof", async () => {
    const res = await fetchResource();
    expect(res.status).toBe(402);

    const body = await res.json();
    expect(body.status).toBe(402);
    expect(body.instruction).toBeDefined();
    expect(body.instruction.version).toBe("x402-draft-1");
    expect(body.instruction.nonce).toBeTruthy();
    expect(body.instruction.payment.network).toBeTruthy();
    expect(body.instruction.payment.to).toBeTruthy();
    expect(body.instruction.payment.amount).toBeTruthy();
    expect(body.instruction.expiresAt).toBeTruthy();
    expect(body.instruction.payTo).toContain("/resource");
  });

  it("returns 200 when valid mock proof is provided", async () => {
    // Step 1: Get payment instruction
    const res402 = await fetchResource();
    const { instruction } = await res402.json();

    // Step 2: Build proof
    const proof = {
      nonce: instruction.nonce,
      network: "mock",
      txHash: "0xPAID_test_1234567890",
      from: "test-payer",
    };

    // Step 3: Submit proof
    const proofHeader = Buffer.from(JSON.stringify(proof)).toString("base64");
    const res200 = await fetchResource({ "X-Payment-Proof": proofHeader });

    expect(res200.status).toBe(200);
    const body = await res200.json();
    expect(body.data.content).toBeTruthy();
    expect(body.data.paidAmount).toBe(instruction.payment.amount);
    expect(body.data.nonce).toBe(instruction.nonce);
  });

  it("accepts raw JSON proof header", async () => {
    const res402 = await fetchResource();
    const { instruction } = await res402.json();

    const proof = JSON.stringify({
      nonce: instruction.nonce,
      network: "mock",
      txHash: "0xPAID_raw_json_test",
      from: "test-payer",
    });

    const res200 = await fetchResource({ "X-Payment-Proof": proof });
    expect(res200.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Replay Protection
// ---------------------------------------------------------------------------

describe("replay protection", () => {
  it("rejects reused nonce (replay attack)", async () => {
    // Get instruction
    const res402 = await fetchResource();
    const { instruction } = await res402.json();

    const proof = {
      nonce: instruction.nonce,
      network: "mock",
      txHash: "0xPAID_replay_test",
      from: "attacker",
    };
    const header = Buffer.from(JSON.stringify(proof)).toString("base64");

    // First use: should succeed
    const res1 = await fetchResource({ "X-Payment-Proof": header });
    expect(res1.status).toBe(200);

    // Second use: should fail (replay)
    const res2 = await fetchResource({ "X-Payment-Proof": header });
    expect(res2.status).toBe(402);
    const body = await res2.json();
    expect(body.error).toContain("redeemed");
  });

  it("rejects unknown nonce", async () => {
    const proof = {
      nonce: "nonexistent-nonce-00000",
      network: "mock",
      txHash: "0xPAID_unknown",
      from: "attacker",
    };
    const header = Buffer.from(JSON.stringify(proof)).toString("base64");

    const res = await fetchResource({ "X-Payment-Proof": header });
    expect(res.status).toBe(402);
  });

  it("generates unique nonces for each request", async () => {
    const res1 = await fetchResource();
    const res2 = await fetchResource();
    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.instruction.nonce).not.toBe(body2.instruction.nonce);
  });
});

// ---------------------------------------------------------------------------
// Verification Failures
// ---------------------------------------------------------------------------

describe("verification failures", () => {
  it("rejects invalid mock txHash", async () => {
    const res402 = await fetchResource();
    const { instruction } = await res402.json();

    const proof = {
      nonce: instruction.nonce,
      network: "mock",
      txHash: "INVALID_NOT_PAID",
      from: "cheapskate",
    };
    const header = Buffer.from(JSON.stringify(proof)).toString("base64");

    const res = await fetchResource({ "X-Payment-Proof": header });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.reason).toContain("0xPAID");
  });

  it("rejects unknown payment network", async () => {
    const res402 = await fetchResource();
    const { instruction } = await res402.json();

    const proof = {
      nonce: instruction.nonce,
      network: "dogecoin",
      txHash: "0xPAID_doge",
      from: "shibe",
    };
    const header = Buffer.from(JSON.stringify(proof)).toString("base64");

    const res = await fetchResource({ "X-Payment-Proof": header });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unknown payment network");
  });

  it("rejects malformed proof header", async () => {
    const res = await fetchResource({ "X-Payment-Proof": "not-valid-json-or-base64!!!" });
    // Could be 400 (malformed) or 402 (missing fields)
    expect([400, 402]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Utility Endpoints
// ---------------------------------------------------------------------------

describe("utility endpoints", () => {
  it("GET /health returns ok", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("x402-verify");
  });

  it("GET /networks lists supported networks", async () => {
    const res = await fetch(`${BASE}/networks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networks).toContain("mock");
    expect(body.networks).toContain("evm");
    expect(body.networks).toContain("rtc");
  });
});

// ---------------------------------------------------------------------------
// Nonce Store
// ---------------------------------------------------------------------------

describe("nonce store", () => {
  it("expires sessions after TTL", async () => {
    const { NonceStore } = await import("../src/store.js");
    const shortStore = new NonceStore(50); // 50ms TTL

    const instruction = {
      version: "x402-draft-1" as const,
      nonce: "",
      resource: "test",
      payment: { network: "mock", to: "test", amount: "1", currency: "USD" },
      expiresAt: new Date(Date.now() + 50).toISOString(),
      payTo: "http://test/resource",
    };

    const nonce = shortStore.create(instruction);
    expect(shortStore.isValid(nonce)).toBe(true);

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 100));
    expect(shortStore.isValid(nonce)).toBe(false);

    shortStore.destroy();
  });
});
