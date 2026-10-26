// Почта проверяется на настоящем протоколе: фейковый SMTP-сервер принимает
// EHLO/AUTH/DATA и сохраняет тело письма. Структура multipart разбирается
// вручную — иначе вложение «уходит» по тестам, а почтовик клиента его не видит.
// Запуск:
//   npm run test:mail
//   node --experimental-sqlite --test tests/mail.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:net';

process.env.DATA_DIR = '/tmp/karkas-mail-' + Date.now();
process.env.PORT = '18095';
process.env.SEED_MODE = 'off';

const SMTP_PORT = 18025;
const seen = { mails: [], auth: [] };

// минимальный SMTP: без STARTTLS, с AUTH LOGIN и приёмом DATA
const smtp = createServer(sock => {
  let buf = '', inData = false, raw = '', authStep = 0;
  sock.write('220 fake.example ESMTP\r\n');
  const handle = line => {
    const up = line.toUpperCase();
    if (authStep) { seen.auth.push(line); sock.write(authStep === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 2.7.0 Authentication successful\r\n'); authStep = authStep === 1 ? 2 : 0; return }
    if (up.startsWith('EHLO') || up.startsWith('HELO')) return sock.write('250-fake.example\r\n250 AUTH LOGIN\r\n');
    if (up === 'AUTH LOGIN') { authStep = 1; return sock.write('334 VXNlcm5hbWU6\r\n') }
    if (up.startsWith('MAIL FROM')) return sock.write('250 2.1.0 Ok\r\n');
    if (up.startsWith('RCPT TO')) return sock.write('250 2.1.5 Ok\r\n');
    if (up === 'DATA') { inData = true; raw = ''; return sock.write('354 End data with <CR><LF>.<CR><LF>\r\n') }
    if (up === 'QUIT') { sock.write('221 2.0.0 Bye\r\n'); return sock.end() }
    sock.write('250 Ok\r\n');
  };
  sock.on('data', chunk => {
    buf += chunk.toString('utf8');
    if (inData) {
      const end = buf.indexOf('\r\n.\r\n');
      if (end < 0) { raw += buf; buf = ''; return }
      raw += buf.slice(0, end);
      buf = buf.slice(end + 5);
      inData = false;
      seen.mails.push(raw);
      sock.write('250 2.0.0 Ok: queued\r\n');
    }
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); handle(line) }
  });
  sock.on('error', () => {});
});

const { server, db, docToken, readDocToken } = await import('../backend/src/server.js');
const { buildMailMessage, checkAttachments, mailFileName, MAIL_LIMITS } = await import('../backend/src/smtp.js');
const base = 'http://127.0.0.1:18095';
let admin;

// тело письма приходит в base64 по 76 символов в строке: чтобы проверить текст,
// его нужно собрать и раскодировать
const mailText = raw => Buffer.from(String(raw).split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8');

const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data };
};

before(async () => {
  await new Promise(r => smtp.listen(SMTP_PORT, r));
  await new Promise(r => server.listening ? r() : server.once('listening', r));
  admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'admin12345' } })).data.token;
  assert.ok(admin, 'вход администратора');
  const cfg = await call('/api/integrations/email/test', { method: 'POST', token: admin, body: { host: '127.0.0.1', port: SMTP_PORT, secure: '0', user: 'crm@example.com', pass: 'mail-pass', from: 'crm@example.com', to: 'probe@example.com' } });
  assert.equal(cfg.status, 200, 'почта настроена и проверочное письмо прошло: ' + JSON.stringify(cfg.data));
});

after(async () => {
  await new Promise(r => server.close(r));
  smtp.close();
  try { db.close() } catch {}
});

