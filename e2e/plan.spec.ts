import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { block, blockField, field, loadDemo, openFresh, saveAscii, waitSaved } from './helpers';

test.beforeEach(async ({ page }) => openFresh(page));

test('приёмка ТЗ: пересечения подсвечены, после переноса встречи страница открывается отдельно', async ({ page, context }) => {
  await loadDemo(page);
  // Длинная встреча 10:00–12:00 и два вложенных блока подсвечены, смежный обед в 12:00 — нет.
  for (const t of ['Настройка ноутбука и доступов', 'Знакомство с командой', 'Получить пропуск'])
    await expect(block(page, t)).toHaveClass(/block--conflict/);
  await expect(block(page, 'Обед с командой')).not.toHaveClass(/block--conflict/);
  await expect(block(page, 'Получить пропуск').getByTestId('block-conflicts')).toHaveText(
    '«Настройка ноутбука и доступов» (10:00–12:00) пересекается с «Получить пропуск» (11:15–11:45) на 30 мин',
  );
  await expect(page.getByTestId('timeline-item').filter({ hasText: 'Получить пропуск' })).toHaveAttribute('data-conflict', 'true');
  await expect(page.getByTestId('problems')).toContainText('Перед выгрузкой исправьте: 2 замечания.');
  await expect(page.getByRole('button', { name: 'Скачать страницу для новичка' })).toHaveCount(0);

  // Переносим длинную встречу на свободное время.
  await (await blockField(page, 'Настройка ноутбука и доступов', 'start')).fill('13:00');
  await expect(page.getByTestId('check-ok')).toHaveText('Время и ссылки в порядке: 7 по времени, 3 без времени.');
  await expect(page.locator('.block--conflict')).toHaveCount(0);
  const preview = page.frameLocator('[data-testid="preview"]');
  await expect(preview.locator('.title')).toHaveText([
    'Знакомство с наставником',
    'Знакомство с командой',
    'Получить пропуск',
    'Обед с командой',
    'Настройка ноутбука и доступов',
    'Пройти вводный курс по безопасности',
    'Итоги дня',
    'Справочник новичка',
    'Карта офиса',
    'Заполнить профиль в корпоративном мессенджере',
  ]);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать страницу для новичка' }).click()]);
  expect(download.suggestedFilename()).toBe('first-day-2026-11-23.html');
  const path = await saveAscii(download, 'first-day.html');
  const html = await readFile(path, 'utf8');
  expect(html).not.toMatch(/<script/i);
  // Предпросмотр и файл — одна и та же страница.
  expect(await page.getByTestId('preview').getAttribute('srcdoc')).toBe(html);

  // Отдельное открытие файла, без редактора и сети.
  const standalone = await context.newPage();
  const requests: string[] = [];
  standalone.on('request', (r) => requests.push(r.url()));
  await standalone.goto(`file://${path}`);
  await expect(standalone.getByRole('heading', { level: 1 })).toHaveText('Первый день в команде аналитики: Мария');
  await expect(standalone.locator('.date')).toHaveText('понедельник, 23 ноября 2026');
  await expect(standalone.locator('.timeline .time')).toHaveText(['09:30–10:00', '10:30–11:00', '11:15–11:45', '12:00–13:00', '13:00–15:00', '15:00–16:00', '16:30–17:00']);
  const it = standalone.locator('.item').filter({ hasText: 'Настройка ноутбука' });
  await expect(it).toContainText('Возьмите <b>паспорт</b> и телефон');
  await expect(it.locator('b')).toHaveCount(0);
  await expect(it).toContainText('С кем: Илья Петров (ИТ-поддержка)');
  await expect(standalone.locator('.untimed .title')).toHaveText(['Справочник новичка', 'Карта офиса', 'Заполнить профиль в корпоративном мессенджере']);
  await expect(standalone.getByRole('link', { name: 'example.com/office-map' })).toHaveAttribute('href', 'https://example.com/office-map');
  await expect(standalone.locator('.people li')).toHaveCount(3);
  expect(requests.filter((u) => !u.startsWith('file:'))).toEqual([]);

  await waitSaved(page);
  await page.reload();
  await expect(await blockField(page, 'Настройка ноутбука и доступов', 'start')).toHaveValue('13:00');
  await expect(page.getByTestId('check-ok')).toBeVisible();
});

