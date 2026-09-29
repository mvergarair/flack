import { Navigate } from 'react-router';
import { useIsMobile } from '../lib/hooks';
import { useWorkspace } from '../data/workspace';
import { sortChannels } from '../lib/channels';
import { MobileHome } from './MobileHome';
import { EmptyState } from '../components/EmptyState';

const LAST_KEY = 'flack:lastChannel';

export function rememberChannel(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // Storage may be unavailable (private mode); not important.
  }
}

function lastChannel(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** "/" — phone: the channel list. Desktop: reopen the last channel (or #general). */
export function HomeRoute() {
  const mobile = useIsMobile();
  const { channels, channelsById } = useWorkspace();
  if (mobile) return <MobileHome />;
  const last = lastChannel();
  if (last && channelsById.has(last)) return <Navigate to={`/c/${last}`} replace />;
  const rooms = sortChannels(channels.filter((c) => c.type !== 'dm' && !c.archived));
  const target = rooms.find((c) => c.name === 'general') ?? rooms[0] ?? channels[0];
  if (target) return <Navigate to={`/c/${target.id}`} replace />;
  return <EmptyState title="No channels yet" body="Create a channel or browse existing ones from the sidebar." />;
}
