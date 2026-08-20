const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
// DATA_DIR 可以通过环境变量指定,配合 Railway 的 Volume(持久化卷)使用,
// 这样每次重新部署时数据不会丢失。本地开发不设置也没关系,默认存在项目目录下。
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");
const PROSPECTS_FILE = path.join(DATA_DIR, "prospects.json");
const BIRTHDAYS_FILE = path.join(DATA_DIR, "birthdays.json");
const ABOS_FILE = path.join(DATA_DIR, "abos.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

const VALID_CATEGORIES = ["new", "regular", "vip"];
function sanitizeCategory(category) {
  return VALID_CATEGORIES.includes(category) ? category : "new";
}

const VALID_PROSPECT_STATUS = ["pending", "considering", "not_interested", "joined", "customer", "unreachable"];
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

// 通用的"是/否/不确定"三态字段,复用同一套校验规则(对产品有兴趣、关系健康等)
function sanitizeYesNo(val) {
  return VALID_SAW_DEMO.includes(val) ? val : "";
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

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.map(migrateCustomer);
  } catch (e) {
    return [];
  }
}

function writeData(customers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(customers, null, 2), "utf-8");
}

function readProspects() {
  try {
    const raw = fs.readFileSync(PROSPECTS_FILE, "utf-8");
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
      interested: sanitizeYesNo(p.interested),
      relationshipHealthy: sanitizeYesNo(p.relationshipHealthy),
    }));
  } catch (e) {
    return [];
  }
}

function writeProspects(prospects) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROSPECTS_FILE, JSON.stringify(prospects, null, 2), "utf-8");
}

function readBirthdays() {
  try {
    const raw = fs.readFileSync(BIRTHDAYS_FILE, "utf-8");
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

function writeBirthdays(birthdays) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BIRTHDAYS_FILE, JSON.stringify(birthdays, null, 2), "utf-8");
}

// ---------- 跟进对象(新ABO / 刚OPP完成的伙伴)----------

function readAbos() {
  try {
    const raw = fs.readFileSync(ABOS_FILE, "utf-8");
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
    }));
  } catch (e) {
    return [];
  }
}

function writeAbos(abos) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ABOS_FILE, JSON.stringify(abos, null, 2), "utf-8");
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
  const { name, gender, background, date, phone, oppDate, notes, status, followUps, interested, relationshipHealthy } = body;
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
    interested: sanitizeYesNo(interested),
    relationshipHealthy: sanitizeYesNo(relationshipHealthy),
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

// 获取所有顾客
app.get("/api/customers", (req, res) => {
  res.json(readData());
});

// 新增顾客
app.post("/api/customers", (req, res) => {
  const err = validationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const customers = readData();
  const newCustomer = {
    id: Date.now().toString(),
    ...buildCustomerFields(req.body),
  };
  customers.push(newCustomer);
  writeData(customers);
  res.status(201).json(newCustomer);
});

// 更新顾客(编辑所有字段)
app.put("/api/customers/:id", (req, res) => {
  const err = validationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const customers = readData();
  const idx = customers.findIndex((c) => c.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "未找到该顾客" });
  }
  customers[idx] = {
    id: customers[idx].id,
    ...buildCustomerFields(req.body),
  };
  writeData(customers);
  res.json(customers[idx]);
});

// 删除顾客
app.delete("/api/customers/:id", (req, res) => {
  const customers = readData();
  const filtered = customers.filter((c) => c.id !== req.params.id);
  if (filtered.length === customers.length) {
    return res.status(404).json({ error: "未找到该顾客" });
  }
  writeData(filtered);
  res.status(204).end();
});

// ---------- OPP 名单(讲 OPP 后的联系人)----------

// 获取所有 OPP 名单
app.get("/api/prospects", (req, res) => {
  res.json(readProspects());
});

// 新增 OPP 名单
app.post("/api/prospects", (req, res) => {
  const err = prospectValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const prospects = readProspects();
  const newProspect = {
    id: Date.now().toString(),
    ...buildProspectFields(req.body),
  };
  prospects.push(newProspect);
  writeProspects(prospects);
  res.status(201).json(newProspect);
});

