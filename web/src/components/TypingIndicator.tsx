import { useWorkspace } from '../data/workspace';
import { useTypingUsers } from '../data/typing';

/** `status` replaces the typing line (Flackbot's progress in its DM). */
export function TypingIndicator({ channelId, testId = 'typing', status }: { channelId: string | null; testId?: string; status?: string | null }) {
  const { users } = useWorkspace();
  const ids = useTypingUsers(channelId);
  const names = ids.map((id) => users.get(id)?.displayName ?? 'Someone');
  const text = status
    ? status
    : names.length === 0
      ? ''
      : names.length === 1
        ? `${names[0]} is typing…`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing…`
          : 'Several people are typing…';
  // Takes no space: it floats over the bottom edge of the messages, just above the composer,
  // only while someone is typing (so there's no empty strip the rest of the time).
  return (
    <div style={{ position: 'relative', height: 0, flexShrink: 0 }}>
      <div
        aria-live="polite"
        data-testid={testId}
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 2,
          padding: text ? '1px 8px' : 0,
          fontSize: 12,
          lineHeight: '18px',
          color: 'var(--muted)',
          background: text ? 'var(--bg)' : 'transparent',
          borderRadius: 6,
          width: 'fit-content',
          maxWidth: 'calc(100% - 32px)',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>
    </div>
  );
}
