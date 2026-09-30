import { describe, expect, it } from 'vitest';
import { BOT_ID, FLACKBOT, botDmId } from './bot';
import { dmId } from './channels';

describe('Flackbot', () => {
  it("its DM id is the app's usual DM id (and the functions')", () => {
    expect(botDmId('uMember')).toBe(dmId(['uMember', BOT_ID]));
    expect(botDmId('uMember')).toBe('dm_flackbot_uMember');
    expect(botDmId('abc')).toBe('dm_abc_flackbot');
  });

  it('is never an active person (people lists filter on status)', () => {
    expect(FLACKBOT.status).toBe('bot');
    expect(FLACKBOT.bot).toBe(true);
  });
});
