import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { Role } from './types';

const call = <I, O = { ok: true }>(name: string) => {
  const fn = httpsCallable<I, O>(functions, name);
  return async (data: I) => (await fn(data)).data;
};

export const adminApi = {
  createInvite: call<{ email: string; role: Role }, { id: string; token: string; refreshed: boolean }>('createinvite'),
  revokeInvite: call<{ inviteId: string }>('revokeinvite'),
  setRole: call<{ uid: string; role: Role }>('setrole'),
  deactivateUser: call<{ uid: string }>('deactivateuser'),
  reactivateUser: call<{ uid: string }>('reactivateuser'),
};

export const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;
