// Yandex Cloud Function: принимает заявку с pinyinme.ru и пересылает её в Telegram.
// Переменные окружения функции: BOT_TOKEN (токен от @BotFather), CHAT_ID (куда слать заявки).
const ALLOWED = ['https://pinyinme.ru', 'https://www.pinyinme.ru'];

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
});

const reply = (code, origin, data) => ({ statusCode: code, headers: cors(origin), body: JSON.stringify(data) });
const clean = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);

module.exports.handler = async (event) => {
  const origin = (event.headers && (event.headers.Origin || event.headers.origin)) || '';
  if (event.httpMethod === 'OPTIONS') return reply(204, origin, {});
  if (event.httpMethod !== 'POST') return reply(405, origin, { ok: false });
  if (!ALLOWED.includes(origin)) return reply(403, origin, { ok: false });

  let data;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    data = JSON.parse(raw || '{}');
  } catch {
    return reply(400, origin, { ok: false });
  }

  // скрытое поле-ловушка для спам-ботов: человек его не видит и не заполняет
  if (data.website) return reply(200, origin, { ok: true });

  const name = clean(data.name, 100);
  const contact = clean(data.contact, 100);
  const level = clean(data.level, 40);
  const goal = clean(data.goal, 1000);
  if (!name || !contact || data.consent !== true) return reply(400, origin, { ok: false });

  const text = [
    '📝 Новая заявка с pinyinme.ru',
    `Имя: ${name}`,
    `Контакт: ${contact}`,
    `Уровень: ${level || 'не указан'}`,
    goal ? `Цель: ${goal}` : null,
  ].filter(Boolean).join('\n');

  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.CHAT_ID, text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.log('Telegram error', res.status, err.description);
    return reply(502, origin, { ok: false, error: err.description || `telegram ${res.status}` });
  }
  return reply(200, origin, { ok: true });
};
