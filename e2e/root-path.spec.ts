import { expect, test } from '@playwright/test';

// Та же сборка из корня сервера: относительные пути должны работать в обоих вариантах.
test('сборка открывается из корня сервера, все ресурсы загружаются', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Конструктор первого рабочего дня' })).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить демоплан' }).click();
  await expect(page.getByTestId('block')).toHaveCount(10);
  expect(failed).toEqual([]);
});
