const AUTH_EXAMPLE = `{
  "user_id": "00000000-0000-0000-0000-000000000001",
  "tenant_id": "default",
  "roles": ["user", "admin"]
}`;

const ADMIN_INGEST_EXAMPLE = `{
  "query": "mutation AdminIngest($input: AdminIngestInput!) { adminIngest(input: $input) { job_id status } }",
  "variables": {
    "input": {
      "source": "manual-upload",
      "documents": [
        {
          "title": "Payment Terms",
          "content": "Invoices are due within 30 days.",
          "category": "billing",
          "metadata_json": "{\\"region\\":\\"global\\"}"
        }
      ],
      "files": [
        {
          "filename": "policy.md",
          "title": "Policy",
          "category": "billing",
          "content_type": "text/markdown",
          "metadata_json": "{\\"origin\\":\\"upload\\"}",
          "content_base64": "IyBQb2xpY3kKSW52b2ljZXMgYXJlIGR1ZSB3aXRoaW4gMzAgZGF5cy4="
        }
      ]
    }
  }
}`;

const ASK_EXAMPLE = `{
  "query": "{ ask(query: \\"payment terms\\", filters: { source: \\"manual-upload\\", category: \\"billing\\", title_contains: \\"Payment Terms\\" }) { answer cache_hit chunks_used history_used citations { title source chunk_index excerpt } } }"
}`;

const ADMIN_CHUNKS_EXAMPLE = `{
  "query": "{ adminChunks(limit: 5, filters: { source: \\"manual-upload\\", category: \\"billing\\", title_contains: \\"Payment Terms\\" }) { source title category excerpt content_hash } }"
}`;

const ADMIN_OVERVIEW_EXAMPLE = `{
  "query": "{ adminOverview { cached_entries total_chunks total_conversations metrics { total_queries cache_hits skipped_duplicates } } }"
}`;

const HISTORY_EXAMPLE = `{
  "query": "{ conversationHistory(limit: 10) { role content created_at } }"
}`;

