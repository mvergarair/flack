import { useMemo, useState } from 'react';
import { useWorkspace, presenceDot } from '../data/workspace';
import { Avatar } from './Avatar';
import { CheckIcon } from './icons';
import styles from './PeoplePicker.module.css';

interface Props {
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  max?: number;
  label?: string;
}

/** Searchable multi-select of active people. */
export function PeoplePicker({ selected, onChange, exclude = [], max = 50, label = 'People' }: Props) {
  const { users, presence } = useWorkspace();
  const [q, setQ] = useState('');
  const people = useMemo(() => {
    const term = q.trim().toLowerCase();
    return [...users.values()]
      .filter((u) => u.status === 'active' && !exclude.includes(u.id))
      .filter((u) => !term || u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [users, q, exclude]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : selected.length >= max ? selected : [...selected, id]);

  return (
    <div className={styles.picker}>
      <label className="field">
        {label}
        <input className="input" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {selected.length > 0 && (
        <div className={styles.chips}>
          {selected.map((id) => (
            <button key={id} type="button" className={styles.chip} onClick={() => toggle(id)} aria-label={`Remove ${users.get(id)?.displayName}`}>
              {users.get(id)?.displayName} ×
            </button>
          ))}
        </div>
      )}
      <ul className={styles.list} role="listbox" aria-multiselectable="true">
        {people.map((u) => {
          const on = selected.includes(u.id);
          return (
            <li key={u.id} role="option" aria-selected={on}>
              <button type="button" className={styles.row} onClick={() => toggle(u.id)}>
                <Avatar user={u} size={30} online={presenceDot(presence.get(u.id))} />
                <span className={styles.name}>
                  <strong>{u.displayName}</strong>
                  <span>{u.title || u.email}</span>
                </span>
                <span className={`${styles.check} ${on ? styles.on : ''}`}>{on && <CheckIcon size={14} />}</span>
              </button>
            </li>
          );
        })}
        {people.length === 0 && <li className={styles.empty}>No matching people.</li>}
      </ul>
    </div>
  );
}
