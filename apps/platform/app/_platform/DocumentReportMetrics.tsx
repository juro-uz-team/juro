import "./document-report.css";

export type DocumentReportMetric = {
  label: string;
  value: string | number;
  tone?: "risk" | "success" | "time" | "sources";
};

export function DocumentReportMetrics({ metrics }: { metrics: DocumentReportMetric[] }) {
  return <dl className="document-report-metrics" data-count={metrics.length}>{metrics.map(({ label, value, tone }) =>
    <div key={label} data-tone={value ? tone : undefined}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