export function renderGraphqlDocsPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Interactive API Docs</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --panel: #fffaf0;
      --line: #d7cdbb;
      --ink: #202020;
      --muted: #635a49;
      --accent: #8a4b2a;
      --accent-soft: #f0dfcf;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(138, 75, 42, 0.16), transparent 26%),
        linear-gradient(180deg, #fbf7ef 0%, var(--bg) 100%);
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 20px 72px;
    }
    .hero {
      display: grid;
      gap: 16px;
      margin-bottom: 28px;
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: rgba(255, 250, 240, 0.92);
      box-shadow: 0 24px 60px rgba(70, 48, 29, 0.08);
    }
    .eyebrow {
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
    }
    h1, h2, h3 {
      margin: 0;
      font-weight: 600;
      line-height: 1.1;
    }
    h1 { font-size: clamp(2.2rem, 4vw, 3.8rem); }
    h2 { font-size: 1.5rem; margin-bottom: 12px; }
    h3 { font-size: 1.05rem; margin-bottom: 10px; }
    p, li {
      color: var(--muted);
      line-height: 1.6;
      font-size: 0.98rem;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .hero-actions a {
      text-decoration: none;
      color: var(--ink);
      padding: 10px 16px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: white;
    }
    .hero-actions a.primary {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 18px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 20px;
      background: var(--panel);
      padding: 20px;
      box-shadow: 0 18px 32px rgba(78, 56, 32, 0.06);
    }
    .steps ol {
      margin: 0;
      padding-left: 18px;
    }
    .hint {
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--accent-soft);
      color: #4f3622;
      font-size: 0.94rem;
      margin-top: 12px;
    }
    .example {
      margin-top: 14px;
    }
    .example-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .example button {
      border: 1px solid var(--line);
      background: white;
      color: var(--ink);
      border-radius: 999px;
      padding: 8px 12px;
      cursor: pointer;
    }
    pre {
      margin: 0;
      padding: 14px;
      border-radius: 16px;
      overflow-x: auto;
      background: #1f1a17;
      color: #f5eee4;
      font-size: 0.88rem;
      line-height: 1.45;
    }
    code.inline {
      background: rgba(32, 32, 32, 0.08);
      padding: 2px 6px;
      border-radius: 6px;
    }
    .section {
      margin-top: 24px;
    }
    @media (max-width: 640px) {
      main { padding: 24px 14px 40px; }
      .hero { padding: 22px; }
      .card { padding: 16px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="eyebrow">Interactive API Docs</div>
      <h1>Test the BFF from your browser.</h1>
      <p>Use Swagger for the REST endpoints, then follow this guide for the GraphQL workflows that power ingest, retrieval, history, and admin visibility.</p>
      <div class="hero-actions">
        <a class="primary" href="/docs">Open Swagger UI</a>
        <a href="/graphql">Open GraphQL Playground</a>
      </div>
      <div class="hint">Local development tip: in <code class="inline">NODE_ENV=development</code>, GraphQL calls can use the existing dev auth fallback. For Swagger REST testing, issue a token first via <code class="inline">POST /auth/token</code>.</div>
    </section>

    <section class="grid section">
      <article class="card steps">
        <h2>Quick Test Flow</h2>
        <ol>
          <li>Open Swagger at <code class="inline">/docs</code> and issue a JWT with <code class="inline">POST /auth/token</code>.</li>
          <li>Run the GraphQL <code class="inline">adminIngest</code> mutation to queue documents and files.</li>
          <li>Poll the ingest job status at <code class="inline">GET /admin/ingest/jobs/{job_id}</code> on the Python service or via existing tooling.</li>
          <li>Run <code class="inline">ask</code> with matching filters and inspect citations, cache hits, and chunks used.</li>
          <li>Use <code class="inline">adminChunks</code>, <code class="inline">adminOverview</code>, and <code class="inline">conversationHistory</code> to verify the stored data and query trail.</li>
        </ol>
      </article>
      <article class="card">
        <h2>File Ingest Notes</h2>
        <p>Supported file types are <code class="inline">.txt</code>, <code class="inline">.md</code>, and <code class="inline">.pdf</code>.</p>
        <p>The GraphQL boundary uses <code class="inline">metadata_json</code> strings. The BFF parses these into JSON objects before forwarding the request to <code class="inline">rag-service</code>.</p>
        <div class="hint">Generate base64 in PowerShell with <code class="inline">[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\\policy.md"))</code>.</div>
      </article>
    </section>

    <section class="section grid">
      <article class="card">
        <h3>Issue Token Payload</h3>
        <div class="example">
          <div class="example-header">
            <span>POST /auth/token body</span>
            <button type="button" onclick="copySnippet('auth-example')">Copy</button>
          </div>
          <pre id="auth-example">${escapeHtml(AUTH_EXAMPLE)}</pre>
        </div>
      </article>
      <article class="card">
        <h3>GraphQL adminIngest</h3>
        <div class="example">
          <div class="example-header">
            <span>Queue files and inline documents</span>
            <button type="button" onclick="copySnippet('ingest-example')">Copy</button>
          </div>
          <pre id="ingest-example">${escapeHtml(ADMIN_INGEST_EXAMPLE)}</pre>
        </div>
      </article>
      <article class="card">
        <h3>GraphQL ask</h3>
        <div class="example">
          <div class="example-header">
            <span>Ask with filters</span>
            <button type="button" onclick="copySnippet('ask-example')">Copy</button>
          </div>
          <pre id="ask-example">${escapeHtml(ASK_EXAMPLE)}</pre>
        </div>
      </article>
      <article class="card">
        <h3>GraphQL adminChunks</h3>
        <div class="example">
          <div class="example-header">
            <span>Inspect stored chunks</span>
            <button type="button" onclick="copySnippet('chunks-example')">Copy</button>
          </div>
          <pre id="chunks-example">${escapeHtml(ADMIN_CHUNKS_EXAMPLE)}</pre>
        </div>
      </article>
      <article class="card">
        <h3>GraphQL adminOverview</h3>
        <div class="example">
          <div class="example-header">
            <span>Inspect metrics and counts</span>
            <button type="button" onclick="copySnippet('overview-example')">Copy</button>
          </div>
          <pre id="overview-example">${escapeHtml(ADMIN_OVERVIEW_EXAMPLE)}</pre>
        </div>
      </article>
      <article class="card">
        <h3>GraphQL conversationHistory</h3>
        <div class="example">
          <div class="example-header">
            <span>Review recent turns</span>
            <button type="button" onclick="copySnippet('history-example')">Copy</button>
          </div>
          <pre id="history-example">${escapeHtml(HISTORY_EXAMPLE)}</pre>
        </div>
      </article>
    </section>
  </main>
  <script>
    async function copySnippet(id) {
      const element = document.getElementById(id);
      if (!element) return;
      await navigator.clipboard.writeText(element.textContent || '');
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
