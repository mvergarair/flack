import { describe, expect, it } from 'vitest';
import { BOT_ID, DEFAULT_WELCOME, MAX_RESPONSES, botDmId, matchResponse, normalize, sanitizeConfig } from './rules.js';

describe('botDmId', () => {
  it('follows the sorted "dm_" scheme', () => {
    expect(botDmId('uAda')).toBe(`dm_${BOT_ID}_uAda`);
    expect(botDmId('abc')).toBe(`dm_abc_${BOT_ID}`);
  });
});

describe('normalize', () => {
  it('folds case, accents, punctuation and mention tokens', () => {
    expect(normalize('  ¿Cuál es la CLAVE del Wi-Fi? <@u1> ')).toBe('cual es la clave del wi fi');
  });
});

describe('sanitizeConfig', () => {
  it('falls back to the default welcome and drops bad responses', () => {
    const c = sanitizeConfig({ welcome: '  ', responses: [{ trigger: 'WiFi password!', reply: ' ask IT ' }, { trigger: '', reply: 'x' }, { trigger: 'a', reply: 3 }, null] });
    expect(c.welcome).toBe(DEFAULT_WELCOME);
    expect(c.responses).toEqual([{ trigger: 'wifi password', reply: 'ask IT' }]);
  });

  it('caps the number and size of responses', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ trigger: `t${i}`, reply: 'r'.repeat(5000) }));
    const c = sanitizeConfig({ welcome: 'w'.repeat(5000), responses: many });
    expect(c.responses).toHaveLength(MAX_RESPONSES);
    expect(c.responses[0].reply).toHaveLength(2000);
    expect(c.welcome).toHaveLength(2000);
  });

  it('handles a missing document', () => {
    expect(sanitizeConfig(undefined)).toEqual({ welcome: DEFAULT_WELCOME, responses: [] });
  });
});

describe('matchResponse', () => {
  const responses = [
    { trigger: 'wifi password', reply: 'It is on the fridge.' },
    { trigger: 'vacation', reply: 'Ask HR.' },
  ];

  it('matches whole words anywhere, ignoring case and punctuation', () => {
    expect(matchResponse("What's the WiFi password?", responses)?.reply).toBe('It is on the fridge.');
    expect(matchResponse('planning my vacation.', responses)?.reply).toBe('Ask HR.');
  });

  it('does not match inside other words', () => {
    expect(matchResponse('vacations are great', responses)).toBeNull();
    expect(matchResponse('wifipassword', responses)).toBeNull();
    expect(matchResponse('', responses)).toBeNull();
  });
});
