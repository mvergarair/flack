import { useEffect, useRef, useState } from 'react';
import { EMOJI } from '../lib/reactions';
import styles from './EmojiPicker.module.css';

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Where to open relative to the trigger's wrapper. */
  align?: 'left' | 'right';
  placement?: 'above' | 'below';
}

/** Small searchable emoji grid (a curated set; no external data). */
export function EmojiPicker({ onPick, onClose, align = 'right', placement = 'below' }: Props) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const shown = EMOJI.filter(([e, name]) => !q || name.includes(q.toLowerCase()) || e === q);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={`${styles.picker} ${styles[align]} ${styles[placement]}`} role="dialog" aria-label="Pick an emoji" data-testid="emoji-picker">
      <input className={`input ${styles.search}`} placeholder="Search emoji" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search emoji" />
      <div className={styles.grid} role="listbox" aria-label="Emoji">
        {shown.map(([e, name]) => (
          <button
            key={e}
            type="button"
            role="option"
            aria-selected={false}
            aria-label={name}
            title={name}
            className={styles.emoji}
            onClick={() => {
              onPick(e);
              onClose();
            }}
          >
            {e}
          </button>
        ))}
        {shown.length === 0 && <span className={styles.empty}>No match</span>}
      </div>
    </div>
  );
}
