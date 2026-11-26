import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Download, type Page } from '@playwright/test';

export const HEADING = 'Конструктор первого рабочего дня';

export async function openFresh(page: Page): Promise<void> {
  await page.goto('./');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase('first-day-builder');
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('Черновик сохранён в этом браузере');
}

export async function loadDemo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Загрузить демоплан' }).click();
  await expect(page.getByTestId('block')).toHaveCount(10);
}

export const block = (page: Page, title: string) => page.locator(`[data-testid="block"][data-title="${title}"]`);
export const field = (page: Page, key: string) => page.locator(`[data-field="${key}"]`);

export async function blockField(page: Page, title: string, name: string) {
  const id = await block(page, title).getAttribute('data-block-id');
  return field(page, `block.${id}.${name}`);
}

/** Сохраняет скачанный файл в ASCII-путь: путь в test-results содержит кириллицу из названия теста,
 *  а Chromium при локали POSIX такой путь не открывает (к приложению это не относится). */
export async function saveAscii(download: Download, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fdb-e2e-'));
  const path = join(dir, name);
  await download.saveAs(path);
  return path;
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toHaveText('Черновик сохранён в этом браузере');
  await page.waitForTimeout(450);
  await expect(page.getByTestId('save-state')).toHaveText('Черновик сохранён в этом браузере');
}
