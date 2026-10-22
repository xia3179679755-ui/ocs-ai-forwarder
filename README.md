# OCS 题库 AI 答题本地转发

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://github.com/xia3179679755-ui/ocs-ai-forwarder)
[![Dependencies](https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-0-success)](https://github.com/xia3179679755-ui/ocs-ai-forwarder)
[![AI Deploy](https://img.shields.io/badge/%E9%83%A8%E7%BD%B2-AI%20%E4%B8%80%E9%94%AE%E4%BB%A3%E5%8A%9E-8A2BE2)](https://github.com/xia3179679755-ui/ocs-ai-forwarder/blob/main/AGENT_SETUP_PROMPT.md)
[![Local](https://img.shields.io/badge/%E4%BB%85%E6%9C%AC%E5%9C%B0-127.0.0.1-0078D6)](https://github.com/xia3179679755-ui/ocs-ai-forwarder)

一个极小的本地 HTTP 服务，把 [OCS（Online Course Script，网课助手）](https://github.com/ocsjs/ocsjs)题库的答题请求转发给任意 OpenAI 兼容的 AI 接口，并把模型返回的答案转换成 OCS 能直接选中的格式。

适用场景：给 OCS 的自定义题库接上 AI 自动答题。服务跑在本机 `http://127.0.0.1:8765`，不依赖任何公网中转，密钥只保存在你自己的 `.env` 里。

> **🤖 不想自己动手？** 本仓库内置了一份完整的 AI 部署提示词——复制、粘贴、回答三个问题，剩下全部交给 AI 智能体完成。见下方 [AI 一键部署](#ai-一键部署推荐)。

## 功能特性

- 🔌 **任意 OpenAI 兼容接口**：填地址 + 密钥 + 模型名即可接入
- 🪜 **阶梯链调度**：主模型超时/报错/答案不匹配时自动切备用模型，备用档拿完整时间预算
- 🖼️ **图片题支持**：走独立的多模态模型链，不拖累主链
- 🛡️ **答案校验**：答案不在选项范围内就判失败，绝不伪造答案
- 📦 **零依赖**：仅 Node.js 内置模块，装好 Node 就能跑，不需要 `npm install`
- 🔒 **本地优先**：只监听 `127.0.0.1`，密钥不进仓库、不进日志、不进 git

## AI 一键部署（推荐）

把部署这件事整个交给一个会操作电脑的 AI 智能体（Cursor、Codex、Claude Code、通义灵码等均可），全程你只需要回答它的问题。

### 你需要提前准备的三样东西

| 项目 | 示例 | 去哪拿 |
| --- | --- | --- |
| API 地址 | `https://example.com/v1` | 你的 AI 服务商控制台 |
| API 密钥 | `sk-...` | 同上 |
| 模型名 | 主模型 / 备用模型 / 图片模型 | 服务商的模型列表页（不确定也行，AI 会帮你查询） |

### 部署四步

1. **复制提示词**：打开 [`AGENT_SETUP_PROMPT.md`](AGENT_SETUP_PROMPT.md)，复制其中代码框里的完整提示词，并把开头的 `{仓库地址}` 替换为 `https://github.com/xia3179679755-ui/ocs-ai-forwarder.git`。
2. **发给 AI**：粘贴给任意能操作本地文件和终端的 AI 智能体。
3. **回答提问**：AI 会向你确认 API 地址、密钥、模型名等配置——**提示词禁止它猜测**，你按提问提供即可。不知道有哪些模型时，它会通过 `/models` 接口拉取列表让你选。
4. **填 OCS 配置**：AI 验证通过后会把题库配置输出给你，粘贴进 OCS 保存启用即可。

### AI 会自动完成的事

clone 代码 → 检查 Node.js 18+ → 向你询问配置 → 写 `.env` → 跑单元测试 → 启动服务 → 用 curl 端到端验证判断题/单选题/多选题 → 创建桌面快捷方式 → 输出 OCS 题库配置和最终报告。

### 安全边界（已写死在提示词里）

- AI 只在你指定的目录操作，不扫描、不删除无关文件
- 密钥只能写入本机 `.env`（已被 `.gitignore` 排除），不进源码、日志、git 提交或聊天回显
- 不许修改监听地址（保持 `127.0.0.1`）、不许伪造模型名、不许提交 `.env`
- 需要管理员权限或联网安装时会先征求你同意，不绕过安全确认

> 不放心可以让 AI 一边执行一边汇报——提示词要求它每个阶段汇报真实命令结果，不许假装成功。

## OCS 题库配置

把下面这段填进 OCS 的自定义题库设置（设置 → 题库 → 自定义题库 → 新增）：

```json
[
  {
    "name": "OCS AI 本地转发",
    "url": "http://127.0.0.1:8765/answer",
    "method": "post",
    "contentType": "json",
    "type": "fetch",
    "headers": {
      "Content-Type": "application/json"
    },
    "data": {
      "title": "${title}",
      "type": "${type}",
      "options": "${options}",
      "images": { "handler": "return (env)=> env.images || []" }
    },
    "handler": "return (res) => res.code === 1 ? [res.question, res.answer] : undefined"
  }
]
```

`ocs-answerer-config.js` 里是同一份内容，可以直接复制。

因为请求指向本地，脚本管理器会拦截。需要二选一：

- 在脚本头部加 `// @connect 127.0.0.1`，或
- 在脚本管理器的连接白名单里放行 `127.0.0.1`

---

## 方式二：手动部署（备选）

AI 不方便用时，手动从零到能用全步骤如下，大约 10 分钟。以 Windows 为主，macOS / Linux 差异单独标注。

### 1. 系统要求

- Windows 10/11、macOS 或任意主流 Linux；
- Node.js **18 或更高**（本服务零第三方依赖，装好 Node 就够了，不需要 `npm install`）；
- 一个 OpenAI 兼容的 AI 接口：接口地址 + API 密钥 + 至少一个支持 Chat Completions 的模型名；
- 如果你想让带图片的题目也能答，还需要一个**支持图片输入的多模态模型**。

### 2. 安装 Node.js

1. 打开 https://nodejs.org/ 下载 **LTS 版本**安装包（Windows 选 `.msi`）。
2. 一路下一步安装。安装完成后**新开一个终端窗口**（按 `Win + R`，输入 `cmd` 回车），运行：

   ```bash
   node --version
   ```

   显示 `v18` 及以上（例如 `v22.22.2`）即成功。
3. 如果提示「不是内部或外部命令」，说明终端还是旧窗口，重开一个；还不行就重启电脑再试。

### 3. 下载本仓库

二选一：

**A. 用 Git（推荐，以后更新方便）**

```bash
git clone https://github.com/xia3179679755-ui/ocs-ai-forwarder.git
cd ocs-ai-forwarder
```

没装 Git 就去 https://git-scm.com/downloads 装一个。

**B. 直接下载 ZIP**

打开仓库页面 → 绿色 `Code` 按钮 → `Download ZIP` → 解压到任意目录（**路径里最好不要有中文和空格**，例如 `D:\ocs-ai-forwarder`），终端里 `cd` 进这个目录。

### 4. 创建并填写 `.env`

`.env` 是唯一的配置文件，里面放你的密钥和模型，**永远不会进仓库**。

**Windows**：直接双击 `start.cmd`，它会自动复制 `.env.example` 为 `.env` 并用记事本打开；或者手动复制 `.env.example` 改名为 `.env`。

**macOS / Linux**：

```bash
cp .env.example .env
```

然后用任意编辑器打开 `.env`，至少填好这几项：

```ini
MOLLY_API_KEY=你的密钥
MOLLY_BASE_URL=https://你的接口地址/v1
MOLLY_CHAIN=<强模型>:max:90000,<备用模型>:medium:30000
MOLLY_CHAIN_IMAGES=<支持图片的模型>:medium:60000
```

注意：

- `MOLLY_BASE_URL` 通常以 `/v1` 结尾（以你的服务商文档为准）。
- 模型名填你在该服务商「模型广场 / 模型列表」里看到的**确切名字**。**本仓库不预设任何模型，也不会帮你猜。** 不知道有哪些模型可填时，可以用 curl 访问 `GET 你的接口地址/models`（带上密钥）查看列表：

  ```bash
  curl -H "Authorization: Bearer 你的密钥" https://你的接口地址/v1/models
  ```

- `MOLLY_CHAIN` 的格式是 `模型名:思考强度:超时毫秒`，逗号分隔可写多档：
  - 第一档先跑，用满它自己的超时（例 90 秒）；
  - 第一档**超时、报错、或答案不在选项里**，自动切第二档（备用模型）；
  - 第二档拿到**完整的预算**，不是第一档剩下的时间。
- 只想要一个模型，就只写一段：`MOLLY_CHAIN=<强模型>:max:90000`。
- 不答图片题可以把 `MOLLY_CHAIN_IMAGES` 留空，会自动复用主链。

其余项保持默认即可（各项含义见下文「配置说明」）。保存并关闭文件。

### 5. 启动服务

**Windows**：双击项目目录里的 `start.cmd`，出现黑窗口并打印 `server_started` 即启动成功。

**macOS / Linux / 任意终端**：

```bash
node src/run.mjs
```

**保持这个窗口开着**——关掉窗口就等于停掉服务，答题期间不能关。

> 也可以先跑一遍测试确认代码没问题：`node --test test/*.test.mjs`。

### 6. 验证服务是否正常

**新开一个终端窗口**（原来的窗口被服务占着），依次执行：

```bash
curl http://127.0.0.1:8765/health
```

应返回 `{"ok":true,"service":"ocs-ai-forwarder"}`。

> 本机设置了 HTTP 代理的话，curl 请加 `--noproxy "*"`，否则会被代理拦下返回 502。

再发一道单选题做端到端验证：

```bash
curl -X POST http://127.0.0.1:8765/answer --noproxy "*" -H "Content-Type: application/json" -d "{\"title\":\"1+1等于几？\",\"type\":\"single\",\"options\":\"A. 1\\nB. 2\\nC. 3\"}"
```

应返回 `{"code":1,...,"answer":"B"}`。如果返回 `code:0`，去看 `logs\当天日期.log` 里 `[失败]` `[解析]` 那几行，通常是密钥、地址或模型名填错了。

### 7. 配置 OCS

1. 打开 OCS 设置 → 题库 → 自定义题库，把「OCS 题库配置」那段 JSON（或 `ocs-answerer-config.js` 的内容）粘贴进去，保存并启用。
2. 放行本地连接，二选一：
   - 在 OCS 脚本头部加一行 `// @connect 127.0.0.1`；或
   - 在脚本管理器（Tampermonkey 等）的「跨域请求 / 连接白名单」里放行 `127.0.0.1`。
3. 进学习通等课程的答题页面，OCS 查题时会走本地 AI。第一次请求浏览器可能弹出「允许访问 127.0.0.1」的确认，点允许。

### 8. 创建桌面快捷方式（日常使用）

- 在文件管理器里右键 `start.cmd` → 发送到 → 桌面快捷方式；或
- 手动新建快捷方式，目标填 `start.cmd` 的**绝对路径**，「起始位置」填项目目录——**起始位置必须填**，否则读不到 `.env`。

以后双击桌面图标启动即可。**窗口开着服务就在跑，关窗口就是停服务。**

### 9. 卸载 / 更新

- 卸载：删除项目文件夹和桌面快捷方式即可，`.env` 里的密钥随文件夹一起删除。
- 更新：`git pull` 后重开 `start.cmd`（ZIP 下载的就重新下载解压覆盖）。

---

## 配置说明

所有配置都在 `.env` 里：

| 变量 | 说明 |
| --- | --- |
| `MOLLY_API_KEY` | 上游接口密钥。**不会进仓库，也不会写进日志** |
| `MOLLY_BASE_URL` | 上游地址，通常是 `https://xxx/v1` |
| `MOLLY_CHAT_PATH` | 请求路径，默认 `/chat/completions` |
| `MOLLY_CHAIN` | 答题阶梯链，见下 |
| `MOLLY_CHAIN_IMAGES` | 图片题专用链，留空复用主链 |
| `MOLLY_PROBE` | 难度探针，留空关闭 |
| `MOLLY_MAX_TOKENS` | 限制输出长度，默认 64 |
| `TOTAL_TIMEOUT_MS` | 单题总预算，默认 150 秒 |
| `MOLLY_CACHE_TTL_MS` | 答案缓存时长，默认 30 分钟，0 关闭 |
| `MOLLY_SERIALIZE` | 1=上游请求排队，OCS 关不掉并发时用 |
| `PORT` | 监听端口，默认 8765 |

### 答题阶梯链（含失败备用）

`MOLLY_CHAIN` 是唯一的调度来源。每档写成 `模型:思考强度:超时毫秒`，逗号分隔：

```ini
MOLLY_CHAIN=<强模型>:max:90000,<备用模型>:medium:30000
```

- 第一档先跑，用满 90 秒；
- 第一档**超时、报错、或答案不在选项里**，就自动切到第二档；
- 第二档是备用模型，拿到**完整的 30 秒预算**，不是第一档剩下的时间；
- 任何时刻只有一个请求在跑，一题不会花两份 token。

思考强度可以写 `low` / `medium` / `high` / `max`，或 `auto`（按难度探针的结果选）。注意：**不传这个参数不等于自动**，多数上游会走它自己的默认档，往往比 `medium` 更慢。

### 图片题

新版 OCS 会把题目里的图片抽成 base64 单独传，题干里留下 `[图片1]`、`[图片2]` 这样的占位符。题库配置里要把图片传出来（上文的配置已包含）：

```json
"data": {
  "title": "${title}",
  "type": "${type}",
  "options": "${options}",
  "images": { "handler": "return (env)=> env.images || []" }
}
```

服务收到 `images` 后会按 OpenAI 兼容的多模态格式把图片随题发出去，顺序与 `[图片N]` 的编号一一对应。答案里如果带 `[图片N]`，OCS 会自动还原成图片。

**注意两点：**

1. **不是每个模型都支持图片输入。** 实测下来差异很大：

   | 表现 | 说明 |
   | --- | --- |
   | 正常返回 | 接受 `image_url` 并作答 |
   | 直接断开连接 | 收到图片就 `fetch failed`，既不返回 200 也不返回 400 |

   所以图片题要走单独的链 `MOLLY_CHAIN_IMAGES`，别和主链混在一起——主链模型如果不支持图片，会白白等到超时。

2. **公式题目前无解。** OCS 没有公式相关的接口，公开文档和 CHANGELOG 里都没有对应字段。

日志里会用 `[题目] 图片=N张` 标出，并在 `[原始]` 里只记图片数量和体积（base64 直接进日志会刷屏）。

### 难度探针（默认关闭）

```ini
MOLLY_PROBE=<快模型>:minimal:12000
```

先让快模型判断这题该想多深，再让正式模型按这个深度作答。

**默认关闭**，因为它只在探针本身很快（1-3 秒）时才划算。实测在某些上游，最低思考档的探针请求也要 28-56 秒，比直接答题还慢，纯属浪费。只有当你确认上游响应很快时才打开它。

## 工作原理

```
OCS 发来一道题 → 查缓存 / 合并同题 → 调用上游模型 → 解析并对齐选项 → 返回答案
```

每一环的细节：

- **无状态**：每次请求只带当前这一题，没有对话历史，跑多久都不会变慢。
- **选项对齐**：选项自带字母（`A. 正确`）就返回字母；选项没字母（`对` / `错`）就返回**选项原文**。OCS 是按文字匹配的，返回错误的格式会选不中。
- **多选**：返回 `A#C` 形式；选项没字母时返回 `选项一#选项二`。
- **答案校验**：答案不在选项范围内就判失败，绝不伪造。
- **网络重试**：连接被上游中断（`fetch failed`）不等于没答出来，会立刻重发一次，且重发用的是该档剩余时间，不会把预算翻倍。
- **断开也继续算**：OCS 超时断开后，服务端仍会把答案算完并写入缓存，下次重试直接秒回。

## 协议端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/answer` | 答题主接口 |
| `OPTIONS` | `/answer` | 跨域预检，返回 204 |
| `HEAD` | 任意 | OCS 延迟探测，返回 200 空正文 |
| `GET` | `/health` | 健康检查 |

## 日志

终端的每一行都会同时写入 `logs\YYYY-MM-DD.log`，关掉窗口也不会丢。Windows 下双击 `查看日志.cmd` 可用记事本打开当天的日志。

一次答题会打印：

1. `[本地]` 收到请求
2. `[原始]` OCS 发来的完整 JSON（排查格式问题用）
3. `[题目]` 题型、难度、将执行的链
4. `[请求]` 第几档、模型、思考强度、超时
5. `[失败]` 超时或上游错误
6. `[解析]` 原始返回、采用答案、是否匹配选项
7. `[返回]` 最终答案和总耗时

所有日志都会自动抹掉 `Bearer xxx` 和 `sk-xxx` 形态的密钥。

## 常见问题

**OCS 提示「没有匹配的选项」**
看日志的 `[解析]` 行。如果「可匹配=否」，说明模型给的答案不在题目选项里，服务会拒绝返回（宁可不答也不乱选）。

**一直超时**
上游延迟本身波动很大，同一道题 3 秒到 70 秒都可能出现。把 `MOLLY_CHAIN` 第一档的超时调大（例如 90000），而不是切到别的模型。切模型不会让上游变快。

**同时答几道题会明显变慢**
实测同一道题单独请求 11.9 秒，两道题同时请求会拖到 65 秒超时。在 OCS 里关掉并发，或设置 `MOLLY_SERIALIZE=1` 让上游请求排队。

**带图片的题答不了 / fetch failed**
主链模型大概率不支持图片输入。把 `MOLLY_CHAIN_IMAGES` 单独配成一个确认支持多模态的模型。

**服务跑久了会不会变慢**
不会。每次请求独立无状态，输入 token 数量恒定。

## 开发

```bash
node --test test/*.test.mjs
```

零第三方依赖，只用 Node.js 内置模块。仓库结构：

| 文件 | 说明 |
| --- | --- |
| `src/` | 服务源码（仅 Node.js 内置模块，零依赖） |
| `test/` | 单元测试，用 `node --test` 直接跑 |
| `ocs-answerer-config.js` | 可直接复制进 OCS 的题库配置 |
| `.env.example` | 配置模板，**不含任何密钥和模型名** |
| `start.cmd` | Windows 双击启动 |
| `查看日志.cmd` | Windows 快捷查看当天日志 |
| `AGENT_SETUP_PROMPT.md` | 让 AI 智能体自动完成部署的提示词 |

## 安全

- `.env` 已在 `.gitignore` 中，**永远不会进仓库**。
- 仓库里不预设任何模型名，避免泄露你正在使用的具体模型。
- 日志输出前会过滤密钥形态。
- 服务只监听 `127.0.0.1`，不对外暴露。

## 相关项目与致谢

本工具是 [OCS 网课助手](https://github.com/ocsjs/ocsjs)的**周边配套**，本身不是 OCS 的一部分，与 OCS 官方无隶属关系。使用前请先安装并了解 OCS：

| 资源 | 地址 | 说明 |
| --- | --- | --- |
| OCS 脚本主仓库 | [ocsjs/ocsjs](https://github.com/ocsjs/ocsjs) | OCS 网课助手本体，支持超星学习通、知道智慧树、职教云、中国大学MOOC 等 |
| OCS 官方文档 | [docs.ocsjs.com](https://docs.ocsjs.com/) | 安装教程（脚本管理器 + 开发者模式）、题库配置、使用说明 |
| OCS 桌面端 | [ocsjs/ocs-desktop](https://github.com/ocsjs/ocs-desktop) | 官方桌面版脚本启动器，浏览器多开、自动执行 |

> 本仓库解决的是其中一环：OCS 的「自定义题库」支持配置外部答题接口，本项目就是把这类请求转发给 AI 并对齐答案格式。OCS 本体及其题库协议的著作权归 OCS 官方所有。
