// KarkasCRM — минимальный SMTP-клиент без зависимостей (письма клиентам из CRM).
// Поддержка: implicit TLS (465), STARTTLS, AUTH LOGIN, кодирование темы (=?UTF-8?B?..?=) и тела (base64).
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const isIp = h => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(h));
const tlsOpts = (host, extra = {}) => ({ host, ...(isIp(host) ? {} : { servername: host }), rejectUnauthorized: false, ...extra });
const chunk76 = s => (s.match(/.{1,76}/g) || []).join('\r\n');

function reader(socket, onLine) {
  let buf = '';
  socket.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); onLine(line) }
  });
}

export async function sendMail({ host, port = 587, secure, starttls, user, pass, from, fromName, to, toName, subject, text, timeout = 20000, allowInsecure = true }) {
  if (!host) throw new Error('Не задан SMTP-сервер (Настройки → Интеграции → Почта)');
  if (!to || !String(to).includes('@')) throw new Error('Некорректный e-mail получателя: ' + (to || '—'));
  const fromAddr = from || user;
  if (!fromAddr) throw new Error('Не задан адрес отправителя (MAIL_FROM)');
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
    if (waiters.length) waiters.shift()(line);
    else pending.push(line);
  };
  const startReading = () => reader(socket, onLineInit);
  const readLine = () => new Promise(res => { if (pending.length) return res(pending.shift()); waiters.push(res) });
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
    const headers = [
      `From: ${fromName ? `=?UTF-8?B?${b64(fromName)}?= ` : ''}<${fromAddr}>`,
      `To: ${toName ? `=?UTF-8?B?${b64(toName)}?= ` : ''}<${to}>`,
      `Subject: =?UTF-8?B?${b64(subject || 'Сообщение от CRM')}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      'X-Mailer: KarkasCRM',
    ].join('\r\n');
    socket.write(headers + '\r\n\r\n' + chunk76(b64(text || '')) + '\r\n.\r\n');
    log.push('> [письмо]');
    await readCode(['250']);
    await send('QUIT', ['221']).catch(() => {});
    return { ok: true, messageId, to, subject, log };
  } finally {
    try { socket?.destroy() } catch {}
  }
}
