import { Timestamp } from 'firebase-admin/firestore';

/**
 * Documents that pile up (daily stats, activity items) carry `expireAt`; Firestore TTL policies
 * on that field (firestore.indexes.json, "ttl": true) delete them automatically after it.
 */
export const KEEP_DAYS = 90;
export const expireAt = (days = KEEP_DAYS, from = Date.now()) => Timestamp.fromMillis(from + days * 86_400_000);
