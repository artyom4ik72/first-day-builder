import { describe, expect, it } from 'vitest';
import { escapeHtml, renderPlanHtml } from './html-export';
import { linkLabel, normalizeLink } from './links';
import { demoPlan, newBlock, type Block, type DayPlan } from './model';
import { exportProject, importProject, MemoryDraftStore, normalizePlan } from './plan-store';
import { formatDate, parseHHMM, toHHMM } from './time';
import { findOverlaps, sortTimed, validatePlan } from './timeline-validation';

const t = (s: string) => parseHHMM(s)!;
const blk = (id: string, start: string | null, duration: number, extra: Partial<Block> = {}): Block => ({
  ...newBlock('meeting', null),
  id,
  title: id,
  start: start === null ? null : t(start),
  duration,
  ...extra,
});
const plan = (blocks: Block[], extra: Partial<DayPlan> = {}): DayPlan => ({ ...demoPlan(0), blocks, contacts: [], ...extra });

describe('время и дата', () => {
  it('минуты ↔ ЧЧ:ММ', () => {
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseHHMM('9:05')).toBe(545);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('12:60')).toBeNull();
    expect(toHHMM(570)).toBe('09:30');
  });
  it('дата словами без Intl', () => {
    expect(formatDate('2026-11-23')).toBe('понедельник, 23 ноября 2026');
    expect(formatDate('2026-02-30')).toBe('');
  });
});

describe('пересечения', () => {
  it('длинная встреча с двумя вложенными конфликтами даёт два пересечения', () => {
    const blocks = [blk('long', '10:00', 120), blk('a', '10:30', 30), blk('b', '11:15', 30)];
    const o = findOverlaps(sortTimed(blocks));
    expect(o.map((x) => [x.first, x.second])).toEqual([
      ['long', 'a'],
      ['long', 'b'],
    ]);
    // Проверка только соседей пропустила бы второй конфликт: a закончилась в 11:00, раньше начала b.
    expect(o[1]).toMatchObject({ from: t('11:15'), to: t('11:45') });
  });

  it('смежные блоки допустимы, одинаковое начало — пересечение', () => {
    expect(findOverlaps(sortTimed([blk('a', '10:00', 60), blk('b', '11:00', 30), blk('c', '11:30', 30)]))).toEqual([]);
    expect(findOverlaps(sortTimed([blk('a', '10:00', 30), blk('b', '10:00', 30)])).map((o) => [o.first, o.second])).toEqual([['a', 'b']]);
  });

  it('совпадает с полным перебором пар на 300 случайных планах', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let k = 0; k < 300; k++) {
      const blocks = Array.from({ length: 1 + rnd(12) }, (_, i) => ({
        ...blk(`x${i}`, null, 5 + rnd(120)),
        start: 8 * 60 + rnd(10) * 30,
      }));
      const pairs = new Set(findOverlaps(sortTimed(blocks)).map((o) => [o.first, o.second].sort().join('|')));
      const brute = new Set<string>();
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i];
          const b = blocks[j];
          if (a.start! < b.start! + b.duration && b.start! < a.start! + a.duration) brute.add([a.id, b.id].sort().join('|'));
        }
      expect(pairs).toEqual(brute);
    }
  });
});

describe('проверка плана', () => {
  it('демо: два конфликта с длинной встречей, обед в 12:00 смежный', () => {
    const p = demoPlan(0);
    const c = validatePlan(p);
    const title = (id: string) => p.blocks.find((b) => b.id === id)!.title;
    expect(c.issues).toEqual([]);
    expect(c.overlaps.map((o) => [title(o.first), title(o.second)])).toEqual([
      ['Настройка ноутбука и доступов', 'Знакомство с командой'],
      ['Настройка ноутбука и доступов', 'Получить пропуск'],
    ]);
    expect(c.ok).toBe(false);
    expect(c.untimed.map((b) => b.title)).toEqual(['Справочник новичка', 'Карта офиса', 'Заполнить профиль в корпоративном мессенджере']);
    // Перенос длинной встречи на 13:00 убирает оба конфликта.
    const moved = { ...p, blocks: p.blocks.map((b) => (b.title.startsWith('Настройка') ? { ...b, start: t('13:00') } : b)) };
    const c2 = validatePlan(moved);
    expect(c2.ok).toBe(true);
    expect(c2.timed.map((b) => toHHMM(b.start!))).toEqual(['09:30', '10:30', '11:15', '12:00', '13:00', '15:00', '16:30']);
  });

  it('невалидные интервалы и поля дают ошибки у полей', () => {
    const c = validatePlan(
      plan(
        [
          blk('m', null, 30),
          blk('late', '23:30', 60),
          blk('zero', '10:00', 0),
          { ...blk('bad', '09:00', 30), title: ' ', link: 'javascript:alert(1)' },
        ],
        { date: '', contacts: [{ id: 'p1', name: '', role: '', email: 'not-an-email', phone: '' }] },
      ),
    );
    const keys = c.issues.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'plan.date',
        'block.m.start',
        'block.late.duration',
        'block.zero.duration',
        'block.bad.title',
        'block.bad.link',
        'contact.p1.name',
        'contact.p1.email',
      ]),
    );
    // Блоки с ошибкой времени не участвуют в поиске пересечений.
    expect(c.overlaps).toEqual([]);
  });
});

