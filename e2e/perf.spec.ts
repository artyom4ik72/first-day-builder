import { expect, test, type Page } from '@playwright/test';
import { loadDemo, openFresh } from './helpers';

// Замер раунда 4: от ввода до второго кадра (input → rAF → rAF), число перезагрузок предпросмотра
// и суммарные длинные задачи. Демо и максимальный план: 60 блоков, 30 контактов. Строки PERF203 — в отчёт.

function bigPlan() {
  const contacts = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `Сотрудник ${i + 1}`, role: 'Коллега', email: `user${i}@example.com`, phone: '' }));
  const blocks = Array.from({ length: 60 }, (_, i) => ({
    id: `b${i}`,
    kind: i < 45 ? (i % 3 ? 'task' : 'meeting') : 'material',
    title: `Блок ${i + 1}`,
    start: i < 45 ? 7 * 60 + i * 15 : null,
    duration: 15,
    parkedStart: null,
    place: `Комната ${i}`,
    description: 'Описание блока для нагрузочного замера. '.repeat(4),
    link: `https://wiki.example.com/page-${i}`,
    contactIds: [`p${i % 30}`, `p${(i + 7) % 30}`],
  }));
  return { format: 'first-day-builder', version: 1, plan: { version: 1, date: '2026-12-07', title: 'Большой план', newcomer: 'Тест', mentor: 'Тест', welcome: '', blocks, contacts, updatedAt: 0 } };
}

async function measure(page: Page, selector: string, values: string[]) {
  return page.evaluate(
    async ({ selector, values }) => {
      const el = document.querySelector<HTMLInputElement>(selector)!;
      const frame = document.querySelector('iframe');
      let loads = 0;
      frame?.addEventListener('load', () => loads++);
      let longMs = 0;
      const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => (longMs += e.duration)));
      po.observe({ type: 'longtask', buffered: false });
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const lat: number[] = [];
      for (const v of values) {
        const t0 = performance.now();
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        lat.push(performance.now() - t0);
      }
      await new Promise((r) => setTimeout(r, 600));
      po.disconnect();
      const sorted = [...lat].sort((a, b) => a - b);
      return { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], previewLoads: loads, longTasksMs: Math.round(longMs) };
    },
    { selector, values },
  );
}

const typing = (base: string) => Array.from({ length: 20 }, (_, i) => base + 'абвгдежзийклмнопрсту'.slice(0, i + 1));

test('задержка ввода и перерисовка предпросмотра: демо и 60 блоков', async ({ page }) => {
  test.setTimeout(120_000);
  await openFresh(page);
  await loadDemo(page);
  await page.locator('[data-title="Настройка ноутбука и доступов"] [data-field$=".start"]').fill('13:00');
  await expect(page.getByTestId('preview')).toBeVisible();
  const demo = await measure(page, '[data-field="plan.newcomer"]', typing('Мария '));
  console.log('PERF203', JSON.stringify({ case: 'демо, ввод имени', ...demo }));

  await page.getByTestId('import-input').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bigPlan())) });
  await expect(page.getByTestId('block')).toHaveCount(60);
  await expect(page.getByTestId('preview')).toBeVisible();
  const big = await measure(page, '[data-field="block.b30.title"]', typing('Блок 31 '));
  console.log('PERF203', JSON.stringify({ case: '60 блоков, ввод названия', ...big }));
  expect(big.median).toBeLessThan(300);
});
