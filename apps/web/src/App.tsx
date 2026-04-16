import { APP_NAME, SCAFFOLD_STATUS } from "./appConfig";

const settingsPreview = {
  idealCommuteMinutes: 20,
  maxMonthlyRent: 3600
};

export function App() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">{SCAFFOLD_STATUS}</p>
        <h1>{APP_NAME}</h1>
        <p>
          Shared scaffold is ready for sub-agents. Product implementation begins after the
          package boundaries are connected.
        </p>
        <dl>
          <div>
            <dt>Budget cap</dt>
            <dd>${settingsPreview.maxMonthlyRent.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Ideal commute</dt>
            <dd>{settingsPreview.idealCommuteMinutes} min</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
