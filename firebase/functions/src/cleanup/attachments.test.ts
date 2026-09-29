import { describe, expect, it } from 'vitest';
import { ownsPath } from './attachments.js';

describe('ownsPath', () => {
  const folder = 'channels/c1/m1/';
  it('accepts files directly in the message folder', () => {
    expect(ownsPath(folder, 'channels/c1/m1/report.pdf')).toBe(true);
    expect(ownsPath(folder, 'channels/c1/m1/thumb_photo.webp')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(ownsPath(folder, 'channels/c2/m9/secret.pdf')).toBe(false);
    expect(ownsPath(folder, 'channels/c1/m10/x.pdf')).toBe(false);
    expect(ownsPath(folder, 'channels/c1/m1/../../c2/m9/x.pdf')).toBe(false);
    expect(ownsPath(folder, 'channels/c1/m1/sub/x.pdf')).toBe(false);
    expect(ownsPath(folder, 'channels/c1/m1/')).toBe(false);
  });
});
