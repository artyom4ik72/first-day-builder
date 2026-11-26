import { linkLabel } from './links';
import { KIND_LABEL, type Block, type Contact, type DayPlan } from './model';
import { endLabel, formatDate, formatDuration, toHHMM } from './time';
import { validatePlan } from './timeline-validation';

// Автономная HTML-страница плана для новичка. Один и тот же DayPlan даёт и предпросмотр
// (iframe srcdoc без скриптов), и скачиваемый файл: это одна строка.
// Весь пользовательский текст экранируется, ссылки — только нормализованные http/https,
// а CSP запрещает скрипты, даже если где-то экранирование будет пропущено.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Переносы строк в описании сохраняются как <br>, после экранирования. */
function text(s: string): string {
  return escapeHtml(s.trim()).replace(/\r?\n/g, '<br>');
}

const CSS = `
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d2430;line-height:1.5}
body{margin:0;background:#f6f7fb}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;margin:0 0 4px}
h2{font-size:1.15rem;margin:28px 0 10px}
.date{color:#4a5568;margin:0 0 12px}
.welcome{background:#fff;border:1px solid #dfe3ee;border-radius:10px;padding:12px 16px}
ol,ul{list-style:none;padding:0;margin:0}
.item{background:#fff;border:1px solid #dfe3ee;border-left:5px solid #3d5afe;border-radius:10px;padding:10px 14px;margin:0 0 10px;break-inside:avoid}
.item--task{border-left-color:#00897b}
.item--material{border-left-color:#8e6c00}
.time{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.kind{display:inline-block;font-size:.78rem;color:#4a5568;border:1px solid #c9cfdd;border-radius:999px;padding:0 8px;margin-left:6px}
.title{font-weight:600;margin:2px 0}
.meta{color:#4a5568;font-size:.92rem;margin:2px 0}
.desc{margin:6px 0 0;overflow-wrap:anywhere}
a{color:#2a46c9;overflow-wrap:anywhere}
.people li{background:#fff;border:1px solid #dfe3ee;border-radius:10px;padding:8px 14px;margin:0 0 8px}
.empty{color:#4a5568}
footer{margin-top:32px;color:#6b7280;font-size:.85rem}
@media print{body{background:#fff}main{padding:0}.item,.welcome,.people li{border-color:#999}}
`;

function contactLine(c: Contact): string {
  const parts = [`<strong>${text(c.name)}</strong>`];
  if (c.role.trim()) parts.push(text(c.role));
  const reach = [c.email.trim(), c.phone.trim()].filter(Boolean).map(text).join(', ');
  return `${parts.join(' — ')}${reach ? `<br><span class="meta">${reach}</span>` : ''}`;
}

function blockHtml(b: Block, href: string | undefined, contacts: Map<string, Contact>): string {
  const time =
    b.start !== null
      ? `<span class="time">${toHHMM(b.start)}–${endLabel(b.start + b.duration)}</span> <span class="meta">(${formatDuration(b.duration)})</span>`
      : '';
  const who = b.contactIds
    .map((id) => contacts.get(id))
    .filter((c): c is Contact => Boolean(c))
    .map((c) => `${text(c.name)}${c.role.trim() ? ` (${text(c.role)})` : ''}`);
  return [
    `<li class="item item--${b.kind}" data-block-id="${escapeHtml(b.id)}">`,
    `<div>${time}<span class="kind">${KIND_LABEL[b.kind]}</span></div>`,
    `<p class="title">${text(b.title)}</p>`,
    b.place.trim() ? `<p class="meta">Где: ${text(b.place)}</p>` : '',
    who.length ? `<p class="meta">С кем: ${who.join(', ')}</p>` : '',
    b.description.trim() ? `<p class="desc">${text(b.description)}</p>` : '',
    href ? `<p class="desc"><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel(href, b.link))}</a></p>` : '',
    '</li>',
  ]
    .filter(Boolean)
    .join('');
}

export function renderPlanHtml(plan: DayPlan): string {
  const check = validatePlan(plan);
  const contacts = new Map(plan.contacts.map((c) => [c.id, c]));
  const date = formatDate(plan.date);
  const heading = plan.newcomer.trim() ? `${text(plan.title)}: ${text(plan.newcomer)}` : text(plan.title);
  const timed = check.timed.map((b) => blockHtml(b, check.links.get(b.id), contacts)).join('\n');
  const untimed = check.untimed.map((b) => blockHtml(b, check.links.get(b.id), contacts)).join('\n');
  const people = plan.contacts.map((c) => `<li>${contactLine(c)}</li>`).join('\n');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(plan.title.trim() || 'План первого дня')}${date ? ` — ${escapeHtml(date)}` : ''}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${heading}</h1>
${date ? `<p class="date">${escapeHtml(date)}</p>` : ''}
${plan.mentor.trim() ? `<p class="meta">Наставник: ${text(plan.mentor)}</p>` : ''}
${plan.welcome.trim() ? `<div class="welcome">${text(plan.welcome)}</div>` : ''}
<h2>Расписание</h2>
${timed ? `<ol class="timeline">\n${timed}\n</ol>` : '<p class="empty">Встреч по времени нет.</p>'}
${untimed ? `<h2>Материалы и задачи без времени</h2>\n<ul class="untimed">\n${untimed}\n</ul>` : ''}
${people ? `<h2>Контакты</h2>\n<ul class="people">\n${people}\n</ul>` : ''}
<footer>Страница подготовлена в «Конструкторе первого рабочего дня». Она открывается без интернета и без доступа к редактору.</footer>
</main>
</body>
</html>
`;
}

export function exportFileName(plan: DayPlan): string {
  return `first-day-${/^\d{4}-\d{2}-\d{2}$/.test(plan.date) ? plan.date : 'plan'}.html`;
}
