# 顾客记录

记录顾客的姓名、生日、电话、购买记录与备注,数据保存在服务器本地的 `data.json` 文件中。

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
git commit -m "初始提交:顾客记录"
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

## ⚠️ 让数据不会因为重新部署而丢失(必做)

Railway 每次重新部署都会重置文件系统,所以要给项目挂一个**持久化卷(Volume)**,数据才会一直保留:

1. 打开你的 Railway 项目,进入这个服务的 **Settings → Volumes**
2. 点击 **New Volume**
3. **Mount path** 填 `/data`(随便叫什么名字都行,路径要填 `/data`)
4. 再打开 **Variables**,新增一个环境变量:`DATA_DIR` = `/data`
5. 保存后 Railway 会自动重新部署一次

设置好之后,顾客数据会一直存在 `/data/data.json` 里,不会再因为你改代码重新部署而消失。这一步只需要做一次,以后每次 `git push` 部署都不会受影响。

本地开发不用设置 `DATA_DIR`,数据会照常存在项目目录下的 `data.json`。

## 📱 把网站变成手机上的"App"图标

现在网站已经支持"添加到主屏幕",效果就像一个真正的 App:有自己的图标、打开后没有浏览器网址栏,全屏显示。

**iPhone(Safari 浏览器):**
1. 用 Safari 打开你的网站
2. 点底部的分享图标(方框加箭头↑)
3. 往下滑,点 **添加到主屏幕**
4. 点右上角 **添加**

**安卓(Chrome 浏览器):**
1. 用 Chrome 打开你的网站
2. 点右上角的 **⋮** 菜单
3. 点 **添加到主屏幕** 或 **安装应用**
4. 确认添加

添加后主屏幕上会出现一个顾客记录图标,点开就跟打开一个 App 一样。

## 项目结构

```
birthday-app/
├── server.js               # 后端服务,提供增删查 API
├── public/
│   ├── index.html           # 前端页面
│   ├── manifest.json        # PWA 配置(让网站可以添加到主屏幕)
│   ├── icon-192.png          # App 图标
│   ├── icon-512.png          # App 图标(大尺寸)
│   └── apple-touch-icon.png  # iPhone 专用图标
├── package.json
└── data.json                # 顾客数据(运行后自动生成)
```
