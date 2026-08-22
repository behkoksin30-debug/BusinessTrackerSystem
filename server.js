const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
// DATA_DIR 可以通过环境变量指定,配合 Railway 的 Volume(持久化卷)使用,
// 这样每次重新部署时数据不会丢失。本地开发不设置也没关系,默认存在项目目录下。
const DATA_DIR = process.env.DATA_DIR || __dirname;
const USERS_FILE = path.join(DATA_DIR, "users.json");

app.use(express.json({ limit: "6mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   账号系统:密码加密、用户读写、登录会话、权限中间件
   ============================================================ */

function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

function findUser(username) {
  return readUsers().find((u) => u.username === username);
}

// 登录会话存在内存里(服务器重启后需要重新登录,属于合理的简化做法)
const sessions = {}; // token -> username

function userDataDir(username) {
  return path.join(DATA_DIR, "users", username);
}

function userFilePath(username, filename) {
  return path.join(userDataDir(username), filename);
}

// 需要登录才能访问的接口,统一用这个中间件检查
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const username = token ? sessions[token] : null;
  if (!token || !username) {
    return res.status(401).json({ error: "未登录或登录已过期,请重新登录" });
  }
  const user = findUser(username);
  if (!user) {
    delete sessions[token];
    return res.status(401).json({ error: "账号不存在,请重新登录" });
  }
  req.user = { username: user.username, role: user.role };
  next();
}

// 决定这次请求实际要读/写"谁"的资料。
// allowViewAs=true 时(只有查看/GET 用),如果是管理员而且带了 ?viewAs=下线用户名,
// 而且这个下线确实是他自己开的账号,就改成读那个下线的资料(仍然只能读,不能写)。
function resolveDataUsername(req, allowViewAs) {
  if (allowViewAs && req.user.role === "admin" && req.query.viewAs) {
    const target = String(req.query.viewAs);
    const targetUser = findUser(target);
    if (targetUser && targetUser.upline === req.user.username) {
      return target;
    }
  }
  return req.user.username;
}

/* ============================================================
   账号相关 API(设置管理员、登录、登出、管理下线账号)
   ============================================================ */

// 检查是否已经有账号(决定前端要显示"设置管理员"还是"登录")
app.get("/api/auth/status", (req, res) => {
  const users = readUsers();
  res.json({ hasUsers: users.length > 0 });
});

// 第一次使用时,设置管理员(上线)账号。只有在完全没有账号时才能用这个接口。
app.post("/api/auth/setup", (req, res) => {
  const users = readUsers();
  if (users.length > 0) {
    return res.status(400).json({ error: "已经设置过管理员账号了" });
  }
  const { username, password } = req.body || {};
  if (!username || !username.trim() || !password || password.length < 4) {
    return res.status(400).json({ error: "请填写用户名,密码至少 4 位" });
  }
  const salt = generateSalt();
  const newUser = {
    username: username.trim(),
    salt,
    passwordHash: hashPassword(password, salt),
    role: "admin",
    upline: null,
    createdAt: new Date().toISOString(),
  };
  writeUsers([newUser]);
  const token = generateToken();
  sessions[token] = newUser.username;
  res.status(201).json({ token, username: newUser.username, role: newUser.role });
});

// 登录
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = findUser((username || "").trim());
  if (!user || hashPassword(password || "", user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: "用户名或密码不正确" });
  }
  const token = generateToken();
  sessions[token] = user.username;
  res.json({ token, username: user.username, role: user.role });
});

// 确认目前登录状态(前端刷新页面时用来检查 token 还有没有效)
app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// 登出
app.post("/api/auth/logout", authMiddleware, (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  delete sessions[token];
  res.status(204).end();
});

// 查看自己开的下线账号列表(只有管理员/上线能用)
app.get("/api/auth/downlines", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "没有权限" });
  }
  const users = readUsers();
  const downlines = users
    .filter((u) => u.upline === req.user.username)
    .map((u) => ({ username: u.username, createdAt: u.createdAt }));
  res.json(downlines);
});

