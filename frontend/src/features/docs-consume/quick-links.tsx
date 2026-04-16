export function QuickLinks() {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>Reference Surface</h3>
          <p className="helper-text">
            Keep the interactive API docs close while you validate the UI against the backend.
          </p>
        </div>
      </div>
      <div className="list">
        <a className="list-item" href="http://localhost:3000/docs" target="_blank" rel="noreferrer">
          <strong>REST Swagger</strong>
          <span className="helper-text">Issue tokens and inspect the stream endpoint contract.</span>
        </a>
        <a className="list-item" href="http://localhost:3000/docs/graphql-guide" target="_blank" rel="noreferrer">
          <strong>GraphQL Guide</strong>
          <span className="helper-text">Mutation and query examples for admin ingest and ask flows.</span>
        </a>
      </div>
    </section>
  );
}
