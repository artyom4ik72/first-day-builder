import { expect, test, type Page } from '@playwright/test';
import { blockField, field, HEADING, loadDemo, openFresh, waitSaved } from './helpers';

test('перезагрузка сразу после правки, до записи в IndexedDB, не теряет ввод', async ({ page }) => {
  await openFresh(page);
  await loadDemo(page);
  await waitSaved(page);
  await (await blockField(page, 'Настройка ноутбука и доступов', 'start')).fill('13:00');
  await page.reload(); // дебаунс 300 мс ещё не истёк: правку сохраняет резервная копия на pagehide
  await expect(await blockField(page, 'Настройка ноутбука и доступов', 'start')).toHaveValue('13:00');
  await expect(page.getByTestId('check-ok')).toBeVisible();
  await waitSaved(page);
  expect(await page.evaluate(() => localStorage.getItem('fdb.v1.unsaved'))).toBeNull();
});

test('медленная IndexedDB: ввод до окончания загрузки не затирается сохранённым черновиком', async ({ page }) => {
  await openFresh(page);
  await loadDemo(page);
  await waitSaved(page);
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
      const req = open(...args);
      const orig = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
      let handler: ((e: Event) => void) | null = null;
      Object.defineProperty(req, 'onsuccess', {
        configurable: true,
        get: () => handler,
        set: (h) => {
          handler = h;
          orig.set!.call(req, (e: Event) => setTimeout(() => h?.call(req, e), 1500));
        },
      });
      return req;
    }) as IDBFactory['open'];
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  const title = field(page, 'plan.title');
  // Пока черновик не прочитан, поля недоступны: ввод не может потеряться.
  await expect(title).toBeDisabled();
  await expect(page.getByTestId('save-state')).toHaveText('Загрузка черновика…');
  await expect(page.getByRole('button', { name: 'Загрузить демоплан' })).toBeDisabled();
  await expect(title).toBeEnabled({ timeout: 5000 });
  await expect(title).toHaveValue('Первый день в команде аналитики');
  await title.fill('Выезд в марте');
  await waitSaved(page);
  await page.reload();
  await expect(title).toHaveValue('Выезд в марте', { timeout: 5000 });
});

test('IndexedDB недоступна: приложение работает и предлагает сохранить в файл', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = (() => {
      throw new DOMException('denied', 'SecurityError');
    }) as IDBFactory['open'];
  });
  await page.goto('./');
  await expect(page.getByTestId('save-state')).toHaveText('Хранилище браузера недоступно: сохраните план в файл');
  await page.getByRole('button', { name: 'Загрузить демоплан' }).click();
  await page.getByRole('button', { name: 'Загрузить демоплан' }).click();
  await expect(page.getByTestId('block')).toHaveCount(10); // повторное нажатие заменяет, а не добавляет
  await (await blockField(page, 'Настройка ноутбука и доступов', 'start')).fill('13:00');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать страницу для новичка' }).click()]);
  expect(download.suggestedFilename()).toBe('first-day-2026-11-23.html');
});

/** Запись в IndexedDB «из третьей вкладки», чьё оповещение не дошло: так проверяется именно конфликт ревизий. */
async function writeFromElsewhere(page: Page, title: string) {
  await page.evaluate(async (t) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('first-day-builder', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('drafts', 'readwrite');
      const st = tx.objectStore('drafts');
      const g = st.get('current');
      g.onsuccess = () => st.put({ rev: g.result.rev + 1, draft: { ...g.result.draft, title: t } }, 'current');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, title);
}

test('две вкладки: свежая версия подхватывается, одновременная правка даёт выбор вместо молчаливой перезаписи', async ({ page, context }) => {
  await openFresh(page);
  await loadDemo(page);
  await waitSaved(page);
  const b = await context.newPage();
  await b.goto('./');
  await expect(b.getByTestId('block')).toHaveCount(10);

  // A сохраняет, B без своих правок обновляется сама.
  await field(page, 'plan.newcomer').fill('Пётр');
  await waitSaved(page);
  await expect(field(b, 'plan.newcomer')).toHaveValue('Пётр');
  await expect(b.getByTestId('notice')).toHaveText('План обновлён из другой вкладки');

  // Кто-то записал новую ревизию, B об этом не знает и правит своё.
  await writeFromElsewhere(page, 'Версия из другой вкладки');
  await field(b, 'plan.title').fill('Версия вкладки B');
  await expect(b.getByTestId('conflict')).toBeVisible();
  await expect(field(b, 'plan.title')).toHaveValue('Версия вкладки B');
  await b.getByRole('button', { name: 'Оставить мою' }).click();
  await expect(b.getByTestId('conflict')).toHaveCount(0);
  await waitSaved(b);
  await page.reload();
  await expect(field(page, 'plan.title')).toHaveValue('Версия вкладки B');

  // Второй конфликт: выбираем чужую версию.
  await writeFromElsewhere(page, 'Ещё одна версия');
  await field(b, 'plan.title').fill('Снова B');
  await b.getByRole('button', { name: 'Взять версию из другой вкладки' }).click();
  await expect(field(b, 'plan.title')).toHaveValue('Ещё одна версия');
  await expect(b.getByTestId('save-state')).toHaveText('Черновик сохранён в этом браузере');
});

test('правка во время конфликта не теряется: «Оставить мою» сохраняет последнюю версию', async ({ page, context }) => {
  await openFresh(page);
  await loadDemo(page);
  await waitSaved(page);
  const b = await context.newPage();
  await b.goto('./');
  await expect(b.getByTestId('block')).toHaveCount(10);
  await writeFromElsewhere(page, 'Чужая версия');
  await field(b, 'plan.title').fill('Моя версия');
  await expect(b.getByTestId('conflict')).toBeVisible();
  // Пользователь продолжает печатать, пока висит выбор.
  await field(b, 'plan.newcomer').fill('Ольга');
  await b.getByRole('button', { name: 'Оставить мою' }).click();
  await waitSaved(b);
  await page.reload();
  await expect(field(page, 'plan.title')).toHaveValue('Моя версия');
  await expect(field(page, 'plan.newcomer')).toHaveValue('Ольга');
});

test('снять и вернуть время: блок возвращается на прежнее время, а не на 09:00', async ({ page }) => {
  await openFresh(page);
  await loadDemo(page);
  const course = 'Пройти вводный курс по безопасности';
  await expect(await blockField(page, course, 'start')).toHaveValue('15:00');
  const untimed = page.locator(`[data-testid="block"][data-title="${course}"]`).getByLabel('Без времени');
  await untimed.check();
  await untimed.uncheck();
  await expect(await blockField(page, course, 'start')).toHaveValue('15:00');
  await expect(await blockField(page, course, 'duration')).toHaveValue('60');
  // То же при смене типа: встреча → материал → встреча.
  const kind = await blockField(page, 'Итоги дня', 'kind');
  await kind.selectOption('material');
  await kind.selectOption('meeting');
  await expect(await blockField(page, 'Итоги дня', 'start')).toHaveValue('16:30');
  await expect(await blockField(page, 'Итоги дня', 'duration')).toHaveValue('30');
});
