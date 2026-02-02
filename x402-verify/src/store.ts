/**
 * Nonce Store - Replay Protection
 *
 * Tracks payment sessions by nonce to prevent:
 * - Replay attacks (reusing the same proof twice)
 * - Expired payment instructions
 * - Nonce collision
 *
 * This is an in-memory implementation. A production deployment
 * would use Redis or a database for persistence.
 */

import { v4 as uuidv4 } from "uuid";
import type { PaymentInstruction, PaymentProof, PaymentSession } from "./types.js";

/** Default TTL for payment sessions: 10 minutes */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Cleanup interval: run every 60 seconds */
const CLEANUP_INTERVAL_MS = 60 * 1000;

export class NonceStore {
  private sessions = new Map<string, PaymentSession>();
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? DEFAULT_TTL_MS;

    // Periodic cleanup of expired sessions
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /** Generate a new nonce and store the payment session */
  create(instruction: PaymentInstruction): string {
    const nonce = uuidv4();
    const session: PaymentSession = {
      nonce,
      instruction: { ...instruction, nonce },
      createdAt: Date.now(),
      redeemed: false,
    };
    this.sessions.set(nonce, session);
    return nonce;
  }

  /** Look up a session by nonce. Returns null if not found or expired. */
  get(nonce: string): PaymentSession | null {
    const session = this.sessions.get(nonce);
    if (!session) return null;

    // Check expiry
    if (Date.now() - session.createdAt > this.ttlMs) {
      this.sessions.delete(nonce);
      return null;
    }

    return session;
  }

  /**
   * Attempt to redeem a nonce with a payment proof.
   * Returns the session if successful, null if:
   * - Nonce not found
   * - Nonce already redeemed
   * - Nonce expired
   */
  redeem(nonce: string, proof: PaymentProof): PaymentSession | null {
    const session = this.get(nonce);
    if (!session) return null;
    if (session.redeemed) return null;

    session.redeemed = true;
    session.proof = proof;
    return session;
  }

  /** Check if a nonce exists and has NOT been redeemed */
  isValid(nonce: string): boolean {
    const session = this.get(nonce);
    return session !== null && !session.redeemed;
  }

  /** Remove expired sessions */
  private cleanup(): void {
    const now = Date.now();
    for (const [nonce, session] of this.sessions) {
      if (now - session.createdAt > this.ttlMs) {
        this.sessions.delete(nonce);
      }
    }
  }

  /** Stop the cleanup timer (for graceful shutdown / tests) */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }

  /** Number of active (non-expired) sessions */
  get size(): number {
    this.cleanup();
    return this.sessions.size;
  }
}
