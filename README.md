# 🎵 Music Player

一个现代化的音乐播放器，支持在线播放、歌单管理、MV 播放等功能。采用 React + Vite 构建，支持Cloudflare Pages和Docker 部署。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18.3.1-blue.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4.8-646CFF.svg)](https://vitejs.dev/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-F38020.svg)](https://pages.cloudflare.com/)

### 技术栈

- **前端框架** - React 18
- **构建工具** - Vite
- **样式** - 原生 CSS
- **部署** - Docker + Cloudflare Pages


### 🎶 核心功能
- **在线音乐播放** - 支持多种音频格式
- **歌单管理** - 添加、删除、搜索歌曲
- **MV 播放** - 支持为歌曲添加 MV 链接
- **歌单导入** - 支持从 GitHub 仓库和 API 导入歌单
- **美化设置** - 自定义字体、背景图片
- **响应式设计** - 完美适配移动端和桌面端

## 🚀 快速开始

### Cloudflare Pages

1. 连接 GitHub 仓库到 Cloudflare Pages
2. 框架预设：`React (Vite)`
3. 添加环境变量
4. 部署完成

## ⚙️ 配置说明

### 环境变量

在项目根目录创建 `.env` 文件：

```env
VITE_GIT_REPO=username/repo
VITE_GIT_BRANCH=main
VITE_GIT_TOKEN=github-token
```

### 歌单配置

项目支持多种歌单配置方式：

1. **本地歌单** - 在 `public/music/` 目录放置音频文件
2. **GitHub 仓库** - 通过 GitHub API 导入歌单
3. **外部 API** - 支持自定义 API 接口导入

## 🎵 使用指南

### 添加歌曲

1. 点击右上角设置按钮
2. 填写歌曲信息：
   - 音频文件 URL
   - 歌名 - 歌手
   - MV 链接（可选）
3. 点击"添加歌曲"按钮

### 导入歌单

1. 选择导入方式：
   - **GitHub 仓库** - 从 GitHub 仓库导入
   - **API 接口** - 从外部 API 导入
2. 填写相关信息并导入

### 美化设置

1. 自定义选项：
   - **字体设置** - 选择喜欢的字体
   - **背景图片** - 设置自定义背景

## 添加新封面后，需要更新以下两个文件中的封面列表：

   **修改 `src/App.jsx`**：
   ```javascript
   // 第37行和第447行，更新 localPreferred 数组
   const localPreferred = ['a.png','b.png','c.png','d.png','e.png','f.png','g.png','h.png','j.png','k.png','l.png','m.png','n.png','o.png','p.png','q.png','r.png','s.png','t.png','u.png','v.png','w.png','x.png','y.png','z.png']
   ```

   **修改 `scripts/generate.mjs`**：
   ```javascript
   // 第58-60行，更新 preferredOrder 数组
   const preferredOrder = [
     'a.png','b.png','c.png','d.png','e.png','f.png','g.png','h.png','j.png','k.png','l.png','m.png','n.png','o.png','p.png','q.png','r.png','s.png','t.png','u.png','v.png','w.png','x.png','y.png','z.png'
   ]
   ```

## 📄 许可证

本项目基于 MIT 许可证开源 - 查看 [LICENSE](LICENSE) 文件了解详情。


⭐ 如果这个项目对您有帮助，请给一个星标！
