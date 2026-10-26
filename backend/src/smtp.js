// KarkasCRM — минимальный SMTP-клиент без зависимостей (письма клиентам из CRM).
// Поддержка: implicit TLS (465), STARTTLS, AUTH LOGIN, кодирование темы (=?UTF-8?B?..?=) и тела (base64).
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const isIp = h => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(h));
// Сертификат проверяется по умолчанию. Для внутреннего релея с самоподписанным
// сертификатом можно осознанно отключить проверку: SMTP_TLS_INSECURE=1.
const tlsOpts = (host, extra = {}) => ({ host, ...(isIp(host) ? {} : { servername: host }), rejectUnauthorized: process.env.SMTP_TLS_INSECURE !== '1', ...extra });
const chunk76 = s => (s.match(/.{1,76}/g) || []).join('\r\n');

function reader(socket, onLine) {
  let buf = '';
  socket.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); onLine(line) }
  });
}

// Пределы вложений держим у себя: почтовый сервер на oversized-письмо ответит
// отказом уже после отправки, и менеджер увидит «ушло», а клиент не получит ничего.
export const MAIL_LIMITS = { attachments: 5, fileBytes: 10 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 };

// Имя файла попадает в заголовок письма: перевод строки разорвал бы заголовок,
// а слэш или обратная кавычка позволили бы сохранить файл под чужим именем.
export const mailFileName = name => {
  const clean = String(name ?? '').replace(/[\r\n"\\/\u0000-\u001f]/g, '').trim().slice(-120);
  return clean || 'file';
};
// Кириллическое имя файла: рядом с обычной латинской подстановкой отдаём имя по
// RFC 2231 (filename*=UTF-8''…). Современные почтовики берут точное имя, а старые
// не ломаются и показывают запасное.
const pct = v => encodeURIComponent(v).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const mimeName = (kind, name) => /^[\x20-\x7e]+$/.test(name)
  ? `; ${kind}="${name}"`
  : `; ${kind}="${name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'file'}"; ${kind}*=UTF-8''${pct(name)}`;
const mimeTypes = /^(application|audio|image|message|model|text|video|multipart|font)\/[\w.+-]+$/i;

// Письмо целиком, от заголовков до последней границы. Вынесено из sendMail,
// чтобы структуру multipart можно было проверить без настоящего SMTP-сервера.
export function buildMailMessage({ from, fromName, to, toName, subject, text, messageId, attachments = [] }) {
  const files = (attachments || []).filter(f => f && f.content != null);
  const head = [
    `From: ${fromName ? `=?UTF-8?B?${b64(fromName)}?= ` : ''}<${from}>`,
    `To: ${toName ? `=?UTF-8?B?${b64(toName)}?= ` : ''}<${to}>`,
    `Subject: =?UTF-8?B?${b64(subject || 'Сообщение от CRM')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'X-Mailer: KarkasCRM',
  ];
  // Всё содержимое кодируется base64, поэтому ни одна строка не начинается с
  // точки и дополнительная защита от «точечного» завершения DATA не нужна.
  const textPart = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', chunk76(b64(text || ''))].join('\r\n');
  if (!files.length) {
    return head.concat(['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'])
      .join('\r\n') + '\r\n\r\n' + chunk76(b64(text || '')) + '\r\n';
  }
  const boundary = 'karkas-' + randomBytes(12).toString('hex');
  const parts = files.map(f => {
    const name = mailFileName(f.filename);
    const type = mimeTypes.test(String(f.contentType || '')) ? String(f.contentType) : 'application/octet-stream';
    const raw = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8');
    return [
      `Content-Type: ${type}${mimeName('name', name)}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment${mimeName('filename', name)}`,
      '', chunk76(raw.toString('base64')),
    ].join('\r\n');
  });
  head.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  // сначала текст, потом файлы: так письмо читают клиенты, которые не показывают вложения
  return head.join('\r\n') + '\r\n\r\n'
    + `--${boundary}\r\n${textPart}\r\n`
    + parts.map(part => `--${boundary}\r\n${part}`).join('\r\n')
    + `\r\n--${boundary}--\r\n`;
}

export function checkAttachments(attachments = []) {
  const list = attachments || [];
  if (list.length > MAIL_LIMITS.attachments) throw new Error(`Слишком много вложений: за раз можно отправить не больше ${MAIL_LIMITS.attachments}`);
  let total = 0;
  for (const f of list) {
    const raw = Buffer.isBuffer(f?.content) ? f.content : Buffer.from(String(f?.content ?? ''), 'utf8');
    if (!raw.length) throw new Error(`Вложение «${mailFileName(f?.filename)}» пустое — отправлять нечего`);
    if (raw.length > MAIL_LIMITS.fileBytes) throw new Error(`Вложение «${mailFileName(f?.filename)}» больше ${Math.round(MAIL_LIMITS.fileBytes / 1048576)} МБ`);
    total += raw.length;
  }
  if (total > MAIL_LIMITS.totalBytes) throw new Error(`Вложения суммарно больше ${Math.round(MAIL_LIMITS.totalBytes / 1048576)} МБ — почтовый сервер такое письмо не примет`);
  return list;
}

export async function sendMail({ host, port = 587, secure, starttls, user, pass, from, fromName, to, toName, subject, text, timeout = 20000, allowInsecure = true, attachments = [] }) {
  if (!host) throw new Error('Не задан SMTP-сервер (Настройки → Интеграции → Почта)');
  if (!to || !String(to).includes('@')) throw new Error('Некорректный e-mail получателя: ' + (to || '—'));
  const fromAddr = from || user;
  if (!fromAddr) throw new Error('Не задан адрес отправителя (MAIL_FROM)');
  const files = checkAttachments(attachments);
  const implicitTls = secure ?? Number(port) === 465;
  const useStarttls = secure === false ? false : starttls !== false; // SMTP_SECURE=0 — явный отказ от шифрования
  const messageId = `<${randomBytes(8).toString('hex')}@karkascrm>`;
  const log = [], GREETING = [];
  let socket, secureNow = implicitTls;

  const connect = () => new Promise((resolve, reject) => {
    const onError = e => reject(e);
    if (implicitTls) {
      socket = tls.connect(tlsOpts(host, { port: Number(port) }));
      socket.once('secureConnect', resolve);
    } else {
      socket = net.connect({ host, port: Number(port) });
      socket.once('connect', resolve);
    }
    socket.once('error', onError);
    socket.setTimeout(timeout, () => { socket.destroy(new Error('Таймаут SMTP (' + timeout + ' мс)')); });
  });

  // очередь ответов сервера: ждём код из expected
  const pending = [];
  let waiters = [];
  const onLineInit = line => {
    log.push('< ' + line);
    const w = waiters.shift();
    if (w) w.res(line);
    else pending.push(line);
  };
  // если сервер оборвал соединение или молчит — не зависаем, а сразу отдаём понятную ошибку
  const failAll = e => { while (waiters.length) waiters.shift().rej(e) };
  const watchSocket = () => {
    socket.on('error', failAll);
    socket.on('close', () => failAll(new Error('SMTP-сервер закрыл соединение')));
  };
  const startReading = () => reader(socket, onLineInit);
  const readLine = () => new Promise((res, rej) => { if (pending.length) return res(pending.shift()); waiters.push({ res, rej }) });
  const readCode = async (expected) => {
    let line = await readLine();
    const lines = [line];
    while (/^\d{3}-/.test(line)) { line = await readLine(); lines.push(line) } // многострочный ответ сервера
    const code = line.slice(0, 3);
    if (expected && !expected.includes(code)) throw new Error(`SMTP ответил ${code}: ${line.slice(4)}`);
    return { code, line, lines };
  };
  const send = async (cmd, expected, hide = false) => {
    log.push('> ' + (hide ? '***' : cmd));
    socket.write(cmd + '\r\n');
    return expected ? readCode(expected) : null;
  };

  try {
    await connect();
    watchSocket();
    startReading();
    GREETING.push((await readCode(['220'])).line);
    let caps = (await send('EHLO karkascrm', ['250'])).lines.join(' ');
    if (!secureNow && useStarttls) {
      if (/STARTTLS/i.test(caps)) {
        await send('STARTTLS', ['220']);
        socket.removeAllListeners('data');
        socket = tls.connect(tlsOpts(host, { socket }));
        await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej) });
        secureNow = true;
        watchSocket();
        startReading();
        caps = (await send('EHLO karkascrm', ['250'])).lines.join(' '); // возможности могли измениться после шифрования
      } else if (!allowInsecure) {
        throw new Error('Сервер не поддерживает STARTTLS, а незашифрованная отправка запрещена');
      }
    }
    const hasAuth = /AUTH[ =]/i.test(caps);
    if (user && hasAuth) {
      await send('AUTH LOGIN', ['334']);
      await send(b64(user), ['334'], true);
      await send(b64(pass || ''), ['235', '503'], true);
    }
    await send(`MAIL FROM:<${fromAddr}>`, ['250']);
    await send(`RCPT TO:<${to}>`, ['250', '251']);
    await send('DATA', ['354']);
    socket.write(buildMailMessage({ from: fromAddr, fromName, to, toName, subject, text, messageId, attachments: files }) + '.\r\n');
    log.push(files.length ? `> [письмо с вложениями: ${files.length}]` : '> [письмо]');
    await readCode(['250']);
    await send('QUIT', ['221']).catch(() => {});
    return { ok: true, messageId, to, subject, attachments: files.length, log };
  } finally {
    try { socket?.destroy() } catch {}
  }
}
