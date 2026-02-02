/**
 * Mock Payment Verifier
 *
 * Accepts any payment proof where txHash starts with "0xPAID".
 * Used for testing and demo purposes.
 */

import type { PaymentInstruction, PaymentProof, VerificationResult } from "../types.js";
import type { PaymentVerifier } from "./index.js";

export class MockVerifier implements PaymentVerifier {
  readonly network = "mock";

  async verify(proof: PaymentProof, instruction: PaymentInstruction): Promise<VerificationResult> {
    // Mock validation: txHash must start with "0xPAID"
    if (!proof.txHash.startsWith("0xPAID")) {
      return { valid: false, reason: "mock: txHash must start with 0xPAID" };
    }

    // Check network matches
    if (proof.network !== "mock") {
      return { valid: false, reason: `expected network "mock", got "${proof.network}"` };
    }

    return {
      valid: true,
      confirmedAmount: instruction.payment.amount,
    };
  }
}
