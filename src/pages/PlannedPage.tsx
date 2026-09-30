interface PlannedPageProps {
  title: string;
  milestone: string;
  specSections: string;
  summary: string;
  /** What exists today that this page will build on. */
  foundation: string[];
}

/** Honest placeholder for a product area that is not implemented yet. */
export function PlannedPage({ title, milestone, specSections, summary, foundation }: PlannedPageProps) {
  return (
    <section className="planned-page" aria-labelledby="planned-title">
      <div className="page-header">
        <h2 id="planned-title">{title}</h2>
        <p className="subtitle">
          Not implemented yet · planned for {milestone} · spec {specSections}
        </p>
      </div>
      <div className="panel">
        <p>{summary}</p>
        <h3>Foundation in place</h3>
        <ul>
          {foundation.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
