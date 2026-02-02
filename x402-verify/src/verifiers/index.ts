/**
 * PaymentVerifier Interface
 *
 * Implementations verify that a payment proof corresponds to a real payment
 * matching the original instruction. Each verifier handles one payment network.
 */

import type { PaymentInstruction, PaymentProof, VerificationResult } from "../types.js";

export interface PaymentVerifier {
  /** The network identifier this verifier handles (e.g. "mock", "evm", "rtc") */
  readonly network: string;

  /**
   * Verify a payment proof against the original instruction.
   *
   * Should check:
   * - Transaction exists on the network
   * - Recipient matches instruction.payment.to
   * - Amount >= instruction.payment.amount
   * - Currency/token matches
   *
   * @param proof - The payment proof from the client
   * @param instruction - The original 402 payment instruction
   * @returns Verification result with valid flag and optional reason
   */
  verify(proof: PaymentProof, instruction: PaymentInstruction): Promise<VerificationResult>;
}

export { MockVerifier } from "./mock.js";
export { EVMVerifier } from "./evm.js";
export { RTCVerifier } from "./rtc.js";
