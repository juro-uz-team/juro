import { database } from "../storage/connection";

export const operationalMetrics = {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void {
    void database().pool.query("INSERT INTO storage.operational_metrics(indexes,labels,values) VALUES($1,$2,$3)",
      [point.indexes ?? [], point.blobs ?? [], point.doubles ?? []])
      .catch(() => console.error("Operational metric could not be persisted"));
  },
};
