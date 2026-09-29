import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { notifyLevel, useWorkspace } from './workspace';
import { isUnread } from '../lib/unread';
import { sidebarOrder, stepChannel, stepUnread } from '../lib/navigation';

export const FOCUS_SEARCH_EVENT = 'flack:focus-search';

/**
 * Global shortcuts:
 *   ⌘K / Ctrl+K        open Search (channels, people, messages)
 *   ⌥↑ / ⌥↓            previous / next channel (sidebar order)
 *   ⌥⇧↑ / ⌥⇧↓          previous / next unread channel
 */
export function useHotkeys() {
  const { user } = useAuth();
  const { channels, reads, prefs, manualReads } = useWorkspace();
  const navigate = useNavigate();
  useLocation(); // re-render on navigation so the handler below sees fresh data
  const state = useRef({ channels, reads, prefs, manualReads });
  state.current = { channels, reads, prefs, manualReads };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!user || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        if (window.location.pathname !== '/search') navigate('/search');
        // The page may still be mounting; ask it to focus (and select) its search box.
        setTimeout(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)), 50);
        return;
      }

      if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // Leave text editing alone while an autocomplete list is open.
        if (document.querySelector('[role="listbox"]')) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        // Read the live URL/state: presses can arrive faster than React re-renders.
        const { channels: list, reads: markers, prefs: levels, manualReads: manual } = state.current;
        const order = sidebarOrder(list);
        const current = window.location.pathname.match(/^\/c\/([^/]+)/)?.[1];
        const target = e.shiftKey ? stepUnread(order, current, dir, (c) => notifyLevel(c, levels) !== 'none' && isUnread(c, markers, user.uid, manual)) : stepChannel(order, current, dir);
        if (target) navigate(`/c/${target.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, navigate]);
}
