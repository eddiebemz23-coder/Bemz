import 'server-only';
import { env, isProduction } from '../env';
import { serviceUnavailable } from '../http';
import type { ChargeResult, RefundResult, StatusResult } from './types';

/**
 * Local development without operator credentials.
 *
 * Without credentials a checkout cannot be tested at all, so outside production an
 * unconfigured rail records the payment as successful with a `SIM-` reference. In
 * production the same missing credential throws instead of silently taking money.
 */

export function requireCredentials(configured: boolean, providerName: string): void {
  if (configured) return;
  if (isProduction()) {
    throw serviceUnavailable(`${providerName} is not configured on this server`);
  }
}

export function sandboxEnabled(configured: boolean): boolean {
  return !configured && !isProduction();
}

export function simulatedCharge(externalId: string, amountMinor: number, currency: string): ChargeResult {
  return {
    status: 'SUCCEEDED',
    providerReference: `SIM-${externalId}`,
    clientToken: null,
    redirectUrl: null,
    buyerInstruction: `Sandbox: ${amountMinor} ${currency} recorded as paid — no operator credentials are configured.`,
    expiresAt: new Date(Date.now() + 30 * 60_000),
    failureReason: null,
    raw: { simulated: true, externalId, missingCredentials: env().NODE_ENV },
  };
}

export const simulatedStatus = (externalId: string): StatusResult => ({
  status: 'SUCCEEDED',
  providerReference: `SIM-${externalId}`,
  providerFeeMinor: 0,
  failureReason: null,
  raw: { simulated: true },
});

export const simulatedRefund = (externalId: string): RefundResult => ({
  status: 'SUCCEEDED',
  providerReference: `SIMREF-${externalId}`,
  failureReason: null,
  raw: { simulated: true },
});