test('письмо без вложений остаётся простым текстом', async () => {
  const raw = buildMailMessage({ from: 'a@b.c', to: 'c@d.e', subject: 'Тема', text: 'Привет', messageId: '<m1@karkascrm>' });
  assert.match(raw, /^From: <a@b\.c>\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?.*\?=\r\n/, 'тема закодирована: иначе кириллица у адресата превратится в кракозябры');
  assert.match(raw, /Content-Type: text\/plain; charset=utf-8/);
  assert.ok(!/multipart/.test(raw), 'без вложений multipart не нужен');
  assert.ok(raw.endsWith(Buffer.from('Привет').toString('base64') + '\r\n'), 'тело передано в base64');
});

test('вложение собирается по MIME: границы, base64 и читаемое имя файла', async () => {
  const content = Buffer.from('<html>КП на дом</html>', 'utf8');
  const raw = buildMailMessage({
    from: 'a@b.c', to: 'c@d.e', subject: 'КП', text: 'Добрый день!', messageId: '<m2@karkascrm>',
    attachments: [{ filename: 'КП-0001.html', contentType: 'text/html', content }],
  });
  const b = raw.match(/boundary="([^"]+)"/);
  assert.ok(b, 'граница объявлена в заголовке');
  assert.equal(raw.split('--' + b[1]).length, 4, 'две части и закрывающая граница');
  assert.ok(raw.endsWith(`--${b[1]}--\r\n`), 'письмо закрыто правильной границей');
  assert.match(raw, /Content-Disposition: attachment; filename="__-0001\.html"; filename\*=UTF-8''%D0%9A%D0%9F-0001\.html/,
    'имя файла отдано и латинской подстановкой, и по RFC 2231');
  assert.ok(raw.includes(content.toString('base64')), 'содержимое передано в base64 без искажений');
  // текст письма идёт до вложения: клиенты без просмотра вложений должны его увидеть
  assert.ok(raw.indexOf(Buffer.from('Добрый день!').toString('base64')) < raw.indexOf(content.toString('base64')));
  assert.ok(!raw.split('\r\n').some(l => l.startsWith('.')), 'ни одна строка не начинается с точки: DATA не оборвётся раньше времени');
});

test('пределы вложений не дают отправить письмо, которое почтовик отвергнет', async () => {
  assert.throws(() => checkAttachments([{ filename: 'пусто.pdf', content: Buffer.alloc(0) }]), /пустое/);
  assert.throws(() => checkAttachments(Array.from({ length: MAIL_LIMITS.attachments + 1 }, (_, i) => ({ filename: 'f' + i, content: Buffer.from('x') }))), /Слишком много вложений/);
  assert.throws(() => checkAttachments([{ filename: 'большой.pdf', content: Buffer.alloc(MAIL_LIMITS.fileBytes + 1) }]), /больше/);
  // имя файла не должно позволять ни перевод строки, ни путь
  assert.equal(mailFileName('от\r\nчёт/../../etc/passwd.pdf'), 'отчёт....etcpasswd.pdf');
  assert.equal(mailFileName(''), 'file', 'без имени файл всё равно можно отправить');
});

test('ссылка на документ подписана, а подделка и просрочка не проходят', async () => {
  const good = docToken(7, 'invoice');
  assert.deepEqual({ ...readDocToken(good), expiresAt: undefined }, { id: 7, doc: 'invoice', expiresAt: undefined });
  assert.equal(readDocToken(good).doc, 'invoice');
  assert.equal(readDocToken(good.slice(0, -2) + 'aa'), null, 'чужая подпись не принимается');
  const payload = Buffer.from(good.split('.')[0], 'base64url').toString('utf8');
  const forged = Buffer.from(payload.replace('invoice', 'quote').replace(/\.(\d+)$/, '.99'), 'utf8').toString('base64url') + '.' + good.split('.')[1];
  assert.equal(readDocToken(forged), null, 'подмена номера документа без подписи не проходит');
  assert.equal(readDocToken(docToken(7, 'quote', -1)), null, 'просроченная ссылка не открывается');
  assert.equal(readDocToken(''), null);
  assert.equal(readDocToken('мусор'), null);
});

