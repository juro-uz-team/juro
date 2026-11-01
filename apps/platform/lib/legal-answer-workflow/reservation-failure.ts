import type { ProviderLedger } from "./provider";

/** A lost dispatched response remains charged conservatively until reconciliation. */
export async function retainFailedReservation(ledger: ProviderLedger, reservation: {
  id: string | undefined; dispatched: boolean; settled: boolean;
}): Promise<boolean> {
  if (!reservation.id || reservation.settled) return false;
  try {
    if (reservation.dispatched) await ledger.settle(reservation.id, null);
    else await ledger.cancel(reservation.id);
    return reservation.dispatched;
  } catch {
    return true;
  }
}
