/** Turns Firebase Auth / Functions errors into copy a person can act on. */
export function friendlyAuthError(err: unknown): string {
  const e = err as { code?: string; message?: string; customData?: unknown };
  const raw = `${e?.message ?? ''} ${JSON.stringify(e?.customData ?? '')}`;

  // Errors thrown by the auth blocking functions carry "CODE: message".
  const blocking = raw.match(/(NOT_INVITED|DEACTIVATED|PROVIDER|UNVERIFIED|NO_EMAIL): ([^"\\}]+)/);
  if (blocking) return blocking[2].replace(/\)\.?$/, '').trim();

  switch (e?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
    case 'auth/user-disabled':
      return 'Your account has been deactivated. Contact an admin.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';
    case 'auth/email-already-in-use':
      return 'That account already exists. Use Sign in instead.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for the password.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/admin-restricted-operation':
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled.';
  }
  return e?.message?.replace(/^Firebase: /, '') || 'Something went wrong.';
}

export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'permission-denied' || e?.code === 'functions/permission-denied') {
    return e.message && !/Missing or insufficient permissions/.test(e.message) ? e.message : "You don't have permission to do that.";
  }
  return e?.message?.replace(/^Firebase: /, '') || 'Something went wrong.';
}