test('два пересекающихся блока подсвечиваются, смежные — нет', async ({ page }) => {
  await field(page, 'plan.date').fill('2026-12-01');
  await page.getByRole('button', { name: '+ Встреча' }).click();
  await expect(page.getByTestId('block').first().getByLabel('Название')).toBeFocused();
  await page.keyboard.type('Планёрка');
  await page.getByRole('button', { name: '+ Встреча' }).click();
  await page.keyboard.type('Демо продукта');
  // Новый блок встаёт после конца предыдущего: смежно, без конфликта.
  await expect(await blockField(page, 'Демо продукта', 'start')).toHaveValue('09:30');
  await expect(page.locator('.block--conflict')).toHaveCount(0);
  await expect(page.getByTestId('check-ok')).toBeVisible();
  await (await blockField(page, 'Демо продукта', 'start')).fill('09:15');
  await expect(page.locator('.block--conflict')).toHaveCount(2);
  await page.getByRole('button', { name: /пересекается с «Демо продукта»/ }).click();
  await expect(await blockField(page, 'Демо продукта', 'start')).toBeFocused();
  await block(page, 'Демо продукта').getByRole('button', { name: 'Позже на 15 мин' }).click();
  await expect(page.locator('.block--conflict')).toHaveCount(0);
});

test('ссылки: только http/https, адрес без схемы дополняется', async ({ page }) => {
  await loadDemo(page);
  const link = await blockField(page, 'Справочник новичка', 'link');
  await link.fill('javascript:alert(1)');
  await expect(block(page, 'Справочник новичка').locator('.field__error')).toHaveText('Ссылка должна начинаться с http:// или https://');
  await expect(link).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('problems')).toContainText('Ссылка должна начинаться с http:// или https://');
  await link.fill('wiki.example.com/start');
  await (await blockField(page, 'Настройка ноутбука и доступов', 'start')).fill('13:00');
  await expect(page.frameLocator('[data-testid="preview"]').getByRole('link', { name: 'wiki.example.com/start' })).toHaveAttribute(
    'href',
    'https://wiki.example.com/start',
  );
});

test('HTML в названии и описании показывается текстом и в предпросмотре', async ({ page }) => {
  await loadDemo(page);
  await (await blockField(page, 'Настройка ноутбука и доступов', 'start')).fill('13:00');
  await (await blockField(page, 'Итоги дня', 'title')).fill('<img src=x onerror="document.title=1">Итоги');
  const preview = page.frameLocator('[data-testid="preview"]');
  await expect(preview.locator('.title').filter({ hasText: 'Итоги' })).toHaveText('<img src=x onerror="document.title=1">Итоги');
  await expect(preview.locator('img')).toHaveCount(0);
});

test('материалы и задачи без времени — отдельный раздел, порядок меняется стрелками', async ({ page }) => {
  await loadDemo(page);
  await (await blockField(page, 'Настройка ноутбука и доступов', 'start')).fill('13:00');
  await block(page, 'Карта офиса').getByRole('button', { name: 'Переместить «Карта офиса» выше' }).click();
  await expect(block(page, 'Карта офиса').getByRole('button', { name: 'Переместить «Карта офиса» выше' })).toBeFocused();
  await expect(page.frameLocator('[data-testid="preview"]').locator('.untimed .title')).toHaveText([
    'Карта офиса',
    'Справочник новичка',
    'Заполнить профиль в корпоративном мессенджере',
  ]);
  // Задачу можно снять со шкалы.
  await block(page, 'Пройти вводный курс по безопасности').getByLabel('Без времени').check();
  await expect(page.frameLocator('[data-testid="preview"]').locator('.untimed .title')).toHaveCount(4);
});

test('контакты: ошибки у полей, удаление снимает контакт с блоков и возвращается', async ({ page }) => {
  await loadDemo(page);
  await (await blockField(page, 'Настройка ноутбука и доступов', 'start')).fill('13:00');
  await page.getByTestId('add-contact').click();
  const c = page.getByTestId('contact').last();
  await expect(c.getByLabel('Имя')).toBeFocused();
  await c.getByLabel('Почта').fill('кто-то');
  await expect(c.locator('.field__error')).toHaveText(['Укажите имя контакта', 'Почта в формате name@example.com']);
  await c.getByRole('button', { name: /Удалить контакт/ }).click();
  await page.getByTestId('contact').filter({ has: page.locator('input[value="Илья Петров"]') }).getByRole('button', { name: /Удалить/ }).click();
  await expect(page.frameLocator('[data-testid="preview"]').locator('.people li')).toHaveCount(2);
  await expect(page.frameLocator('[data-testid="preview"]').getByText('С кем: Илья Петров')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(page.frameLocator('[data-testid="preview"]').locator('.people li')).toHaveCount(3);
});

test('черновик в файл и обратно, повреждённый файл не ломает план', async ({ page }) => {
  await loadDemo(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить черновик в файл' }).click()]);
  expect(download.suggestedFilename()).toBe('first-day-2026-11-23.plan.json');
  const bytes = await readFile(await saveAscii(download, 'plan.json'));
  await page.getByRole('button', { name: 'Новый план' }).click();
  await expect(page.getByTestId('block')).toHaveCount(0);
  await page.getByTestId('import-input').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByTestId('block')).toHaveCount(10);
  await page.getByTestId('import-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"other"}') });
  await expect(page.getByTestId('notice')).toHaveText('Не удалось открыть «bad.json»: Это файл другого формата (other)');
  await expect(page.getByTestId('block')).toHaveCount(10);
});
