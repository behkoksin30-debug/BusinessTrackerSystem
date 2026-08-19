const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
// DATA_DIR 可以通过环境变量指定,配合 Railway 的 Volume(持久化卷)使用,
// 这样每次重新部署时数据不会丢失。本地开发不设置也没关系,默认存在项目目录下。
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function sanitizePurchases(purchases) {
  if (!Array.isArray(purchases)) return [];
  return purchases
    .map((p) => ({
      date: p && p.date ? String(p.date).trim() : "",
      product: p && p.product ? String(p.product).trim() : "",
      amount: p && p.amount ? String(p.amount).trim() : "",
    }))
    .filter((p) => p.date || p.product || p.amount);
}

function migrateCustomer(c) {
  if (Array.isArray(c.purchases)) return c;
  // 兼容旧版本(单一 product / amount 字段),自动转换成购买记录数组
  const purchases = (c.product || c.amount)
    ? [{ date: "", product: c.product || "", amount: c.amount || "" }]
    : [];
  const { product, amount, ...rest } = c;
  return { ...rest, purchases };
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

function validationError(body) {
  const { name, date } = body;
  if (!name || !name.trim()) return "姓名不能为空";
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "生日日期格式不正确";
  return null;
}

function buildCustomerFields(body) {
  const { name, date, phone, emoji, purchases, notes } = body;
  return {
    name: name.trim(),
    date,
    phone: (phone || "").toString().trim(),
    emoji: (emoji && emoji.trim()) || "🎂",
    purchases: sanitizePurchases(purchases),
    notes: (notes || "").toString().trim(),
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

app.listen(PORT, () => {
  console.log(`顾客生日系统已启动: http://localhost:${PORT}`);
});
