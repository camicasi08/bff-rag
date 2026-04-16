export function StatusStack({
  status,
  error,
}: {
  status?: string | null;
  error?: string | null;
}) {
  if (!status && !error) {
    return null;
  }

  return (
    <>
      {status ? <div className="status-banner success">{status}</div> : null}
      {error ? <div className="status-banner error">{error}</div> : null}
    </>
  );
}
