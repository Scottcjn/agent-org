/**
 * RustChain RTC Payment Verifier
 *
 * Verifies payments made via the RustChain RTC blockchain.
 * Queries the RustChain node's ledger API to confirm transfers.
 *
 * This verifier can work with any RustChain node that exposes
 * the /api/ledger and /wallet/balance endpoints.
 */

import type { PaymentInstruction, PaymentProof, VerificationResult } from "../types.js";
import type { PaymentVerifier } from "./index.js";

export class RTCVerifier implements PaymentVerifier {
  readonly network = "rtc";

  private nodeUrl: string;

  constructor(nodeUrl?: string) {
    this.nodeUrl = nodeUrl ?? "https://50.28.86.131";
  }

  async verify(proof: PaymentProof, instruction: PaymentInstruction): Promise<VerificationResult> {
    if (proof.network !== "rtc") {
      return { valid: false, reason: `expected network "rtc", got "${proof.network}"` };
    }

    if (!proof.txHash) {
      return { valid: false, reason: "missing txHash (RTC ledger reference)" };
    }

    try {
      // Query the RustChain ledger for the transaction
      const res = await fetch(`${this.nodeUrl}/api/ledger?tx_ref=${encodeURIComponent(proof.txHash)}`, {
        headers: { Accept: "application/json" },
        // RustChain nodes use self-signed certs in testnet
        // @ts-expect-error - Node.js fetch rejectUnauthorized
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return { valid: false, reason: `RTC node returned ${res.status}` };
      }

      const data = (await res.json()) as {
        ok?: boolean;
        tx?: {
          from_miner: string;
          to_miner: string;
          amount_rtc: number;
          memo?: string;
          tx_ref?: string;
        };
      };

      if (!data.ok || !data.tx) {
        return { valid: false, reason: "transaction not found in RTC ledger" };
      }

      const tx = data.tx;

      // Verify recipient matches
      const expectedTo = instruction.payment.to.toLowerCase();
      if (tx.to_miner.toLowerCase() !== expectedTo) {
        return {
          valid: false,
          reason: `recipient mismatch: expected ${expectedTo}, got ${tx.to_miner}`,
        };
      }

      // Verify amount is sufficient
      const expectedAmount = parseFloat(instruction.payment.amount);
      if (tx.amount_rtc < expectedAmount) {
        return {
          valid: false,
          reason: `insufficient amount: expected ${expectedAmount} RTC, got ${tx.amount_rtc}`,
        };
      }

      return {
        valid: true,
        confirmedAmount: String(tx.amount_rtc),
      };
    } catch {
      return { valid: false, reason: "rtc: failed to reach RustChain node" };
    }
  }
}