// 新增一个下线账号(只有管理员/上线能用)
app.post("/api/auth/downlines", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "没有权限" });
  }
  const { username, password } = req.body || {};
  const cleanUsername = (username || "").trim();
  if (!cleanUsername || !password || password.length < 4) {
    return res.status(400).json({ error: "请填写用户名,密码至少 4 位" });
  }
  const users = readUsers();
  if (users.some((u) => u.username === cleanUsername)) {
    return res.status(400).json({ error: "这个用户名已经有人用了" });
  }
  const salt = generateSalt();
  const newUser = {
    username: cleanUsername,
    salt,
    passwordHash: hashPassword(password, salt),
    role: "downline",
    upline: req.user.username,
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  writeUsers(users);
  res.status(201).json({ username: newUser.username, createdAt: newUser.createdAt });
});

// 删除一个下线账号(只有管理员/上线能用,而且只能删自己开的)
app.delete("/api/auth/downlines/:username", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "没有权限" });
  }
  const users = readUsers();
  const target = users.find((u) => u.username === req.params.username);
  if (!target || target.upline !== req.user.username) {
    return res.status(404).json({ error: "未找到该下线账号" });
  }
  const filtered = users.filter((u) => u.username !== req.params.username);
  writeUsers(filtered);
  res.status(204).end();
});

/* ============================================================
   各种资料的读写函数(全部改成"每个账号自己一份")
   ============================================================ */

function sanitizePurchases(purchases) {
  if (!Array.isArray(purchases)) return [];
  return purchases
    .map((p) => ({
      date: p && p.date ? String(p.date).trim() : "",
      product: p && p.product ? String(p.product).trim() : "",
      amount: p && p.amount ? String(p.amount).trim() : "",
      note: p && p.note ? String(p.note).trim() : "",
    }))
    .filter((p) => p.date || p.product || p.amount || p.note);
}

function sanitizeFollowUps(followUps) {
  if (!Array.isArray(followUps)) return [];
  return followUps
    .map((f) => ({
      date: f && f.date ? String(f.date).trim() : "",
      note: f && f.note ? String(f.note).trim() : "",
    }))
    .filter((f) => f.date || f.note);
}

const VALID_CATEGORIES = ["new", "regular", "vip", "vvip"];
function sanitizeCategory(category) {
  return VALID_CATEGORIES.includes(category) ? category : "new";
}

const VALID_PROSPECT_STATUS = ["pending", "considering", "not_interested", "joined", "customer", "other_member", "unreachable"];
function sanitizeProspectStatus(status) {
  return VALID_PROSPECT_STATUS.includes(status) ? status : "pending";
}

const VALID_GENDERS = ["male", "female"];
function sanitizeGender(gender) {
  return VALID_GENDERS.includes(gender) ? gender : "";
}

const VALID_SAW_DEMO = ["yes", "no"];
function sanitizeSawDemo(val) {
  return VALID_SAW_DEMO.includes(val) ? val : "";
}

const VALID_PARTNER_TYPE = ["new_start", "builder", "leader"];
function sanitizePartnerType(val) {
  return VALID_PARTNER_TYPE.includes(val) ? val : "new_start";
}

// 新ABO清单项目:简单的勾选(是/否)
function sanitizeChecklistBool(val) {
  return val === true || val === "true";
}

