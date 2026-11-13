// Общая точка входа для проверок: первый администратор создаётся с временным
// паролем, который система требует заменить при первом входе. Проверки работают
// так же, как сотрудник, уже задавший личный пароль, поэтому временный
// заменяется здесь один раз и дальше используется новый токен.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_TMP = process.env.ADMIN_PASSWORD || 'admin1234567';
const ADMIN_PASS = process.env.ADMIN_PERSONAL || 'AdministratorPersonal2026';

// У каждого файла проверки свой помощник запросов, поэтому сюда передаются
// готовые действия, а не угадывается формат тела запроса.
function flow({ login, change, createUser }) {
  const body = r => r.body || r.data || r;
  async function firstLogin(email, password) {
    const got = body(await login(email, password));
    if (!got.token) throw new Error(`вход ${email} не удался: ${JSON.stringify(got)}`);
    return got;
  }
  async function changePassword(token, oldPassword, newPassword) {
    const got = body(await change(token, oldPassword, newPassword));
    if (!got.token) throw new Error('замена временного пароля не удалась: ' + JSON.stringify(got));
    return got.token;
  }
  return {
    ADMIN_EMAIL, ADMIN_TMP, ADMIN_PASS,
    // токен администратора с личным паролем
    async admin() {
      const first = await firstLogin(ADMIN_EMAIL, ADMIN_TMP);
      if (!first.user || !first.user.must_change_password) return first.token;
      return changePassword(first.token, ADMIN_TMP, ADMIN_PASS);
    },
    // токен сотрудника: временный пароль выдаёт администратор, личный задаёт сам
    // сотрудник при первом входе — ровно так это происходит в работе
    async employee(admin, user) {
      const created = body(await createUser(admin, user));
      if (!created.id) throw new Error('сотрудник не создан: ' + JSON.stringify(created));
      const first = await firstLogin(user.email, user.password);
      return {
        id: created.id,
        token: await changePassword(first.token, user.password, user.personal),
        password: user.personal,
        temporary: user.password,
      };
    },
    firstLogin,
    changePassword,
  };
}

module.exports = { ADMIN_EMAIL, ADMIN_TMP, ADMIN_PASS, flow };
