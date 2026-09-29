import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asUser, emu, signIn, storageList, users, PNG } from '../helpers.ts';

const composer = (page: Page) => page.getByTestId('composer');
const messages = (page: Page) => page.getByTestId('message-list').getByTestId('message');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test.describe('attachments', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('pick files, send, others see previews and download through the SDK @cross', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cEngineering');

    await page.getByTestId('file-input').setInputFiles([
      { name: 'diagram.png', mimeType: 'image/png', buffer: PNG },
      { name: 'upload-limits.pdf', mimeType: 'application/pdf', buffer: PDF },
    ]);
    await expect(page.getByTestId('pending-files').getByRole('listitem')).toHaveCount(2);
    await composer(page).getByRole('textbox').fill('two files');
    await composer(page).getByRole('textbox').press('Enter');
    await expect(page.getByTestId('pending-files')).toHaveCount(0);

    const msg = messages(other.page).filter({ hasText: 'two files' });
    await expect(msg.getByTestId('attachment-image').locator('img')).toHaveAttribute('src', /^blob:/);
    await expect(msg.getByTestId('attachment-file')).toContainText('upload-limits.pdf');

    const downloading = other.page.waitForEvent('download');
    await msg.getByRole('button', { name: 'Download upload-limits.pdf' }).click();
    expect((await downloading).suggestedFilename()).toBe('upload-limits.pdf');

    const stored = emu.query<{ text: string; attachments: { storagePath: string; thumbPath: string | null; width: number }[] }>('channels/cEngineering/messages').find(
      (m) => m.text === 'two files',
    )!;
    expect(stored.attachments).toHaveLength(2);
    expect(stored.attachments[0]).toMatchObject({ width: 40 });
    expect(stored.attachments[0].thumbPath).toMatch(/thumb_diagram\.webp$/);
    const files = await storageList(stored.attachments[0].storagePath.split('/').slice(0, 3).join('/') + '/');
    expect(files.sort()).toEqual([stored.attachments[0].storagePath, stored.attachments[1].storagePath, stored.attachments[0].thumbPath].sort());

    // Opening the image shows the full-size version in a lightbox.
    await msg.getByTestId('attachment-image').click();
    await expect(other.page.getByRole('dialog', { name: 'diagram.png' }).locator('img')).toHaveAttribute('src', /^blob:/);
    await other.context.close();
  });

  test('paste an image and drop a file into the composer', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    const b64 = PNG.toString('base64');
    await composer(page).getByRole('textbox').evaluate((el, data) => {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], 'pasted.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, b64);
    await expect(page.getByTestId('pending-files')).toContainText('pasted.png');

    await composer(page).evaluate((el) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['hello'], 'dropped.txt', { type: 'text/plain' }));
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('pending-files').getByRole('listitem')).toHaveCount(2);
    await composer(page).getByRole('button', { name: 'Send' }).click();
    const msg = messages(page).last();
    await expect(msg.getByTestId('attachment-image')).toHaveCount(1);
    await expect(msg.getByTestId('attachment-file')).toContainText('dropped.txt');
  });

  test('oversized and executable files are refused before upload', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    const huge = join(test.info().outputDir, 'huge.bin');
    mkdirSync(test.info().outputDir, { recursive: true });
    writeFileSync(huge, Buffer.alloc(50 * 1024 * 1024 + 1));
    await page.getByTestId('file-input').setInputFiles(huge);
    await expect(composer(page).getByRole('alert')).toContainText('larger than 50 MB');
    await page.getByTestId('file-input').setInputFiles({ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    await expect(composer(page).getByRole('alert')).toContainText('executable');
    await expect(page.getByTestId('pending-files')).toHaveCount(0);
  });

  test('deleting a message deletes its files', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    await page.getByTestId('file-input').setInputFiles({ name: 'temp.png', mimeType: 'image/png', buffer: PNG });
    await composer(page).getByRole('button', { name: 'Send' }).click();
    const msg = messages(page).last();
    await expect(msg.getByTestId('attachment-image').locator('img')).toHaveAttribute('src', /^blob:/);
    const id = await msg.getAttribute('data-message-id');
    const prefix = `channels/cEngineering/${id}/`;
    expect((await storageList(prefix)).length).toBe(2);

    await msg.hover();
    await msg.getByRole('button', { name: 'Delete message' }).click();
    await msg.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => storageList(prefix), { timeout: 20_000 }).toEqual([]);
  });

  test('phone: attach from the + button @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    await signIn(page, users.member2, '/c/cEngineering');
    const chooser = page.waitForEvent('filechooser');
    await composer(page).getByRole('button', { name: 'Attach a file' }).click();
    await (await chooser).setFiles({ name: 'phone.png', mimeType: 'image/png', buffer: PNG });
    await composer(page).getByRole('button', { name: 'Send' }).click();
    await expect(messages(page).last().getByTestId('attachment-image')).toBeVisible();
  });
});