function isValidDateOrEmpty(d) {
  return !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// 生日只需要月/日,不需要年份;兼容旧数据(YYYY-MM-DD)自动去掉年份部分
function toMonthDay(dateStr) {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr.slice(5);
  if (/^\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return "";
}

function isValidMonthDayOrEmpty(md) {
  if (!md) return true;
  return /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(md);
}

function migrateCustomer(c) {
  let next = c;
  if (!Array.isArray(next.purchases)) {
    // 兼容旧版本(单一 product / amount 字段),自动转换成购买记录数组
    const purchases = (next.product || next.amount)
      ? [{ date: "", product: next.product || "", amount: next.amount || "", note: "" }]
      : [];
    const { product, amount, ...rest } = next;
    next = { ...rest, purchases };
  }
  if (!next.category) {
    next = { ...next, category: "new" };
  }
  if (typeof next.gender !== "string") {
    next = { ...next, gender: "" };
  }
  if (typeof next.lastMeeting !== "string") {
    next = { ...next, lastMeeting: "" };
  }
  if (typeof next.sawDemo !== "string") {
    next = { ...next, sawDemo: "" };
  }
  if (typeof next.preference !== "string") {
    next = { ...next, preference: "" };
  }
  const migratedDate = toMonthDay(next.date);
  if (migratedDate !== next.date) {
    next = { ...next, date: migratedDate };
  }
  return next;
}

function readData(username) {
  try {
    const raw = fs.readFileSync(userFilePath(username, "data.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.map(migrateCustomer);
  } catch (e) {
    return [];
  }
}

function writeData(username, customers) {
  fs.mkdirSync(userDataDir(username), { recursive: true });
  fs.writeFileSync(userFilePath(username, "data.json"), JSON.stringify(customers, null, 2), "utf-8");
}

function readProspects(username) {
  try {
    const raw = fs.readFileSync(userFilePath(username, "prospects.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.map((p) => ({
      id: p.id,
      name: p.name || "",
      gender: sanitizeGender(p.gender),
      background: p.background || "",
      date: toMonthDay(p.date),
      phone: p.phone || "",
      oppDate: isValidDateOrEmpty(p.oppDate) ? (p.oppDate || "") : "",
      notes: p.notes || "",
      status: sanitizeProspectStatus(p.status),
      followUps: sanitizeFollowUps(p.followUps),
      rejectionReason: (p.rejectionReason || "").toString().trim(),
      createdAt: p.createdAt || "",
      updatedAt: p.updatedAt || p.createdAt || "",
    }));
  } catch (e) {
    return [];
  }
}

function writeProspects(username, prospects) {
  fs.mkdirSync(userDataDir(username), { recursive: true });
  fs.writeFileSync(userFilePath(username, "prospects.json"), JSON.stringify(prospects, null, 2), "utf-8");
}

function readBirthdays(username) {
  try {
    const raw = fs.readFileSync(userFilePath(username, "birthdays.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.map((b) => ({
      id: b.id,
      name: b.name || "",
      gender: sanitizeGender(b.gender),
      date: toMonthDay(b.date),
      phone: b.phone || "",
      notes: b.notes || "",
    }));
  } catch (e) {
    return [];
  }
}

function writeBirthdays(username, birthdays) {
  fs.mkdirSync(userDataDir(username), { recursive: true });
  fs.writeFileSync(userFilePath(username, "birthdays.json"), JSON.stringify(birthdays, null, 2), "utf-8");
}

// ---------- ABO(正式合伙人:名字/电话/ADA/生日/PIN/类型)----------

function readPartners(username) {
  try {
    const raw = fs.readFileSync(userFilePath(username, "partners.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.map((p) => ({
      id: p.id,
      name: p.name || "",
      phone: p.phone || "",
      ada: p.ada || "",
      date: toMonthDay(p.date),
      pin: p.pin || "",
      partnerType: sanitizePartnerType(p.partnerType),
      notes: p.notes || "",
      createdAt: p.createdAt || "",
      updatedAt: p.updatedAt || p.createdAt || "",
    }));
  } catch (e) {
    return [];
  }
}

function writePartners(username, partners) {
  fs.mkdirSync(userDataDir(username), { recursive: true });
  fs.writeFileSync(userFilePath(username, "partners.json"), JSON.stringify(partners, null, 2), "utf-8");
}

function partnerValidationError(body) {
  const { name, date } = body;
  if (!name || !name.trim()) return "姓名不能为空";
  if (date && !isValidMonthDayOrEmpty(date)) return "生日日期格式不正确";
  return null;
}

function buildPartnerFields(body) {
  const { name, phone, ada, date, pin, partnerType, notes } = body;
  return {
    name: name.trim(),
    phone: (phone || "").toString().trim(),
    ada: (ada || "").toString().trim(),
    date: toMonthDay(date),
    pin: (pin || "").toString().trim(),
    partnerType: sanitizePartnerType(partnerType),
    notes: (notes || "").toString().trim(),
  };
}

// ---------- 跟进对象(新ABO / 刚OPP完成的伙伴)----------

function readAbos(username) {
  try {
    const raw = fs.readFileSync(userFilePath(username, "abos.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.map((a) => ({
      id: a.id,
      name: a.name || "",
      gender: sanitizeGender(a.gender),
      phone: a.phone || "",
      class2: sanitizeChecklistBool(a.class2),
      hasList: sanitizeChecklistBool(a.hasList),
      watchedDemo: sanitizeChecklistBool(a.watchedDemo),
      visitedHQ: sanitizeChecklistBool(a.visitedHQ),
      centerMeeting: sanitizeChecklistBool(a.centerMeeting),
      houseMeeting: sanitizeChecklistBool(a.houseMeeting),
      abcUpline: sanitizeChecklistBool(a.abcUpline),
      audioListened: a.audioListened || "",
      meetingsAttended: a.meetingsAttended || "",
      currentStatus: a.currentStatus || "",
      notes: a.notes || "",
      createdAt: a.createdAt || "",
      updatedAt: a.updatedAt || a.createdAt || "",
    }));
  } catch (e) {
    return [];
  }
}

