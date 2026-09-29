import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { presenceDot, useWorkspace } from '../data/workspace';
import { openDm } from '../lib/dm';
import { searchMessages, type SearchResult } from '../data/search';
import { channelTitle, sortChannels, sortByRecent } from '../lib/channels';
import { highlight, queryWords } from '../lib/highlight';
import { friendlyError } from '../lib/errors';
import { formatShortTime, formatTime } from '../lib/time';
import { useIsMobile } from '../lib/hooks';
import { Timestamp } from 'firebase/firestore';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { BackIcon, HashIcon, LockIcon, SearchIcon } from '../components/icons';
import styles from './SearchPage.module.css';

import { FOCUS_SEARCH_EVENT } from '../data/hotkeys';

type QuickResult = { kind: 'channel' | 'person'; id: string; label: string; sub: string; isPrivate?: boolean };

export function SearchPage() {
  const me = useMe();
  const mobile = useIsMobile();
  const { channels, channelsById, users, presence } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const inCh = params.get('in') ?? '';
  const from = params.get('from') ?? '';
  const file = params.get('file') === '1';
  const after = params.get('after') ?? '';
  const [draft, setDraft] = useState(q);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [active, setActive] = useState(-1); // highlighted channel/person result
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = q ? `“${q}” · Search · Flack` : 'Search · Flack';
  }, [q]);
  // Sync the box from the URL only when the query changed elsewhere (back/forward, a link),
  // never from our own debounced update — that would clobber letters typed meanwhile.
  const ownQ = useRef(q);
  useEffect(() => {
    if (q !== ownQ.current) setDraft(q);
    ownQ.current = q;
  }, [q]);
  useEffect(() => {
    const focus = () => {
      // Already typing here: don't select (the next keystroke would replace the text).
      if (document.activeElement === input.current) return;
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
  }, []);

  // Channels and people match instantly, locally, as you type.
  const quick = useMemo<QuickResult[]>(() => {
    const term = draft.trim().toLowerCase().replace(/^[#@]/, '');
    if (!term) return [];
    const rooms = channels
      .filter((c) => c.type !== 'dm' && !c.archived && c.name.includes(term))
      .sort((a, b) => Number(!b.name.startsWith(term)) - Number(!a.name.startsWith(term)) || a.name.localeCompare(b.name))
      .slice(0, 5)
      .map<QuickResult>((c) => ({ kind: 'channel', id: c.id, label: c.name, sub: c.topic ?? '', isPrivate: c.type === 'private' }));
    const people = [...users.values()]
      .filter((u) => u.status === 'active' && (u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 5)
      .map<QuickResult>((u) => ({ kind: 'person', id: u.id, label: u.id === me.id ? `${u.displayName} (you)` : u.displayName, sub: u.title || u.email }));
    return [...rooms, ...people];
  }, [draft, channels, users, me.id]);
  useEffect(() => setActive(-1), [draft]);

  // Messages: search automatically after a short pause (Enter searches right away).
  useEffect(() => {
    const d = draft.trim();
    if (d === q) return;
    if (!d) {
      ownQ.current = '';
      setParams((p) => (p.delete('q'), p), { replace: true });
      return;
    }
    if (!/[\p{L}\p{N}]{3,}/u.test(d)) return;
    const t = setTimeout(() => {
      ownQ.current = d;
      setParams((p) => (p.set('q', d), p), { replace: true });
    }, 450);
    return () => clearTimeout(t);
  }, [draft, q, setParams]);

  const resultHref = (r: SearchResult) => (r.threadParentId ? `/c/${r.channelId}/t/${r.threadParentId}` : `/c/${r.channelId}?m=${r.messageId}`);

  const openQuick = async (r: QuickResult) => {
    if (r.kind === 'channel') navigate(`/c/${r.id}`);
    else navigate(`/c/${await openDm(me.id, r.id === me.id ? [] : [r.id])}`);
  };

  // ↑/↓ walk one list: channels, then people, then messages. -1 = nothing highlighted.
  const total = quick.length + (results?.length ?? 0);
  useEffect(() => {
    if (active >= 0) document.getElementById(`search-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && total) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, total - 1));
    } else if (e.key === 'ArrowUp' && total) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Enter' && active >= 0 && active < total) {
      e.preventDefault();
      if (active < quick.length) void openQuick(quick[active]);
      else navigate(resultHref(results![active - quick.length]));
    } else if (e.key === 'Escape') {
      input.current?.blur();
    }
  };

  const filters = useMemo(
    () => ({
      q,
      channelId: inCh || undefined,
      authorId: from || undefined,
      hasFile: file || undefined,
      after: after ? new Date(`${after}T00:00:00`).getTime() : undefined,
    }),
    [q, inCh, from, file, after],
  );

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    let alive = true;
    setBusy(true);
    setError(null);
    searchMessages(filters)
      .then((r) => {
        if (!alive) return;
        setResults(r.results);
        setNext(r.nextBefore);
      })
      .catch((err) => {
        if (!alive) return;
        // "Only filler words" isn't an error worth shouting about while typing.
        if ((err as { code?: string }).code === 'functions/invalid-argument') setResults([]);
        else setError(friendlyError(err));
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [filters, q, nonce]);

  const set = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    setParams(p, { replace: key !== 'q' });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim() === q) setNonce((n) => n + 1); // same query → search again
    else set('q', draft.trim());
  };

  const loadMore = async () => {
    if (next == null) return;
    setBusy(true);
    try {
      const r = await searchMessages({ ...filters, before: next });
      setResults((cur) => [...(cur ?? []), ...r.results]);
      setNext(r.nextBefore);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const words = queryWords(q);
  const rooms = sortChannels(channels.filter((c) => c.type !== 'dm'));
  const dms = sortByRecent(channels.filter((c) => c.type === 'dm'));
  const people = [...users.values()].filter((u) => u.status === 'active').sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {mobile && (
          <Link to="/" className={styles.back} aria-label="Back">
            <BackIcon size={22} />
          </Link>
        )}
        <form className={styles.form} onSubmit={submit} role="search">
          <label className={styles.box}>
            <SearchIcon size={18} />
            <span className="sr-only">Search messages</span>
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search messages, channels and people"
              autoFocus
              enterKeyHint="search"
              role="combobox"
              aria-expanded={quick.length > 0}
              aria-controls="quick-results"
              aria-activedescendant={active >= 0 ? `search-opt-${active}` : undefined}
            />
          </label>
          <button className="btn btn-primary" disabled={!draft.trim()}>
            Search
          </button>
        </form>
      </header>

      <div className={styles.filters} role="group" aria-label="Filters">
        <label>
          <span className="sr-only">In</span>
          <select className={styles.select} value={inCh} onChange={(e) => set('in', e.target.value)} aria-label="In channel">
            <option value="">All conversations</option>
            <optgroup label="Channels">
              {rooms.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Direct messages">
              {dms.map((c) => (
                <option key={c.id} value={c.id}>
                  {channelTitle(c, me.id, users)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <select className={styles.select} value={from} onChange={(e) => set('from', e.target.value)} aria-label="From">
          <option value="">From anyone</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.id === me.id ? `${u.displayName} (you)` : u.displayName}
            </option>
          ))}
        </select>
        <label className={styles.check}>
          <input type="checkbox" checked={file} onChange={(e) => set('file', e.target.checked ? '1' : '')} />
          Has a file
        </label>
        <label className={styles.date}>
          After
          <input type="date" className={styles.select} value={after} onChange={(e) => set('after', e.target.value)} />
        </label>
      </div>

      <div className={styles.scroll}>
        {error && <p className="error-text" style={{ padding: '12px 20px' }}>{error}</p>}
        {quick.length > 0 && (
          <div className={styles.quick}>
            {(['channel', 'person'] as const).map((kind) => {
              const items = quick.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === kind);
              if (!items.length) return null;
              return (
                <section key={kind} aria-label={kind === 'channel' ? 'Channels' : 'People'}>
                  <h2 className={styles.h2}>{kind === 'channel' ? 'Channels' : 'People'}</h2>
                  <ul className={styles.quickList} role="listbox" id={kind === 'channel' ? 'quick-results' : undefined} data-testid={`quick-${kind}s`}>
                    {items.map(({ r, i }) => (
                      <li key={r.id} id={`search-opt-${i}`} role="option" aria-selected={i === active}>
                        <button type="button" className={`${styles.quickItem} ${i === active ? styles.quickActive : ''}`} onClick={() => openQuick(r)}>
                          <span className={styles.quickIcon}>
                            {r.kind === 'channel' ? (r.isPrivate ? <LockIcon size={16} /> : <HashIcon size={16} />) : <Avatar user={users.get(r.id)} size={24} online={presenceDot(presence.get(r.id))} />}
                          </span>
                          <strong>{r.label}</strong>
                          {r.sub && <span>{r.sub}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
        {q && <h2 className={styles.h2}>Messages</h2>}
        {!draft.trim() && !q && (
          <EmptyState title="Search Flack" body="Find channels, people, and messages or files in conversations you're part of. Press ⌘K anytime." />
        )}
        {q && results?.length === 0 && !busy && <p className={styles.none}>No messages match. Try fewer or different words, or clear the filters.</p>}
        <ul className={styles.list} data-testid="search-results" role="listbox" aria-label="Messages">
          {results?.map((r, ri) => {
            const ch = channelsById.get(r.channelId);
            const where = ch ? (ch.type === 'dm' ? channelTitle(ch, me.id, users) : `#${ch.name}`) : '';
            const href = resultHref(r);
            const idx = quick.length + ri;
            const ts = Timestamp.fromMillis(r.createdAt);
            return (
              <li key={r.messageId} id={`search-opt-${idx}`} role="option" aria-selected={idx === active}>
                <Link to={href} className={`${styles.item} ${idx === active ? styles.itemActive : ''}`}>
                  <Avatar user={users.get(r.authorId)} size={36} />
                  <span className={styles.text}>
                    <span className={styles.meta}>
                      <strong>{users.get(r.authorId)?.displayName ?? 'Unknown'}</strong>
                      <span>
                        {where}
                        {r.threadParentId ? ' · in a thread' : ''} · {formatShortTime(ts)} {formatTime(ts) && !formatShortTime(ts).includes(':') ? formatTime(ts) : ''}
                      </span>
                    </span>
                    <span className={styles.snippet}>
                      {highlight(r.snippet, words).map((seg, i) => (seg.hit ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>))}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {busy && (
          <div className={styles.center}>
            <div className="spinner" aria-label="Searching" />
          </div>
        )}
        {!busy && next != null && (results?.length ?? 0) > 0 && (
          <div className={styles.center}>
            <button className="btn" onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
