export const currencies = ["GBP", "EUR", "USD"] as const;

export type Currency = (typeof currencies)[number];

export function isCurrency(value: string): value is Currency {
  return (currencies as readonly string[]).includes(value);
}

export function assertPositiveMinor(amountMinor: number, label: string): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(`${label} must be a positive integer of minor units`);
  }
}

export function runwayMonths(balanceMinor: number, burnMinor: number): number | null {
  if (!Number.isSafeInteger(balanceMinor) || !Number.isSafeInteger(burnMinor)) {
    throw new Error("Balances and burn must be integer minor units");
  }
  if (burnMinor <= 0) {
    return null;
  }
  return Math.round((balanceMinor / burnMinor) * 100) / 100;
}