// 更新 OPP 名单
app.put("/api/prospects/:id", (req, res) => {
  const err = prospectValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const prospects = readProspects();
  const idx = prospects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "未找到该记录" });
  }
  prospects[idx] = {
    id: prospects[idx].id,
    ...buildProspectFields(req.body),
  };
  writeProspects(prospects);
  res.json(prospects[idx]);
});

// 删除 OPP 名单
app.delete("/api/prospects/:id", (req, res) => {
  const prospects = readProspects();
  const filtered = prospects.filter((p) => p.id !== req.params.id);
  if (filtered.length === prospects.length) {
    return res.status(404).json({ error: "未找到该记录" });
  }
  writeProspects(filtered);
  res.status(204).end();
});

// ---------- 生日名单(不一定是顾客,任何人的生日)----------

// 获取所有生日名单
app.get("/api/birthdays", (req, res) => {
  res.json(readBirthdays());
});

// 新增生日
app.post("/api/birthdays", (req, res) => {
  const err = birthdayValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const birthdays = readBirthdays();
  const newBirthday = {
    id: Date.now().toString(),
    ...buildBirthdayFields(req.body),
  };
  birthdays.push(newBirthday);
  writeBirthdays(birthdays);
  res.status(201).json(newBirthday);
});

// 更新生日
app.put("/api/birthdays/:id", (req, res) => {
  const err = birthdayValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const birthdays = readBirthdays();
  const idx = birthdays.findIndex((b) => b.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "未找到该记录" });
  }
  birthdays[idx] = {
    id: birthdays[idx].id,
    ...buildBirthdayFields(req.body),
  };
  writeBirthdays(birthdays);
  res.json(birthdays[idx]);
});

// 删除生日
app.delete("/api/birthdays/:id", (req, res) => {
  const birthdays = readBirthdays();
  const filtered = birthdays.filter((b) => b.id !== req.params.id);
  if (filtered.length === birthdays.length) {
    return res.status(404).json({ error: "未找到该记录" });
  }
  writeBirthdays(filtered);
  res.status(204).end();
});

// ---------- 跟进对象(新ABO / 刚OPP完成的伙伴)----------

// 获取所有跟进对象
app.get("/api/abos", (req, res) => {
  res.json(readAbos());
});

// 新增跟进对象
app.post("/api/abos", (req, res) => {
  const err = aboValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const abos = readAbos();
  const newAbo = {
    id: Date.now().toString(),
    ...buildAboFields(req.body),
  };
  abos.push(newAbo);
  writeAbos(abos);
  res.status(201).json(newAbo);
});

// 更新跟进对象
app.put("/api/abos/:id", (req, res) => {
  const err = aboValidationError(req.body);
  if (err) return res.status(400).json({ error: err });
  const abos = readAbos();
  const idx = abos.findIndex((a) => a.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "未找到该记录" });
  }
  abos[idx] = {
    id: abos[idx].id,
    ...buildAboFields(req.body),
  };
  writeAbos(abos);
  res.json(abos[idx]);
});

// 删除跟进对象
app.delete("/api/abos/:id", (req, res) => {
  const abos = readAbos();
  const filtered = abos.filter((a) => a.id !== req.params.id);
  if (filtered.length === abos.length) {
    return res.status(404).json({ error: "未找到该记录" });
  }
  writeAbos(filtered);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`顾客记录系统已启动: http://localhost:${PORT}`);
  console.log(`[诊断] DATA_DIR 环境变量原始值: ${process.env.DATA_DIR || "(未设置)"}`);
  console.log(`[诊断] 实际使用的数据目录: ${DATA_DIR}`);
  console.log(`[诊断] 顾客数据文件路径: ${DATA_FILE}`);
  try {
    const exists = fs.existsSync(DATA_FILE);
    console.log(`[诊断] 该文件是否存在: ${exists}`);
    if (exists) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      console.log(`[诊断] 该文件里的顾客数量: ${parsed.length}`);
    }
  } catch (e) {
    console.log(`[诊断] 读取文件时出错: ${e.message}`);
  }
});