test('КП и счёт уходят клиенту письмом со ссылкой, которая открывается без входа', async () => {
  const contact = (await call('/api/contacts', { method: 'POST', token: admin, body: { name: 'Почтовый Клиент', phone: '+7 900 111-22-33', email: 'client@mail.example' } })).data;
  assert.ok(contact.id, 'клиент создан');
  const product = (await call('/api/products', { method: 'POST', token: admin, body: { name: 'Каркасный дом 6×8', price: 890000, unit: 'шт' } })).data;
  const deal = (await call('/api/deals', { method: 'POST', token: admin, body: { title: 'Дом для почты', amount: 0, stage: 'new', contact_id: contact.id } })).data;
  await call(`/api/deals/${deal.id}/products`, { method: 'POST', token: admin, body: { product_id: product.id, qty: 1 } });

  // без позиций документ пустой — проверяем на отдельной сделке
  const empty = (await call('/api/deals', { method: 'POST', token: admin, body: { title: 'Пустая', amount: 0, stage: 'new', contact_id: contact.id } })).data;
  const noItems = await call(`/api/deals/${empty.id}/send-doc`, { method: 'POST', token: admin, body: { doc: 'quote' } });
  assert.equal(noItems.status, 400, 'пустой документ не отправляем');
  assert.match(String(noItems.data.error), /нет позиций/);

  const sent = await call(`/api/deals/${deal.id}/send-doc`, { method: 'POST', token: admin, body: { doc: 'quote' } });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.to, 'client@mail.example', 'адрес взят из карточки клиента');
  const mail = seen.mails[seen.mails.length - 1];
  assert.ok(mail, 'письмо дошло до почтового сервера');
  const text = mailText(mail);
  assert.ok(text.includes(sent.data.link), 'в письме есть ссылка на документ: ' + text.slice(0, 160));
  assert.ok(text.includes('Дом для почты'), 'в тексте названа сделка');
  assert.ok(text.includes('Почтовый Клиент'), 'обращение по имени клиента');

  // ссылка открывается без входа в CRM — иначе клиент её просто не сможет прочитать
  const anon = await fetch(sent.data.link.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(anon.status, 200, 'документ доступен без токена');
  const page = await anon.text();
  assert.match(page, /Каркасный дом 6×8/, 'в документе позиция из сделки');
  assert.match(page, /890\s?000|890000/, 'в документе сумма');

  const invoice = await call(`/api/deals/${deal.id}/send-doc`, { method: 'POST', token: admin, body: { doc: 'invoice', to: 'buh@client.example', subject: 'Счёт на оплату' } });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.data));
  const invPage = await (await fetch(invoice.data.link.replace(/^https?:\/\/[^/]+/, base))).text();
  assert.match(invPage, /Счёт/, 'по ссылке счёт, а не КП');

  const broken = await fetch(base + '/d/' + invoice.data.link.split('/d/')[1].slice(0, -3) + 'zzz');
  assert.equal(broken.status, 404, 'испорченная ссылка не открывает документ');

  const history = (await call('/api/deals/' + deal.id, { token: admin })).data.history.map(x => x.text);
  assert.ok(history.some(t => /отправлен/i.test(t) && t.includes('client@mail.example')), 'отправка видна в истории сделки: ' + history.join(' | '));
});

