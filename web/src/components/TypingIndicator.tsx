import { useWorkspace } from '../data/workspace';
import { useTypingUsers } from '../data/typing';

export function TypingIndicator({ channelId, testId = 'typing' }: { channelId: string | null; testId?: string }) {
  const { users } = useWorkspace();
  const ids = useTypingUsers(channelId);
  const names = ids.map((id) => users.get(id)?.displayName ?? 'Someone');
  const text =
    names.length === 0
      ? ''
      : names.length === 1
        ? `${names[0]} is typing…`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing…`
          : 'Several people are typing…';
  return (
    <div
      aria-live="polite"
      data-testid={testId}
      style={{ height: 20, padding: '0 24px', fontSize: 12, color: 'var(--muted)', flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
    >
      {text}
    </div>
  );
}
