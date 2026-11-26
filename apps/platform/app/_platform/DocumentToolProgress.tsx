import "./document-tool-progress.css";
import { Check } from "lucide-react";

export function DocumentToolProgress({ title, description, steps, current, percent }: {
  title: string; description?: string; steps: readonly string[]; current: number; percent?: number;
}) {
  const fraction = Math.min(100, Math.max(0, percent ?? 0));
  return <section className="document-tool-progress">
    <header role="status" aria-atomic="true">
      <span className="document-progress-icon" aria-hidden="true"><span /></span>
      <div><strong>{title}</strong><small>{description || steps[current]}</small></div>
      <span className="document-progress-count" aria-hidden="true">{current + 1} / {steps.length}</span>
    </header>
    <div className="document-progress-track" role="progressbar" aria-label={title} aria-valuetext={description || steps[current]}
      aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={current + fraction / 100}>
      {steps.map((step, index) => <span key={step} data-state={index < current ? "done" : index === current ? "active" : undefined}>
        <span style={index === current && percent !== undefined ? { transform: `scaleX(${fraction / 100})` } : undefined} />
      </span>)}
    </div>
    <ol style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, index) => <li key={step} data-state={index < current ? "done" : index === current ? "active" : undefined}
        aria-current={index === current ? "step" : undefined}>
        <span aria-hidden="true">{index < current ? <Check /> : index + 1}</span><strong>{step}</strong>
      </li>)}
    </ol>
  </section>;
}
