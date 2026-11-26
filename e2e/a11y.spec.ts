import { expect, test } from '@playwright/test';
import { block, blockField, field, loadDemo, openFresh } from './helpers';

for (const width of [360, 320]) {
  test(`узкий экран ${width} px: без горизонтальной прокрутки, статус проверки всегда виден`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await openFresh(page);
    await loadDemo(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const bar = page.getByTestId('mobilebar');
    await expect(bar).toBeInViewport();
    await expect(bar).toContainText('Замечаний: 2');
    await bar.getByRole('button', { name: 'Показать' }).click();
    const first = page.getByTestId('problems').locator('.link').first();
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();
    await first.click();
    const start = await blockField(page, 'Знакомство с командой', 'start');
    await expect(start).toBeFocused();
    await start.fill('14:00');
    await (await blockField(page, 'Получить пропуск', 'start')).fill('14:30');
    await expect(bar).toContainText('План готов к выгрузке');
    await bar.getByRole('button', { name: 'К выгрузке' }).click();
    await expect(page.getByTestId('download-page')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('узкий экран: высота страницы с демо уменьшилась за счёт свёрнутых подробностей', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openFresh(page);
  await loadDemo(page);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log('PAGE203', JSON.stringify({ width: 360, scrollHeight: h }));
  expect(h).toBeLessThan(9_500); // до раунда 3 было 12 783 px
  // Подробности открываются по клику, ошибка в ссылке открывает их сама.
  const it = block(page, 'Настройка ноутбука и доступов');
  await it.getByText('Место, ссылка, описание и контакты').click();
  await expect(it.getByLabel('Ссылка')).toBeVisible();
});

test('широкий экран: нижняя панель скрыта, проверка рядом с редактором', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFresh(page);
  await loadDemo(page);
  await expect(page.getByTestId('mobilebar')).toBeHidden();
  await expect(page.getByTestId('export-panel')).toBeInViewport();
});

test('замечания называют блок, клик ведёт к полю', async ({ page }) => {
  await openFresh(page);
  await loadDemo(page);
  await (await blockField(page, 'Карта офиса', 'title')).fill('');
  const problem = page.getByTestId('problems').getByRole('button', { name: 'Блок 9: Укажите название' });
  await expect(problem).toBeVisible();
  await problem.click();
  await expect(page.locator('[data-testid="block"]').nth(8).getByLabel('Название')).toBeFocused();
});

test('с клавиатуры: добавить встречу, задать время и название, увидеть результат', async ({ page }) => {
  await openFresh(page);
  await field(page, 'plan.date').fill('2026-12-01');
  await page.getByRole('button', { name: '+ Встреча' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('block').getByLabel('Название')).toBeFocused();
  await page.keyboard.type('Встреча с руководителем');
  await page.keyboard.press('Tab'); // к «Начало»
  await expect(page.getByTestId('block').getByLabel('Начало')).toBeFocused();
  await expect(page.getByTestId('check-ok')).toHaveText('Время и ссылки в порядке: 1 по времени, 0 без времени.');
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('button, summary')]
      .filter((b) => (b as HTMLElement).offsetParent)
      .map((b) => ({ t: b.textContent, h: b.getBoundingClientRect().height }))
      .filter((b) => b.h < 40 && !String(b.t).match(/^\d\d:\d\d/)),
  );
  expect(sizes).toEqual([]);
});
