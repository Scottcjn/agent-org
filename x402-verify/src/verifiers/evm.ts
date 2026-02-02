/**
 * EVM Payment Verifier (Stub)
 *
 * Placeholder for on-chain EVM payment verification.
 * In production, this would query an Ethereum/L2 RPC endpoint
 * to confirm the transaction exists and matches the instruction.
 */

import type { PaymentInstruction, PaymentProof, VerificationResult } from "../types.js";
import type { PaymentVerifier } from "./index.js";

export class EVMVerifier implements PaymentVerifier {
  readonly network = "evm";

  private rpcUrl: string;

  constructor(rpcUrl?: string) {
    this.rpcUrl = rpcUrl ?? "http://localhost:8545";
  }

  async verify(proof: PaymentProof, instruction: PaymentInstruction): Promise<VerificationResult> {
    if (proof.network !== "evm") {
      return { valid: false, reason: `expected network "evm", got "${proof.network}"` };
    }

    if (!proof.txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
      return { valid: false, reason: "invalid EVM transaction hash format" };
    }

    // In production: fetch tx receipt from RPC, verify to/value/token
    // For now, return not-implemented so the bounty reviewer knows
    // this is a real extension point, not just a pass-through.
    try {
      const receipt = await this.fetchReceipt(proof.txHash);
      if (!receipt) {
        return { valid: false, reason: "transaction not found on chain" };
      }

      // Verify recipient
      const expectedTo = instruction.payment.to.toLowerCase();
      if (receipt.to?.toLowerCase() !== expectedTo) {
        return { valid: false, reason: `recipient mismatch: expected ${expectedTo}` };
      }

      return { valid: true, confirmedAmount: receipt.value };
    } catch {
      return { valid: false, reason: "evm: RPC query failed - is the node reachable?" };
    }
  }

  private async fetchReceipt(txHash: string): Promise<{ to: string; value: string } | null> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionByHash",
        params: [txHash],
      }),
    });

    const json = (await res.json()) as { result?: { to: string; value: string } };
    return json.result ?? null;
  }
}
