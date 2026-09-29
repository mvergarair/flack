import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState';

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      body="That page doesn't exist, or you don't have access to it."
      action={
        <Link className="btn" to="/">
          Go home
        </Link>
      }
    />
  );
}
