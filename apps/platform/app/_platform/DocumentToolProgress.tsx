import "./document-tool-progress.css";
import { Check, LoaderCircle } from "lucide-react";

export function DocumentToolProgress({ title, description, steps, current, percent }: {
  title: string; description?: string; steps: readonly string[]; current: number; percent?: number;
}) {
  return <section className="document-tool-progress">
    <header role="status"><LoaderCircle className="spin" aria-hidden="true" /><div><strong>{title}</strong><small>{description || steps[current]}</small></div></header>
    <ol style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, index) => <li key={step} data-state={index < current ? "done" : index === current ? "active" : undefined}
        aria-current={index === current ? "step" : undefined}>
        <span>{index < current ? <Check aria-hidden="true" /> : index + 1}</span><strong>{step}</strong>
      </li>)}
    </ol>
    <progress aria-label={title} aria-valuetext={description || steps[current]} max={steps.length}
      value={current + (percent ?? 0) / 100} />
  </section>;
}