function writeAbos(username, abos) {
  fs.mkdirSync(userDataDir(username), { recursive: true });
  fs.writeFileSync(userFilePath(username, "abos.json"), JSON.stringify(abos, null, 2), "utf-8");
}

function aboValidationError(body) {
  const { name } = body;
  if (!name || !name.trim()) return "姓名不能为空";
  return null;
}

function buildAboFields(body) {
  const {
    name, gender, phone,
    class2, hasList, watchedDemo, visitedHQ, centerMeeting, houseMeeting, abcUpline,
    audioListened, meetingsAttended, currentStatus, notes,
  } = body;
  return {
    name: name.trim(),
    gender: sanitizeGender(gender),
    phone: (phone || "").toString().trim(),
    class2: sanitizeChecklistBool(class2),
    hasList: sanitizeChecklistBool(hasList),
    watchedDemo: sanitizeChecklistBool(watchedDemo),
    visitedHQ: sanitizeChecklistBool(visitedHQ),
    centerMeeting: sanitizeChecklistBool(centerMeeting),
    houseMeeting: sanitizeChecklistBool(houseMeeting),
    abcUpline: sanitizeChecklistBool(abcUpline),
    audioListened: (audioListened || "").toString().trim(),
    meetingsAttended: (meetingsAttended || "").toString().trim(),
    currentStatus: (currentStatus || "").toString().trim(),
    notes: (notes || "").toString().trim(),
  };
}

function birthdayValidationError(body) {
  const { name, date } = body;
  if (!name || !name.trim()) return "姓名不能为空";
  if (!date || !isValidMonthDayOrEmpty(date) || date.length !== 5) return "生日日期格式不正确";
  return null;
}

function buildBirthdayFields(body) {
  const { name, gender, date, phone, notes } = body;
  return {
    name: name.trim(),
    gender: sanitizeGender(gender),
    date: toMonthDay(date),
    phone: (phone || "").toString().trim(),
    notes: (notes || "").toString().trim(),
  };
}

function prospectValidationError(body) {
  const { name, date, oppDate } = body;
  if (!name || !name.trim()) return "姓名不能为空";
  if (!isValidMonthDayOrEmpty(date)) return "生日日期格式不正确";
  if (!isValidDateOrEmpty(oppDate)) return "日期格式不正确";
  return null;
}

function buildProspectFields(body) {
  const { name, gender, background, date, phone, oppDate, notes, status, followUps, rejectionReason } = body;
  return {
    name: name.trim(),
    gender: sanitizeGender(gender),
    background: (background || "").toString().trim(),
    date: toMonthDay(date),
    phone: (phone || "").toString().trim(),
    oppDate: isValidDateOrEmpty(oppDate) ? (oppDate || "") : "",
    notes: (notes || "").toString().trim(),
    status: sanitizeProspectStatus(status),
    followUps: sanitizeFollowUps(followUps),
    rejectionReason: (rejectionReason || "").toString().trim(),
  };
}

function validationError(body) {
  const { name, date } = body;
  if (!name || !name.trim()) return "姓名不能为空";
  if (date && !isValidMonthDayOrEmpty(date)) return "生日日期格式不正确";
  return null;
}

