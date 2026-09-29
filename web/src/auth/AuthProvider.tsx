import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signOut, type User } from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { listenDoc } from '../lib/snapshot';
import { consumeManualSignOut } from './signin';
import type { Role, UserProfile } from '../data/types';

interface AuthState {
  /** undefined while resolving the initial auth state. */
  user: User | null | undefined;
  profile: UserProfile | null;
  claims: { role?: Role; active?: boolean };
  isAdmin: boolean;
  /** Set when the session was ended by the server (e.g. deactivated). */
  endedReason: string | null;
}

const AuthContext = createContext<AuthState>({
  user: undefined,
  profile: null,
  claims: {},
  isAdmin: false,
  endedReason: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [claims, setClaims] = useState<AuthState['claims']>({});
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const claimsRef = useRef(claims);
  claimsRef.current = claims;

  useEffect(() => {
    let prevUid: string | null = null;
    return onIdTokenChanged(auth, async (u) => {
      if (u) {
        const res = await u.getIdTokenResult();
        setClaims({ role: res.claims.role as Role | undefined, active: res.claims.active as boolean | undefined });
        setEndedReason(null);
      } else {
        setClaims({});
        setProfile(null);
        // Signed out without asking (token revoked / account disabled): say why.
        if (prevUid && !consumeManualSignOut()) {
          setEndedReason((r) => r ?? 'Your session has ended. If your account was deactivated, contact an admin.');
        }
      }
      prevUid = u?.uid ?? null;
      setUser(u);
    });
  }, []);

  // Live profile. Role changes refresh the token so rules see the new claim; deactivation
  // signs the user out immediately.
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    return listenDoc(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists()) return;
        const p = { id: snap.id, ...snap.data() } as UserProfile;
        if (p.status !== 'active') {
          setEndedReason('Your account has been deactivated. Contact an admin.');
          void signOut(auth);
          return;
        }
        setProfile(p);
        if (p.role !== claimsRef.current.role && auth.currentUser) {
          void auth.currentUser.getIdToken(true);
        }
      },
      (err) => {
        // Rules deny reads once deactivated (and token refresh fails once disabled); after
        // listenDoc's retries this is a real lock-out, so end the session.
        if (err.code === 'permission-denied') {
          setEndedReason('Your session has ended. Sign in again.');
          void signOut(auth);
        }
      },
    );
  }, [uid]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      claims,
      isAdmin: claims.role === 'admin' && profile?.role === 'admin',
      endedReason,
    }),
    [user, profile, claims, endedReason],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** The signed-in user's profile; only use under <RequireAuth>. */
export function useMe(): UserProfile {
  const { profile } = useAuth();
  if (!profile) throw new Error('useMe() outside of a signed-in route');
  return profile;
}
