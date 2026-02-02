/**
 * x402 Payment Protocol Types
 *
 * Defines the core data structures for the HTTP 402 payment flow:
 * 1. Server returns 402 + PaymentInstruction
 * 2. Client pays and retries with PaymentProof
 * 3. Server verifies proof and returns 200
 */

/** Payment instruction returned in the 402 response body */
export interface PaymentInstruction {
  /** Protocol version */
  version: "x402-draft-1";
  /** Unique nonce for replay protection - must be included in proof */
  nonce: string;
  /** Human-readable description of the resource being paid for */
  resource: string;
  /** Payment details */
  payment: {
    /** Payment network identifier (e.g. "mock", "evm", "rtc") */
    network: string;
    /** Recipient address on the payment network */
    to: string;
    /** Amount to pay (string to avoid floating point issues) */
    amount: string;
    /** Currency or token symbol */
    currency: string;
    /** Optional: contract address for token payments */
    contract?: string;
    /** Optional: chain ID for EVM payments */
    chainId?: number;
  };
  /** ISO 8601 timestamp after which this instruction expires */
  expiresAt: string;
  /** URL to retry with payment proof */
  payTo: string;
}

/** Payment proof submitted by client when retrying the request */
export interface PaymentProof {
  /** The nonce from the original 402 response */
  nonce: string;
  /** Payment network that was used */
  network: string;
  /** Transaction hash or reference from the payment */
  txHash: string;
  /** Payer address/identifier */
  from: string;
  /** Optional: additional proof data (e.g. block number, signature) */
  meta?: Record<string, unknown>;
}

/** Result of verifying a payment proof */
export interface VerificationResult {
  /** Whether the payment was verified successfully */
  valid: boolean;
  /** Reason for failure (if valid=false) */
  reason?: string;
  /** Confirmed amount (may differ from requested if overpaid) */
  confirmedAmount?: string;
}

/** A pending payment session stored by the nonce store */
export interface PaymentSession {
  /** The nonce identifying this session */
  nonce: string;
  /** The original payment instruction */
  instruction: PaymentInstruction;
  /** When this session was created (unix ms) */
  createdAt: number;
  /** Whether this nonce has been redeemed */
  redeemed: boolean;
  /** The proof that redeemed this nonce (if redeemed) */
  proof?: PaymentProof;
}
