import type { ReactNode } from 'react';

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 360, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        {body && <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.5 }}>{body}</p>}
        {action}
      </div>
    </div>
  );
}
