// Нормализация ссылок перед публикацией: только http и https.
// «wiki.example.com/x» → «https://wiki.example.com/x». javascript:, data:, file: и прочие схемы отклоняются.

export type LinkResult = { ok: true; href: string | null } | { ok: false; error: string };

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HOST_LIKE = /^[^\s/?#]+\.[^\s/?#]{2,}([/?#].*)?$/;

export function normalizeLink(input: string): LinkResult {
  const s = input.trim();
  if (!s) return { ok: true, href: null };
  if (/\s/.test(s)) return { ok: false, error: 'В ссылке не должно быть пробелов' };
  let candidate = s;
  const scheme = SCHEME.exec(s)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    // «localhost:8080» и «host:port» без схемы выглядят как схема — для них подсказка та же.
    return { ok: false, error: 'Ссылка должна начинаться с http:// или https://' };
  }
  if (!scheme) {
    if (s.startsWith('//')) candidate = `https:${s}`;
    else if (HOST_LIKE.test(s)) candidate = `https://${s}`;
    else return { ok: false, error: 'Укажите адрес сайта, например https://wiki.example.com' };
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'Ссылка не распознана' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'Ссылка должна начинаться с http:// или https://' };
  if (!url.hostname || (!url.hostname.includes('.') && url.hostname !== 'localhost'))
    return { ok: false, error: 'В адресе нет домена, например example.com' };
  if (url.username || url.password) return { ok: false, error: 'Ссылка не должна содержать логин или пароль' };
  return { ok: true, href: url.href };
}

/**
 * Подпись ссылки для страницы новичка. href нормализован (punycode, %-кодирование), а подпись
 * берётся из того, что ввёл наставник, без схемы: «пример.рф/Новичкам», а не «xn--e1afmkfd.xn--p1ai/%D0%9D…».
 */
export function linkLabel(href: string, original = ''): string {
  let label = original.trim().replace(/^https?:\/\//i, '').replace(/^\/\//, '');
  if (!label) {
    const u = new URL(href);
    const path = u.pathname === '/' ? '' : u.pathname;
    label = `${u.hostname}${path}${u.search}`;
    try {
      label = decodeURI(label);
    } catch {
      /* оставляем как есть */
    }
  }
  label = label.replace(/\/$/, '');
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}