function buildCustomerFields(body) {
  const { name, date, phone, emoji, gender, purchases, notes, category, lastMeeting, sawDemo, preference } = body;
  return {
    name: name.trim(),
    date: toMonthDay(date),
    phone: (phone || "").toString().trim(),
    gender: sanitizeGender(gender),
    emoji: (emoji && emoji.trim()) || "",
    purchases: sanitizePurchases(purchases),
    notes: (notes || "").toString().trim(),
    category: sanitizeCategory(category),
    lastMeeting: isValidDateOrEmpty(lastMeeting) ? (lastMeeting || "") : "",
    sawDemo: sanitizeSawDemo(sawDemo),
    preference: (preference || "").toString().trim(),
  };
}

// ---------- Dashboard 展示区(海报 + 标语 + 公告)----------

function readDashboard(username) {
  try {
    const raw = fs.readFileSync(userFilePath(username, "dashboard.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return {
      poster: parsed.poster || "",
      tagline: parsed.tagline || "",
      announcement: parsed.announcement || "",
    };
  } catch (e) {
    return { poster: "", tagline: "", announcement: "" };
  }
}

function writeDashboard(username, data) {
  fs.mkdirSync(userDataDir(username), { recursive: true });
  const safe = {
    poster: (data.poster || "").toString(),
    tagline: (data.tagline || "").toString().trim(),
    announcement: (data.announcement || "").toString().trim(),
  };
  fs.writeFileSync(userFilePath(username, "dashboard.json"), JSON.stringify(safe, null, 2), "utf-8");
  return safe;
}

/* ============================================================
   顾客 API(全部需要登录;GET 支持上线用 ?viewAs= 查看下线资料,只读)
   ============================================================ */

app.get("/api/customers", authMiddleware, (req, res) => {
  res.json(readData(resolveDataUsername(req, true)));
});

app.post("/api/customers", authMiddleware, (req, res) => {
  const err = validationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const customers = readData(username);
  const now = new Date().toISOString();
  const newCustomer = { id: Date.now().toString(), ...buildCustomerFields(req.body), createdAt: now, updatedAt: now };
  customers.push(newCustomer);
  writeData(username, customers);
  res.status(201).json(newCustomer);
});

app.put("/api/customers/:id", authMiddleware, (req, res) => {
  const err = validationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const customers = readData(username);
  const idx = customers.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "未找到该记录" });
  customers[idx] = { id: customers[idx].id, ...buildCustomerFields(req.body), createdAt: customers[idx].createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  writeData(username, customers);
  res.json(customers[idx]);
});

app.delete("/api/customers/:id", authMiddleware, (req, res) => {
  const username = req.user.username;
  const customers = readData(username);
  const filtered = customers.filter((c) => c.id !== req.params.id);
  if (filtered.length === customers.length) return res.status(404).json({ error: "未找到该记录" });
  writeData(username, filtered);
  res.status(204).end();
});

/* ============================================================
   OPP 名单 API
   ============================================================ */

app.get("/api/prospects", authMiddleware, (req, res) => {
  res.json(readProspects(resolveDataUsername(req, true)));
});

app.post("/api/prospects", authMiddleware, (req, res) => {
  const err = prospectValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const prospects = readProspects(username);
  const now = new Date().toISOString();
  const newProspect = { id: Date.now().toString(), ...buildProspectFields(req.body), createdAt: now, updatedAt: now };
  prospects.push(newProspect);
  writeProspects(username, prospects);
  res.status(201).json(newProspect);
});

app.put("/api/prospects/:id", authMiddleware, (req, res) => {
  const err = prospectValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const prospects = readProspects(username);
  const idx = prospects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "未找到该记录" });
  prospects[idx] = { id: prospects[idx].id, ...buildProspectFields(req.body), createdAt: prospects[idx].createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  writeProspects(username, prospects);
  res.json(prospects[idx]);
});

app.delete("/api/prospects/:id", authMiddleware, (req, res) => {
  const username = req.user.username;
  const prospects = readProspects(username);
  const filtered = prospects.filter((p) => p.id !== req.params.id);
  if (filtered.length === prospects.length) return res.status(404).json({ error: "未找到该记录" });
  writeProspects(username, filtered);
  res.status(204).end();
});

/* ============================================================
   生日名单 API
   ============================================================ */

app.get("/api/birthdays", authMiddleware, (req, res) => {
  res.json(readBirthdays(resolveDataUsername(req, true)));
});

