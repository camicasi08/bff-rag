import Link from 'next/link';

export function LoginGate({
  title,
  copy,
}: {
  title: string;
  copy: string;
}) {
  return (
    <section className="panel login-gate">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Login required</span>
          <h2>{title}</h2>
          <p className="helper-text">{copy}</p>
        </div>
      </div>
      <Link href="/login" className="action-button">
        Go to login
      </Link>
    </section>
  );
}
