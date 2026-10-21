// КаркасCRM — начальное заполнение базы.
// Два режима (SEED_MODE):
//   base — чистая установка для работы: воронка уже создана схемой,
//          здесь каталог позиций, личные шаблоны администратора и
//          пример правила. Всё редактируется в интерфейсе.
//   demo — локальный запуск «из коробки»: реалистичные клиенты, сделки,
//          задачи, чаты и конкуренты, чтобы сразу видеть, как всё работает.
// Записи демо-режима помечены demo=1 и удаляются кнопкой
// «Настройки → Данные и компания → Демонстрационные данные».
// Внешние запросы не выполняются, рассылок нет.
import { ensureCompetitorsSchema } from './competitors.js';

// Демо-даты задаются по местному времени, а в базу пишутся в UTC —
// интерфейс показывает их обратно в местном поясе.
const day = (offset = 0, time = '10:00') => {
  const [hh, mm] = time.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hh, mm, 0, 0);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
};

// Срок задачи — местное настенное время (как его вводит пользователь).
const dueDay = (offset = 0, time = '10:00') => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
};

const dateOnly = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Каталог он же прайс-лист: позиции подставляются в сделки, а цены участвуют
// в сравнении с конкурентами (раздел «Конкуренты» → «Наш прайс-лист»).
const DEMO_PRODUCTS = [
  ['Каркасный дом 6×8 «Летний»', 'DOM-68', 1850000, 'шт', 'сезонный проект, срок 6 недель'],
  ['Каркасный дом 8×10 «Север»', 'DOM-810', 2950000, 'шт', 'под ключ, тёплый контур, сваи'],
  ['Каркасный дом 10×12 «Семейный»', 'DOM-1012', 4100000, 'шт', ''],
  ['Каркасный дом 12×14 «Простор»', 'DOM-1214', 5600000, 'шт', ''],
  ['Баня каркасная 4×6', 'BAN-46', 890000, 'шт', 'с печью и полком'],
  ['Терраса / веранда к дому', 'TER-01', 145000, 'шт', ''],
  ['Монтаж и отделка под ключ', 'MON-01', 250000, 'услуга', 'цена за объект'],
];

const DEMO_TEMPLATES = [
  ['Приветствие', 'Здравствуйте, {name}! Спасибо за обращение! Уточните, пожалуйста, площадь будущего дома и участок — подготовлю расчёт сегодня.'],
  ['Расчёт стоимости', 'Здравствуйте! Расчёт по вашему проекту: {sum}. Срок строительства — от 6 недель. Могу прислать смету и КП письмом, удобно?'],
  ['Осмотр участка', 'Добрый день! Договорились на осмотр участка: {date}. Подскажите подъездные пути — подойдёт ли техника круглый год?'],
  ['Повторный контакт', 'Здравствуйте, {name}! Напоминаю о нашем разговоре — остались вопросы по проекту дома? Готов ответить и отправить смету.'],
];

// Начальное заполнение: каталог, личные шаблоны администратора, правило.
export function seedBase(db, adminId, demo = 0) {
  const prod = db.prepare('INSERT INTO products(name,sku,price,unit,active,note,demo) VALUES(?,?,?,?,1,?,?)');
  for (const [name, sku, price, unit, note] of DEMO_PRODUCTS) prod.run(name, sku, price, unit, note || '', demo);
  // канал у шаблона больше не используется: куда отправить, выбирается в чате
  const tpl = db.prepare("INSERT INTO templates(name,body,channel,demo,user_id) VALUES(?,?,'any',?,?)");
  for (const [name, body] of DEMO_TEMPLATES) tpl.run(name, body, demo, adminId);
  db.prepare(`INSERT INTO automations(name,trigger_type,trigger_value,action_type,action_value,active,demo)
              VALUES('Новый лид — позвонить','deal_created','','create_task','Позвонить клиенту: уточнить задачу и участок',1,?)`).run(demo);
}

