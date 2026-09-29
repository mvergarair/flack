import type { UserProfile } from '../data/types';

/**
 * Flackbot: a built-in author that sends reminders and notices, welcomes people and answers
 * admin-defined phrases (firebase/functions/src/bot). It isn't a user account: the app adds
 * this profile to the people map, and its status keeps it out of every people list.
 */
export const BOT_ID = 'flackbot';

export const FLACKBOT: UserProfile = {
  id: BOT_ID,
  displayName: 'Flackbot',
  email: '',
  photoURL: null,
  title: 'Reminders, notices and answers',
  role: 'member',
  status: 'bot',
  bot: true,
};

/** Same "dm_" + sorted members id the app uses for every DM. */
export const botDmId = (uid: string) => 'dm_' + [uid, BOT_ID].sort().join('_');
