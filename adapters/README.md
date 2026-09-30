# 在线音乐适配层（adapters）

本目录与主业务解耦：在线搜索 / 播放逻辑集中在此。上游 API 更换或失效时，优先只改本目录，避免大面积改动 `src/`。

## 当前接入

| 项       | 说明                                                |
| -------- | --------------------------------------------------- |
| 提供商   | [GD Studio](https://music-api.gdstudio.xyz/api.php) |
| 目录     | `adapters/gdstudio/`                                |
| 本站代理 | `GET /api/gdstudio`（浏览器不直连上游，避免 CORS）  |
| 入口     | `adapters/index.js`（业务侧应只依赖此文件）         |

### 目录说明

```
adapters/
  README.md               # 本文档
  index.js                # 对外入口（开关 + searchOnline）
  gdstudio/
    config.js             # ENABLED / BASE_URL / 音源 / 音质
    client.js             # 上游 search / url / pic / lyric
    mapper.js             # 映射为项目曲目 { title, url, cover }
    handler.js            # /api/gdstudio 服务端实现
    index.js              # 前端 searchOnline()
```

### 使用方式

1. 输入时先实时过滤**本地歌单**（防抖，不打在线 API）。
2. 按 **Enter** 后请求在线 API，与本地结果**合并**展示（本地在前，按 `url` 去重）。
3. 本地与在线都无结果时清空关键字并退出搜索。
4. 播放地址形如 `/api/gdstudio?types=play&source=...&id=...`，服务端解析真实链接后 302 到现有 `/api/audio`。

可调参数见 `gdstudio/config.js`：

| 配置                   | 含义                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `ENABLED`              | 总开关                                                                   |
| `BASE_URL`             | 上游 API 地址                                                            |
| `DEFAULT_SOURCE`       | 单次请求未指定源时的兜底                                                 |
| `AVAILABLE_SOURCES`    | 当前联通源：`netease` / `joox` / `bilibili`                              |
| `SEARCH_SOURCES`       | **在线搜索实际用的源（数组，可多选，并行合并）**；某一源失败不影响其它源 |
| `DEFAULT_SEARCH_COUNT` | 每页条数（默认 30）                                                      |
| `DEFAULT_SEARCH_PAGES` | 每个源拉几页（默认 2；改大即可要更多结果）                               |
| `DEFAULT_BITRATE`      | 默认音质                                                                 |

示例：只要更多结果 → 增大 `DEFAULT_SEARCH_PAGES`（如 `3`）或 `DEFAULT_SEARCH_COUNT`（如 `50`）。  
理论上限约：`源数量 × COUNT × PAGES`（去重后更少）。

---

## 临时关闭（API 不稳定时）

不必删代码，将任一处设为 `false` 即可，本地歌单不受影响：

1. `adapters/gdstudio/config.js` → `ENABLED = false`  
   或
2. 在 `adapters/index.js` 自行改导出（若以后封装统一开关）。

关闭后：在线搜索不再触发；`/api/gdstudio` 返回 503。

---

## API 失效后如何完整移除

按下面清单删除即可，主播放器 / 本地清单逻辑可保留。

### 1. 删除适配目录

```
adapters/                 # 整个目录（含本说明）
```

若只下线 GD Studio、还要留适配层骨架，可只删 `adapters/gdstudio/`，并改写或清空 `adapters/index.js`。

### 2. 删除各平台代理入口

| 文件                             |
| -------------------------------- |
| `api/gdstudio.js`                |
| `functions/api/gdstudio.js`      |
| `edge-functions/api/gdstudio.js` |

### 3. 去掉 `server.js` 中的挂载

删除：

- `import { handleGdstudioRequest } from './adapters/gdstudio/handler.js';`
- `app.get('/api/gdstudio', ...)` 整段路由

### 4. 去掉前端调用（`src/App.jsx`）

删除：

- `import { ENABLED as onlineSearchEnabled, searchOnline } from '../adapters';`
- `performSearch` 里「本地无匹配时调用 `searchOnline`」的分支（保留本地过滤与清空逻辑即可）

### 5. 还原搜索框文案（可选）

`src/components/SearchBar.jsx` 的 `placeholder` 若仍写着「本地无结果时按 Enter 在线搜」，改回例如：`搜索歌曲或歌手`。

### 6. 清理部署配置

**`vercel.json`**

- `headers` 中 `source` 为 `/api/gdstudio` 的整段
- `functions` 中的 `"api/gdstudio.js"` 配置

**`edgeone.json`**

- `functions` 中的 `"edge-functions/api/gdstudio.js"` 配置

### 7. 自检

全局搜索以下关键字，确认无残留：

- `gdstudio`
- `searchOnline`
- `onlineSearchEnabled`
- `/api/gdstudio`
- `from '../adapters'` / `from './adapters`

本地歌单、`/music.json`、收藏、上传删除等功能应与移除前一致。

---

## 更换为其他在线 API 时

1. 新建 `adapters/<新提供商>/`（可参考 `gdstudio/`）。
2. 在 `adapters/index.js` 改为导出新提供商的 `searchOnline` / `ENABLED`。
3. 曲目仍映射为 `{ title, url, cover? }`，`url` 建议继续走本站代理，这样 `Player` / `Audio` 无需大改。
4. 旧提供商目录与对应 `/api/...` 入口按上一节删除。