export function seedDemo(db, adminId, adminName) {
  seedBase(db, adminId, 1);
  ensureCompetitorsSchema(db);
  const demo = 1;

  // ── компании и контакты ──
  const q = 'INSERT INTO companies(name,inn,phone,email,site,notes,demo) VALUES(?,?,?,?,?,?,?)';
  const comp1 = db.prepare(q).run('ООО «СтройМонтаж»', '7708452319', '+7 495 221-43-87', 'zakaz@stroymontaj.ru', 'stroymontaj.ru', 'Подрядчик по монтажу каркасов', demo).lastInsertRowid;
  const comp2 = db.prepare(q).run('ИП «Веранда»', '500123456789', '+7 495 777-01-02', '', 'veranda-naro.ru', 'Застройщик коттеджного посёлка', demo).lastInsertRowid;

  const qc = 'INSERT INTO contacts(name,phone,email,company,company_id,position,source,tags,notes,responsible_id,demo,custom,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)';
  const ins = db.prepare(qc);
  const c1 = ins.run('Ольга Соколова', '+7 916 120-34-56', 'olga.sokolova@mail.ru', '', null, '', 'site', 'загородный дом,срочный', 'Звонила с сайта: хочет дом 8×10 под ключ, участок 15 соток в Подмосковье', adminId, demo, '{}', day(-2)).lastInsertRowid;
  const c2 = ins.run('Андрей Кузнецов', '+7 900 221-43-87', 'andrey@studio-k.ru', '', null, '', 'wazzup-whatsapp', 'второй дом', 'Рекомендация клиента, строил баню 3 года назад', adminId, demo, '{}', day(-5)).lastInsertRowid;
  const c3 = ins.run('Дмитрий Лебедев', '+7 900 221-43-88', 'd.lebedev@stroymontaj.ru', 'ООО «СтройМонтаж»', comp1, 'Руководитель проекта', 'wazzup-telegram', 'юрлицо', 'Ищет подрядчика на серию домов в посёлке', adminId, demo, '{}', day(-1)).lastInsertRowid;
  const c4 = ins.run('Мария Панова', '+7 926 555-11-22', 'maria.pan@list.ru', '', null, '', 'avito', 'сравнивает цены', 'Написала с Авито: сравнивает три предложения', adminId, demo, '{}', day(-3)).lastInsertRowid;
  const c5 = ins.run('Сергей Волков', '+7 910 333-44-55', 'volkov@yandex.ru', '', null, '', 'email', '', 'Письмо с запросом коммерческого предложения', adminId, demo, '{}', day(-4)).lastInsertRowid;
  const c6 = ins.run('Елена Крылова', '+7 916 777-88-99', '', '', null, '', 'manual', 'терраса', 'Старая клиентка: делала веранду, теперь хочет баню', adminId, demo, '{}', day(-8)).lastInsertRowid;
  const c7 = ins.run('Тимур Азимов', '+7 926 444-55-66', 'timur@mail.ru', 'ИП «Веранда»', comp2, 'Собственник', 'wazzup-viber', '', 'Разговаривали на выставке', adminId, demo, '{}', day(-6)).lastInsertRowid;

  // ── сделки по этапам воронки ──
  const qd = `INSERT INTO deals(title,amount,stage,pipeline_id,contact_id,company_id,responsible,responsible_id,priority,loss_reason,deadline,closed_at,demo,custom,created_at,updated_at)
              VALUES(?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const idl = db.prepare(qd);
  const d1 = idl.run('Дом 8×10 «Север» под ключ', 2950000, 'offer', c1, null, adminName, adminId, 'high', null, dateOnly(6), null, demo, '{}', day(-2), day(-1)).lastInsertRowid;
  const d2 = idl.run('Дом 6×8 «Летний»', 1850000, 'negotiation', c2, null, adminName, adminId, 'normal', null, dateOnly(10), null, demo, '{}', day(-5), day(-1)).lastInsertRowid;
  const d3 = idl.run('Баня 4×6 для посёлка', 890000, 'new', c3, comp1, adminName, adminId, 'normal', null, dateOnly(14), null, demo, '{}', day(-1), day(-1)).lastInsertRowid;
  const d4 = idl.run('Дом 10×12 «Семейный»', 4100000, 'decision', c4, null, adminName, adminId, 'high', null, dateOnly(4), null, demo, '{}', day(-3), day(0)).lastInsertRowid;
  const d5 = idl.run('Терраса к дому', 145000, 'contact', c6, null, adminName, adminId, 'low', null, dateOnly(12), null, demo, '{}', day(-7), day(-2)).lastInsertRowid;
  idl.run('Дом 8×8 «Компакт»', 2400000, 'won', c5, null, adminName, adminId, 'normal', null, dateOnly(-20), day(-2), demo, '{}', day(-20), day(-2));
  idl.run('Баня 6×8', 1250000, 'won', c7, comp2, adminName, adminId, 'normal', null, dateOnly(-15), day(-9), demo, '{}', day(-15), day(-9));
  idl.run('Дом 12×14 «Простор»', 5600000, 'lost', c3, comp1, adminName, adminId, 'normal', 'Выбрали подрядчика дешевле', dateOnly(-30), day(-4), demo, '{}', day(-30), day(-4));
  idl.run('Веранда + беседка', 320000, 'new', c6, null, adminName, adminId, 'normal', null, dateOnly(16), null, demo, '{}', day(-6), day(-6));

  // позиции в сделках
  const dp = db.prepare('INSERT INTO deal_products(deal_id,product_id,name,price,qty) VALUES(?,?,?,?,?)');
  dp.run(d1, 2, 'Каркасный дом 8×10 «Север»', 2950000, 1);
  dp.run(d1, 7, 'Монтаж и отделка под ключ', 250000, 1);
  dp.run(d2, 1, 'Каркасный дом 6×8 «Летний»', 1850000, 1);
  dp.run(d3, 5, 'Баня каркасная 4×6', 890000, 1);
  dp.run(d4, 3, 'Каркасный дом 10×12 «Семейный»', 4100000, 1);

  // ── задачи: просроченная, на сегодня, будущие, повторяющаяся ──
  const qt = 'INSERT INTO tasks(title,type,due,priority,done,deal_id,contact_id,responsible_id,result,repeat,demo,created_at) VALUES(?,?,?,?,0,?,?,?,?,?,?,?)';
  const it = db.prepare(qt);
  it.run('Позвонить Ольге: уточнить этажность и участок', 'call', dueDay(0, '14:00'), 'high', d1, c1, adminId, '', 'none', demo, day(-1));
  it.run('Отправить смету Андрею', 'message', dueDay(-1, '12:00'), 'normal', d2, c2, adminId, '', 'none', demo, day(-2)); // просрочена
  it.run('Встреча на участке с Марией', 'meeting', dueDay(1, '11:00'), 'high', d4, c4, adminId, '', 'none', demo, day(0));
  it.run('Подготовить КП по бане для СтройМонтаж', 'other', dueDay(0, '16:00'), 'normal', d3, c3, adminId, '', 'none', demo, day(0));
  it.run('Еженедельный обзвон новых лидов', 'call', dueDay(0, '10:00'), 'low', null, null, adminId, '', 'weekly', demo, day(-7));
  it.run('Отправить чертёж террасы Елене', 'email', dueDay(3, '10:00'), 'normal', d5, c6, adminId, '', 'none', demo, day(-1));

  // ── чаты: WhatsApp, Telegram, почта — с историей ──
  const qcv = 'INSERT INTO conversations(contact_id,title,channels,channel_id,external_chat_id,chat_type,unread,assigned_id,demo,last_at) VALUES(?,?,?,?,?,?,?,?,?,?)';
  const icv = db.prepare(qcv);
  const cv1 = icv.run(c1, 'Ольга Соколова', 'whatsapp', 'ch-wa-1', '79161203456', 'whatsapp', 1, null, demo, day(0, '09:12')).lastInsertRowid;
  const cv2 = icv.run(c3, 'Дмитрий Лебедев', 'telegram', 'ch-tg-2', '-1001234567890', 'telegram', 0, null, demo, day(-1, '17:40')).lastInsertRowid;
  const cv3 = icv.run(c5, 'Сергей Волков', 'email', '', 'volkov@yandex.ru', 'email', 0, null, demo, day(-2, '15:05')).lastInsertRowid;
  // сообщения каскадно удаляются вместе с чатом — отдельная метка не нужна
  const qm = 'INSERT INTO messages(conversation_id,channel,direction,body,content_uri,status,external_id,author,subject,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)';
  const im = db.prepare(qm);
  im.run(cv1, 'whatsapp', 'in', 'Здравствуйте! Хочу каркасный дом 8×10 под ключ. Какая цена и сроки?', null, 'inbound', 'dm-1', '', null, day(0, '09:02'));
  im.run(cv1, 'whatsapp', 'out', 'Здравствуйте, Ольга! Отличный выбор. Дом 8×10 «Север» — 2 950 000 ₽, строительство от 6 недель. Подскажите, участок ровный?', null, 'sent', 'dm-2', adminName, null, day(0, '09:05'));
  im.run(cv1, 'whatsapp', 'in', 'Да, участок 15 соток, подъезд круглый год. Можно смету письмом?', null, 'inbound', 'dm-3', '', null, day(0, '09:12'));
  im.run(cv2, 'telegram', 'in', 'Нужна смета на баню 4×6 для нашего посёлка — серия из трёх штук', null, 'inbound', 'tg-1', '', null, day(-1, '17:30'));
  im.run(cv2, 'telegram', 'out', 'Дмитрий, добрый день! Баня 4×6 — 890 000 ₽, на серию дадем скидку. Пришлите адрес посёлка — подготовим КП.', null, 'sent', 'tg-2', adminName, null, day(-1, '17:40'));
  im.run(cv3, 'email', 'in', 'Интересует каркасный дом 8×8. Есть типовые проекты и прайс?', null, 'received', 'em-1', '', 'Расчёт дома 8×8', day(-2, '14:00'));
  im.run(cv3, 'email', 'out', 'Сергей, добрый день! Отправляю КП с проектом и ценами. Строим от 6 недель.', null, 'sent', 'em-2', adminName, 'КП: дом 8×8', day(-2, '15:05'));

  // ── заметки и активность ──
  db.prepare("INSERT INTO notes(entity_type,entity_id,body,author,demo) VALUES('contacts',?,?,?,?)").run(c1, 'Перезвонить после обеда: поинтересоваться выбором фундамента', adminName, demo);
  db.prepare("INSERT INTO activities(text,entity_type,entity_id,user_name) VALUES(?,?,?,?)").run('Демонстрационные данные загружены: клиенты, сделки, задачи, чаты', null, null, adminName);

  // ── конкуренты: карточки, проверки, отчёт, отзывы, прайсы ──
  const qk = 'INSERT INTO competitors(name,inn,ogrn,city,website,phone,notes,price_url,demo) VALUES(?,?,?,?,?,?,?,?,?)';
  const k1 = db.prepare(qk).run('ООО «БрусДом»', '7709876543', '1147746234567', 'Москва', 'brusdom.ru', '+7 495 123-45-67', 'Сильные отзывы, но цена выше нашей на 8%', '', demo).lastInsertRowid;
  const k2 = db.prepare(qk).run('ИП «СтройУют»', '500111223345', '314500000123456', 'Подольск', 'stroystroy.ru', '', 'Мелкий игрок, работает без договора', '', demo).lastInsertRowid;

  // проверки и отчёты каскадно удаляются с карточкой конкурента
  const qch = 'INSERT INTO competitor_checks(competitor_id,source,status,summary,payload) VALUES(?,?,?,?,?)';
  const ich = db.prepare(qch);
  ich.run(k1, 'rusprofile', 'ok', 'Найдено: ООО «БрусДом» · действующая', JSON.stringify({ source: 'rusprofile', title: 'Rusprofile', status: 'ok', summary: 'Найдено: ООО «БрусДом» · действующая', data: { card: { name: 'ООО «БрусДом»', inn: '7709876543', ogrn: '1147746234567', status: 'действующая', address: 'г Москва, ул Строителей, 12' } }, links: [] }));
  ich.run(k1, 'fssp', 'skipped', 'Не задан токен api-ip.fssprus.ru — суммы долгов доступны по ссылке', JSON.stringify({ source: 'fssp', title: 'ФССП (долги)', status: 'skipped', summary: 'Не задан токен FSSP', data: { productions: [] }, links: [] }));
  ich.run(k1, 'kad', 'ok', 'Найдено дел: 2', JSON.stringify({ source: 'kad', title: 'Арбитражные суды', status: 'ok', summary: 'Найдено дел: 2', data: { cases: [{ number: 'А40-123456/2025', date: '2025-11-04', type: 'исковое', sum: 120000, role: 'ответчик' }, { number: 'А40-789012/2024', date: '2024-06-18', type: 'административное', sum: 0, role: 'участник' }], total: 2 }, links: [] }));
  ich.run(k1, 'google', 'ok', 'Рейтинг 4.2 · 37 отзывов · г Москва', JSON.stringify({ source: 'google', title: 'Google Карты', status: 'ok', summary: 'Рейтинг 4.2 · 37 отзывов', data: { card: { name: 'БрусДом', address: 'г Москва', phone: '+7 495 123-45-67', rating: 4.2, count: 37 }, reviews: [{ author: 'Кирилл М.', rating: 5, text: 'Дом построили за 5 месяцев, бригада вежливая', url: '' }, { author: 'Анна С.', rating: 3, text: 'Смета выросла на 15% в процессе, но дом качественный', url: '' }] }, links: [] }));
  ich.run(k2, 'rusprofile', 'ok', 'Найдено: ИП «СтройУют» · действующая', JSON.stringify({ source: 'rusprofile', title: 'Rusprofile', status: 'ok', summary: 'Найдено: ИП «СтройУют»', data: { card: { name: 'ИП СтройУют', inn: '500111223345', status: 'действующая' } }, links: [] }));

  const qr = 'INSERT INTO competitor_reports(competitor_id,risk,level,verdict,payload) VALUES(?,?,?,?,?)';
  db.prepare(qr).run(k1, 42, 'умеренный',
    'Конкурент стабилен, но есть 2 арбитражных дела и недавний отзыв о росте сметы. Акцентируйте фиксированную цену в договоре и гарантию 10 лет. Наши цены ниже на аналогичных позициях.',
    JSON.stringify({ risk: 42, level: 'умеренный', noData: false, factors: [
      { type: 'risk', text: 'Арбитражные дела: 2', weight: 8, source: 'kad' },
      { type: 'risk', text: 'Сильная репутация: 4.2 из 5 (37 отзывов) — конкурент хорошо держит клиентов', weight: 8, source: 'reviews' },
      { type: 'info', text: 'Регистрация: 2014 · г Москва', weight: 0, source: 'fns' }],
      verdict: 'Конкурент стабилен, но есть 2 арбитражных дела и недавний отзыв о росте сметы.',
      talking_points: ['Аргумент: Арбитражные дела: 2 — используйте в переговорах', 'Аргумент: Сильная репутация — усильте преимуществом сервиса'],
      pricing: { pairs: [{ item: 'Каркасный дом 8×10', ours: 2950000, theirs: 3200000 }], avgDiff: -8, cheaper: 1, expensive: 0, ourSum: 2950000, theirSum: 3200000 },
      reviews: { avgRating: 4.2, totalReviews: 37, sources: {} },
      summary: ['Проверено источников: 3 из 4'], links: [], found: { inn: '7709876543', name: 'ООО «БрусДом»', address: 'г Москва, ул Строителей, 12' } }));
  db.prepare(qr).run(k2, 18, 'низкий', 'Мелкий игрок без задолженностей и судебных дел. Основной аргумент против — работа без договора и гарантии.',
    JSON.stringify({ risk: 18, level: 'низкий', noData: false, factors: [{ type: 'plus', text: 'Исполнительных производств нет', weight: -6, source: 'fssp' }], verdict: 'Мелкий игрок без долгов и судов.', talking_points: [], pricing: null, reviews: { avgRating: null, totalReviews: 0, sources: {} }, summary: ['Проверено источников: 1 из 4'], links: [], found: { inn: '500111223345', name: 'ИП СтройУют' } }));

  // отзывы каскадно удаляются с карточкой конкурента
  db.prepare("INSERT INTO reviews(competitor_id,source,rating,text,author,url) VALUES(?,?,?,?,?,?)")
    .run(k1, 'google', 5, 'Дом построили за 5 месяцев, бригада вежливая', 'Кирилл М.', '');
  db.prepare("INSERT INTO reviews(competitor_id,source,rating,text,author,url) VALUES(?,?,?,?,?,?)")
    .run(k1, 'google', 3, 'Смета выросла на 15% в процессе, но дом качественный', 'Анна С.', '');

  // наш прайс-лист отдельно не заполняем: это каталог (seedBase выше),
  // сравнение цен строится по нему — одной таблицей меньше, расхождений нет
  const qp = 'INSERT INTO price_rows(competitor_id,scope,item,price,unit,sku,note,source_name,demo) VALUES(?,?,?,?,?,?,?,?,?)';
  const ip = db.prepare(qp);
  ip.run(k1, 'competitor', 'Каркасный дом 8×10', 3200000, 'шт', '', '', 'прайс конкурента', demo);
  ip.run(k1, 'competitor', 'Баня 4×6', 990000, 'шт', '', '', 'прайс конкурента', demo);
  ip.run(k1, 'competitor', 'Терраса', 180000, 'шт', '', '', 'прайс конкурента', demo);

  return { contacts: 7, deals: 9, tasks: 6, conversations: 3, competitors: 2 };
}

export function demoCounts(db) {
  const c = t => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE demo=1`).get().n } catch { return 0 } };
  return { contacts: c('contacts'), deals: c('deals'), tasks: c('tasks'), conversations: c('conversations'), products: c('products'), templates: c('templates'), automations: c('automations'), competitors: c('competitors') };
}

export function cleanDemo(db) {
  // порядок важен: сначала зависимые таблицы без каскада
  let n = 0;
  const run = sql => { n += db.prepare(sql).run().changes; };
  db.exec('BEGIN IMMEDIATE');
  try {
    run('DELETE FROM tasks WHERE demo=1');
    run('DELETE FROM notes WHERE demo=1');
    run('DELETE FROM deals WHERE demo=1');          // deal_products уходит каскадом
    run('DELETE FROM conversations WHERE demo=1');  // сообщения уходит каскадом
    run('DELETE FROM contacts WHERE demo=1');
    run('DELETE FROM companies WHERE demo=1');
    run('DELETE FROM products WHERE demo=1');
    run('DELETE FROM templates WHERE demo=1');
    run('DELETE FROM automations WHERE demo=1');
    run('DELETE FROM reviews WHERE competitor_id IN (SELECT id FROM competitors WHERE demo=1)');
    run('DELETE FROM price_rows WHERE demo=1');
    run('DELETE FROM competitors WHERE demo=1');    // checks/reports уходят каскадом
    // служебная запись ленты активности тоже относится к демо-набору
    run("DELETE FROM activities WHERE text LIKE 'Демонстрационные данные загружены%'");
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return n;
}
