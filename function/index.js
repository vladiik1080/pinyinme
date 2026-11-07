// Yandex Cloud Function: принимает заявку с pinyinme.ru и пересылает её
// на почту (через SMTP Яндекса) и, если получится, в Telegram.
// Переменные окружения:
//   SMTP_USER  — адрес Яндекс Почты, например PinyinMe@yandex.ru
//   SMTP_PASS  — пароль приложения для почты (не основной пароль!)
//   MAIL_TO    — куда слать заявки (по умолчанию SMTP_USER)
//   BOT_TOKEN, CHAT_ID — необязательно, для дублирования в Telegram
const nodemailer = require('nodemailer');

const ALLOWED = ['https://pinyinme.ru', 'https://www.pinyinme.ru'];

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
});

const reply = (code, origin, data) => ({ statusCode: code, headers: cors(origin), body: JSON.stringify(data) });
const clean = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);

async function sendMail(subject, text) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error('SMTP не настроен');
  const transport = nodemailer.createTransport({
    host: 'smtp.yandex.ru', port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000,
  });
  await transport.sendMail({
    from: `"pinyinme.ru" <${process.env.SMTP_USER}>`,
    to: process.env.MAIL_TO || process.env.SMTP_USER,
    subject, text,
  });
}

async function sendTelegram(text) {
  if (!process.env.BOT_TOKEN || !process.env.CHAT_ID) throw new Error('Telegram не настроен');
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.CHAT_ID, text }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}`);
}

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
    'Новая заявка с pinyinme.ru',
    `Имя: ${name}`,
    `Контакт: ${contact}`,
    `Уровень: ${level || 'не указан'}`,
    goal ? `Цель: ${goal}` : null,
  ].filter(Boolean).join('\n');

  const results = await Promise.allSettled([
    sendMail(`Заявка: ${name}`, text),
    sendTelegram(text),
  ]);
  results.forEach((r, i) => r.status === 'rejected' && console.log(i ? 'Telegram:' : 'Почта:', r.reason && r.reason.message));

  const delivered = results.some((r) => r.status === 'fulfilled');
  return reply(delivered ? 200 : 502, origin, delivered ? { ok: true } : { ok: false, error: results.map((r) => r.reason && r.reason.message).join('; ') });
};
