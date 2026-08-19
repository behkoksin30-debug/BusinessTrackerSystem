# 顾客生日簿

记录顾客姓名和生日的小工具,数据保存在服务器本地的 `data.json` 文件中。

## 本地运行

```bash
npm install
npm start
```

打开浏览器访问 `http://localhost:3000` 即可。

## 部署到 GitHub + Railway

### 第一步:上传到 GitHub

```bash
git init
git add .
git commit -m "初始提交:顾客生日簿"
```

然后在 GitHub 上新建一个空仓库(不要勾选自动生成 README),再执行:

```bash
git remote add origin https://github.com/你的用户名/仓库名.git
git branch -M main
git push -u origin main
```

### 第二步:部署到 Railway

1. 打开 [railway.app](https://railway.app),用 GitHub 账号登录
2. 点击 **New Project → Deploy from GitHub repo**
3. 选择刚才推送的仓库
4. Railway 会自动识别 `package.json`,执行 `npm install` 和 `npm start`
5. 部署完成后,在项目的 **Settings → Networking** 里点击 **Generate Domain**,即可获得一个公开访问的网址

几分钟内网站就能上线,之后每次 `git push` 到 GitHub,Railway 会自动重新部署。

## ⚠️ 关于数据存储的重要提醒

这个项目把顾客数据存在服务器本地的 `data.json` 文件里,这种方式**简单但不持久**:

- Railway 的文件系统在每次重新部署(比如你改代码再 push)时会被重置,`data.json` 里的数据也会跟着丢失
- 如果只是自己测试或短期使用,这样完全没问题
- 如果要长期正式使用,建议换成数据库存储数据,可以在 Railway 里免费加一个 **PostgreSQL** 或 **MySQL** 插件,这样数据就不会因为重新部署而丢失。需要的话可以告诉我,我可以帮你把存储方式改成数据库。

## 项目结构

```
birthday-app/
├── server.js         # 后端服务,提供增删查 API
├── public/
│   └── index.html    # 前端页面
├── package.json
└── data.json          # 顾客数据(运行后自动生成)
```