describe('ссылки', () => {
  it('принимает только http и https и нормализует адрес', () => {
    expect(normalizeLink('wiki.example.com/newcomer')).toEqual({ ok: true, href: 'https://wiki.example.com/newcomer' });
    expect(normalizeLink(' HTTPS://Example.com ')).toEqual({ ok: true, href: 'https://example.com/' });
    expect(normalizeLink('http://пример.рф/путь')).toMatchObject({ ok: true, href: 'http://xn--e1afmkfd.xn--p1ai/%D0%BF%D1%83%D1%82%D1%8C' });
    expect(normalizeLink('')).toEqual({ ok: true, href: null });
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'ftp://example.com', 'просто текст', 'https://user:pw@example.com', 'https://intranet'])
      expect(normalizeLink(bad).ok, bad).toBe(false);
  });
});

describe('экспорт HTML', () => {
  it('подпись ссылки читаемая: кириллица в домене и пути не превращается в punycode и %-коды', () => {
    const p = demoPlan(0);
    p.blocks[7].link = 'https://вики.пример.рф/Новичкам';
    const html = renderPlanHtml(p);
    expect(html).toContain('href="https://xn--b1amah.xn--e1afmkfd.xn--p1ai/%D0%9D%D0%BE%D0%B2%D0%B8%D1%87%D0%BA%D0%B0%D0%BC"');
    expect(html).toContain('>вики.пример.рф/Новичкам</a>');
    expect(linkLabel('https://wiki.example.com/%D0%A1%D0%BF%D1%80%D0%B0%D0%B2%D0%BA%D0%B0')).toBe('wiki.example.com/Справка');
  });

  it('экранирует пользовательский текст и не содержит скриптов', () => {
    const p = demoPlan(0);
    p.blocks[0].title = '<script>alert(1)</script>';
    p.blocks[1].place = '"><img src=x onerror=alert(1)>';
    const html = renderPlanHtml(p);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Возьмите &lt;b&gt;паспорт&lt;/b&gt;');
    expect(html).toContain("Content-Security-Policy\" content=\"default-src 'none'");
    expect(escapeHtml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&#39;');
  });

  it('порядок по времени, отдельный раздел без времени, нормализованные ссылки', () => {
    const html = renderPlanHtml(demoPlan(0));
    const order = [...html.matchAll(/<span class="time">([\d:]+)–/g)].map((m) => m[1]);
    expect(order).toEqual(['09:30', '10:00', '10:30', '11:15', '12:00', '15:00', '16:30']);
    expect(html.indexOf('Материалы и задачи без времени')).toBeGreaterThan(html.indexOf('Итоги дня'));
    expect(html).toContain('href="https://example.com/office-map"');
    expect(html).toContain('С кем: Илья Петров (ИТ-поддержка)');
    expect(html).toContain('понедельник, 23 ноября 2026');
  });
});

describe('файл проекта и хранилище', () => {
  it('план читается обратно без потерь, мусор нормализуется', () => {
    const p = demoPlan(7);
    const r = importProject(exportProject(p));
    expect(r.ok && r.plan).toEqual(p);
    expect(importProject('{').ok).toBe(false);
    expect(importProject('{"format":"x","plan":{}}').ok).toBe(false);
    const n = normalizePlan({
      blocks: [{ id: 'a', kind: 'material', start: 600, title: 'M', contactIds: ['ghost'] }, { id: 'a', kind: 'zzz', start: -5 }],
      contacts: [],
    });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.plan.blocks[0]).toMatchObject({ kind: 'material', start: null, contactIds: [] });
    expect(n.plan.blocks[1]).toMatchObject({ kind: 'task', start: 540 });
    expect(n.plan.blocks[0].id).not.toBe(n.plan.blocks[1].id);
  });

  it('запись по устаревшей ревизии отклоняется', async () => {
    const s = new MemoryDraftStore();
    const p = demoPlan(1);
    expect(await s.putIfRev(p, 0)).toEqual({ ok: true, rev: 1 });
    expect((await s.putIfRev(p, 0)).ok).toBe(false);
  });
});