app.post("/api/birthdays", authMiddleware, (req, res) => {
  const err = birthdayValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const birthdays = readBirthdays(username);
  const newBirthday = { id: Date.now().toString(), ...buildBirthdayFields(req.body) };
  birthdays.push(newBirthday);
  writeBirthdays(username, birthdays);
  res.status(201).json(newBirthday);
});

app.put("/api/birthdays/:id", authMiddleware, (req, res) => {
  const err = birthdayValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const birthdays = readBirthdays(username);
  const idx = birthdays.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "未找到该记录" });
  birthdays[idx] = { id: birthdays[idx].id, ...buildBirthdayFields(req.body) };
  writeBirthdays(username, birthdays);
  res.json(birthdays[idx]);
});

app.delete("/api/birthdays/:id", authMiddleware, (req, res) => {
  const username = req.user.username;
  const birthdays = readBirthdays(username);
  const filtered = birthdays.filter((b) => b.id !== req.params.id);
  if (filtered.length === birthdays.length) return res.status(404).json({ error: "未找到该记录" });
  writeBirthdays(username, filtered);
  res.status(204).end();
});

/* ============================================================
   跟进对象(新ABO / 刚OPP完成的伙伴)API
   ============================================================ */

app.get("/api/abos", authMiddleware, (req, res) => {
  res.json(readAbos(resolveDataUsername(req, true)));
});

app.post("/api/abos", authMiddleware, (req, res) => {
  const err = aboValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const abos = readAbos(username);
  const now = new Date().toISOString();
  const newAbo = { id: Date.now().toString(), createdAt: now, updatedAt: now, ...buildAboFields(req.body) };
  abos.push(newAbo);
  writeAbos(username, abos);
  res.status(201).json(newAbo);
});

app.put("/api/abos/:id", authMiddleware, (req, res) => {
  const err = aboValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const abos = readAbos(username);
  const idx = abos.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "未找到该记录" });
  abos[idx] = { id: abos[idx].id, createdAt: abos[idx].createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), ...buildAboFields(req.body) };
  writeAbos(username, abos);
  res.json(abos[idx]);
});

app.delete("/api/abos/:id", authMiddleware, (req, res) => {
  const username = req.user.username;
  const abos = readAbos(username);
  const filtered = abos.filter((a) => a.id !== req.params.id);
  if (filtered.length === abos.length) return res.status(404).json({ error: "未找到该记录" });
  writeAbos(username, filtered);
  res.status(204).end();
});

/* ============================================================
   ABO(正式合伙人)API
   ============================================================ */

app.get("/api/partners", authMiddleware, (req, res) => {
  res.json(readPartners(resolveDataUsername(req, true)));
});

app.post("/api/partners", authMiddleware, (req, res) => {
  const err = partnerValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const partners = readPartners(username);
  const now = new Date().toISOString();
  const newPartner = { id: Date.now().toString(), ...buildPartnerFields(req.body), createdAt: now, updatedAt: now };
  partners.push(newPartner);
  writePartners(username, partners);
  res.status(201).json(newPartner);
});

app.put("/api/partners/:id", authMiddleware, (req, res) => {
  const err = partnerValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.user.username;
  const partners = readPartners(username);
  const idx = partners.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "未找到该记录" });
  partners[idx] = { id: partners[idx].id, ...buildPartnerFields(req.body), createdAt: partners[idx].createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  writePartners(username, partners);
  res.json(partners[idx]);
});

app.delete("/api/partners/:id", authMiddleware, (req, res) => {
  const username = req.user.username;
  const partners = readPartners(username);
  const filtered = partners.filter((p) => p.id !== req.params.id);
  if (filtered.length === partners.length) return res.status(404).json({ error: "未找到该记录" });
  writePartners(username, filtered);
  res.status(204).end();
});

/* ============================================================
   Dashboard 展示区 API
   ============================================================ */

app.get("/api/dashboard", authMiddleware, (req, res) => {
  res.json(readDashboard(resolveDataUsername(req, true)));
});

app.put("/api/dashboard", authMiddleware, (req, res) => {
  const saved = writeDashboard(req.user.username, req.body || {});
  res.json(saved);
});

app.listen(PORT, () => {
  console.log(`服务器已启动,监听端口 ${PORT}`);
});