test('правило автоматизации отправляет клиенту письмо в срок события', async () => {
  const contact = (await call('/api/contacts', { method: 'POST', token: admin, body: { name: 'Автописьмо Анна', phone: '+7 900 999-88-77', email: 'auto@mail.example' } })).data;
  const product = (await call('/api/products', { method: 'POST', token: admin, body: { name: 'Терраса', price: 120000 } })).data;
  const deal = (await call('/api/deals', { method: 'POST', token: admin, body: { title: 'Терраса к дому', amount: 120000, stage: 'new', contact_id: contact.id } })).data;
  const rule = await call('/api/automations', { method: 'POST', token: admin, body: { name: 'Предложение готово', trigger_type: 'stage_changed', trigger_value: 'offer', action_type: 'send_email', action_value: '{name}, добрый день! По заявке «{deal}» сумма {sum} руб.', active: 1, delay_days: 0 } });
  assert.ok(rule.data.id, 'правило создано: ' + JSON.stringify(rule.data));

  const before = seen.mails.length;
  const moved = await call(`/api/deals/${deal.id}`, { method: 'PATCH', token: admin, body: { stage: 'offer' } });
  assert.equal(moved.status, 200);
  assert.equal(seen.mails.length, before + 1, 'письмо ушло при переходе на этап');
  const text = mailText(seen.mails[seen.mails.length - 1]);
  assert.ok(text.includes('Автописьмо Анна, добрый день!'), 'имя клиента подставилось: ' + text.slice(0, 120));
  assert.ok(text.includes('«Терраса к дому»'), 'название сделки подставилось');
  assert.ok(text.includes('120000'), 'сумма подставилась');
  assert.match(seen.mails[seen.mails.length - 1], /Subject: =\?UTF-8\?B\?/, 'тема закодирована');
  const conv = db.prepare('SELECT id FROM conversations WHERE contact_id=?').get(contact.id);
  if (conv) {
    const mail = db.prepare("SELECT * FROM messages WHERE conversation_id=? AND channel='email'").all(conv.id);
    assert.ok(mail.length >= 1, 'письмо видно в переписке клиента');
    assert.equal(mail[mail.length - 1].author, 'Автоматизация', 'видно, что письмо автоматическое');
  }

  // у клиента без e-mail письмо не отправляется, но след в истории остаётся:
  // иначе правило выглядит работающим, а клиент ничего не получил
  const noMail = (await call('/api/contacts', { method: 'POST', token: admin, body: { name: 'Без Адреса', phone: '+7 900 121-21-21' } })).data;
  const d2 = (await call('/api/deals', { method: 'POST', token: admin, body: { title: 'Без почты', amount: 1, stage: 'new', contact_id: noMail.id } })).data;
  const count = seen.mails.length;
  await call(`/api/deals/${d2.id}`, { method: 'PATCH', token: admin, body: { stage: 'offer' } });
  assert.equal(seen.mails.length, count, 'письмо никуда не ушло: адреса нет');
  const history = (await call('/api/deals/' + d2.id, { token: admin })).data.history.map(x => x.text);
  assert.ok(history.some(t => /нет e-mail/i.test(t)), 'в истории сказано, почему не отправлено: ' + history.join(' | '));
});

test('без e-mail клиента и без настроенной почты ошибка понятная', async () => {
  const contact = (await call('/api/contacts', { method: 'POST', token: admin, body: { name: 'Без Почты', phone: '+7 900 444-55-66' } })).data;
  const product = (await call('/api/products', { method: 'POST', token: admin, body: { name: 'Баня', price: 250000 } })).data;
  const deal = (await call('/api/deals', { method: 'POST', token: admin, body: { title: 'Баня без почты', amount: 250000, stage: 'new', contact_id: contact.id } })).data;
  await call(`/api/deals/${deal.id}/products`, { method: 'POST', token: admin, body: { product_id: product.id, qty: 1 } });

  const noMail = await call(`/api/deals/${deal.id}/send-doc`, { method: 'POST', token: admin, body: { doc: 'quote' } });
  assert.equal(noMail.status, 400);
  assert.match(String(noMail.data.error), /e-mail/i, 'ошибка называет причину: ' + noMail.data.error);

  const explicit = await call(`/api/deals/${deal.id}/send-doc`, { method: 'POST', token: admin, body: { doc: 'quote', to: 'founder@company.example' } });
  assert.equal(explicit.status, 200, 'адрес можно ввести вручную, если в карточке его нет');
  assert.match(seen.mails[seen.mails.length - 1], /RCPT|To:/);
});
