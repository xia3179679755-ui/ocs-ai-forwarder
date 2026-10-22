# 部署提示词：把这段完整发给任意 AI 智能体

下面代码框里的内容可以直接复制给 Cursor、Codex、Claude Code、通义灵码等
能够操作本地文件和终端的 AI 智能体。它会按步骤下载代码、检查依赖、询问必要配置、
启动服务、验证接口、创建 Windows 快捷方式，并输出 OCS 题库配置。

这个提示词不包含任何真实密钥和具体模型名。AI 必须向你询问这些信息，或通过你的
上游 `/models` 接口读取候选模型后让你选择，不能自行猜测。

---

````text
请帮我在本机部署一个「OCS 题库 AI 答题本地转发」服务。

这是一个零第三方依赖的 Node.js 本地服务：它接收 OCS 题库发来的当前题目，
转发给我指定的 OpenAI 兼容 Chat Completions 接口，再把模型答案转换成 OCS
能够直接选择的格式。服务只能监听 127.0.0.1，不要暴露到公网。

仓库地址：
https://github.com/xia3179679755-ui/ocs-ai-forwarder.git

## 总目标

部署完成后，下面地址应该能使用：

http://127.0.0.1:8765/health
http://127.0.0.1:8765/answer

服务需要支持：

- 判断题、单选题和多选题；
- 带备用模型的串行失败切换；
- OCS 新版图片题，把 images 传给支持图片输入的模型；
- 失败、超时或答案无法匹配选项时，不能伪造答案；
- 把日志写到项目目录的 logs 文件夹，但不能把 API 密钥或 base64 图片完整写进日志。

## 执行规则

1. 先检查当前操作系统、当前工作目录、Node.js 和 Git 是否可用。
2. 只能在用户明确指定的项目目录中操作，不要扫描、修改或删除无关目录。
3. 不要把 API 密钥写进源码、README、测试文件、日志、git 提交信息或聊天输出。
4. 不要提交 `.env`。完成后运行 `git status --short` 确认它没有被纳入提交。
5. 不要修改服务监听地址，必须保持 `127.0.0.1`。
6. 不要猜测任何模型名、API 地址或思考强度。模型名只能来自用户明确提供的内容，
   或上游 `/models` 接口返回的列表。
7. 每个阶段完成后，把实际命令结果和发现的问题告诉我；不要假装成功。
8. 如果某一步需要管理员权限、安装软件或访问网络，先告诉我需要什么权限，
   不要绕过安全确认。

## 第一步：下载或定位代码

优先使用推荐目录 `C:\ocs-forwarder`，但如果该目录已存在且包含本项目，直接复用，
不要删除其中的 `.env`。

Windows 使用：

```bat
git clone https://github.com/xia3179679755-ui/ocs-ai-forwarder.git C:\ocs-forwarder
cd /d C:\ocs-forwarder
```

如果 Git 不可用，打开仓库页面下载 ZIP，解压到 `C:\ocs-forwarder` 或我指定的目录，
然后进入该目录。不要把仓库放到包含视频、照片或其他无关文件的目录根部。

下载后确认存在这些文件：

- `src\run.mjs`
- `src\server.mjs`
- `.env.example`
- `ocs-answerer-config.js`
- `start.cmd`

## 第二步：检查部署依赖

运行：

```bat
node --version
```

要求 Node.js 18 或更高。

这个仓库只有 Node.js 内置模块，**不需要 `npm install`，不要为了它创建
`node_modules`**。如果 Node.js 未安装或版本过低：

1. 先告诉我缺少什么；
2. 给出 https://nodejs.org/ 的 LTS 安装地址；
3. 等我确认后再安装或让我手动安装；
4. 安装完成后重新打开终端，再继续执行 `node --version`。

如果使用 Git，Git 只是下载和更新仓库的可选依赖；没有 Git 可以使用 ZIP。

## 第三步：向我询问配置（必须问，不要猜）

请一次性向我确认以下信息：

1. 上游 OpenAI 兼容 API 的基础地址，例如 `https://example.com/v1`；
2. API 密钥；
3. 普通题的主模型名；
4. 普通题的备用模型名（如果我只想用一个模型，允许我明确说明）；
5. 图片题模型名，必须是确认支持图片输入的模型；
6. 是否允许把多道题排队处理。如果 OCS 可以关闭并发，默认建议不排队；
7. 是否需要启用难度探针。默认关闭，因为探针本身也会消耗一次上游请求。

API 密钥不要在最终总结中完整回显，只能写入本机 `.env`。

如果我不知道模型名，先用我提供的地址请求：

```text
GET <基础地址>/models
Authorization: Bearer <API 密钥>
```

把返回的模型 ID 列表脱敏后展示给我，让我选择。不要把密钥放到 URL 查询参数中。
如果 `/models` 不可用，明确告诉我，并让我从服务商控制台提供准确模型 ID。

## 第四步：生成 `.env`

先确认 `.env.example` 存在，再复制为 `.env`。不要覆盖已经存在的 `.env`；如果已存在，
先备份或只在我确认后修改。

按我确认的内容填写以下字段：

```ini
MOLLY_API_KEY=<我提供的密钥>
MOLLY_BASE_URL=<我提供的基础地址>
MOLLY_CHAT_PATH=/chat/completions
MOLLY_CHAIN=<普通主模型>:<思考强度>:90000,<普通备用模型>:<思考强度>:60000
MOLLY_CHAIN_IMAGES=<图片模型>:<思考强度>:60000
MOLLY_PROBE=
MOLLY_RACE=0
MOLLY_SERIALIZE=0
MOLLY_REASONING_EFFORT=
TOTAL_TIMEOUT_MS=150000
MOLLY_MAX_TOKENS=64
MOLLY_CACHE_TTL_MS=1800000
PORT=8765
```

填写规则：

- `<普通主模型>`、`<普通备用模型>` 和 `<图片模型>` 必须替换成我确认的真实模型 ID；
- 思考强度只能使用该上游支持的值，不确定时先问我或查服务商文档；
- 第一档报错、超时或答案不在选项中，会切换到备用档；
- 图片题优先走 `MOLLY_CHAIN_IMAGES`，不要让不支持图片的普通模型先等待超时；
- `MOLLY_PROBE` 默认留空，不要为了“自动判断难度”擅自增加一次请求；
- `MOLLY_RACE=0` 保持严格串行，避免同时消耗多个模型的 token；
- 若我明确说 OCS 无法关闭并发，才把 `MOLLY_SERIALIZE=1`；
- `TOTAL_TIMEOUT_MS` 必须足够容纳主模型和备用模型的时间预算；
- 不要把真实配置写回 `.env.example`。

写完后检查 `.env` 内容时，API 密钥只显示为前后少量字符加省略号，不能完整打印。

## 第五步：运行自动化测试

在仓库目录执行：

```bat
node --test test/*.test.mjs
```

必须报告通过数量和失败数量。如果测试失败：

- 不要先修改业务逻辑；
- 先把失败测试名称、错误信息和相关文件告诉我；
- 只有得到我的确认后才改源码；
- 修改后重新运行完整测试。

## 第六步：启动服务

Windows 优先使用：

```bat
start.cmd
```

也可以在已确认工作目录正确的终端中运行：

```bat
node src/run.mjs
```

启动时确认日志显示监听 `127.0.0.1:8765`，并确认没有出现以下配置错误：

- `MOLLY_API_KEY is not configured`
- `MOLLY_BASE_URL is not configured`
- `MOLLY_CHAIN 未配置`
- 端口被占用

服务进程启动后不要把它误杀掉。若使用终端前台启动，保持该窗口开启；关闭窗口
就会停止服务。若端口被占用，先告诉我占用情况，不要强制结束未知进程。

## 第七步：验证本地接口

在另一个终端执行健康检查：

```bat
curl --noproxy "*" http://127.0.0.1:8765/health
```

应返回包含 `"ok":true` 的 JSON。

然后验证判断题：

```bat
curl --noproxy "*" -X POST http://127.0.0.1:8765/answer -H "Content-Type: application/json" -d "{\"title\":\"水的化学式是H2O。\",\"type\":\"judgement\",\"options\":\"对\\n错\"}"
```

再验证单选题：

```bat
curl --noproxy "*" -X POST http://127.0.0.1:8765/answer -H "Content-Type: application/json" -d "{\"title\":\"1+1等于几？\",\"type\":\"single\",\"options\":\"A. 1\\nB. 2\\nC. 3\"}"
```

预期答案是 `B`。

再验证多选题：

```bat
curl --noproxy "*" -X POST http://127.0.0.1:8765/answer -H "Content-Type: application/json" -d "{\"title\":\"以下哪些是编程语言？\",\"type\":\"multiple\",\"options\":\"A. Python\\nB. HTML\\nC. Java\"}"
```

预期返回 `code:1`，答案应为选项字母组合，例如 `A#C`，具体以模型判断为准。

如果我提供了图片或图片题测试数据，再发送一题包含 `images` 数组的请求，确认日志
使用图片专用链，并确认 base64 没有被完整打印到日志。如果没有测试图片，至少检查
`ocs-answerer-config.js` 已经包含 images 字段。

如果验证失败，读取项目 `logs` 目录当天的日志，只摘录 `[请求]`、`[失败]`、`[解析]`
和错误摘要。不要输出包含密钥的整行，也不要把图片 base64 粘贴到聊天中。

## 第八步：创建 Windows 桌面快捷方式

必须创建一个指向项目目录 `start.cmd` 的桌面快捷方式。推荐：

1. 在文件管理器打开项目目录；
2. 右键 `start.cmd`；
3. 选择「发送到 → 桌面快捷方式」；
4. 将快捷方式重命名为「OCS AI 题库转发」。

如果用命令行创建，快捷方式必须同时设置：

- TargetPath：项目目录里的 `start.cmd`；
- WorkingDirectory：项目绝对路径；
- Description：OCS AI 题库转发。

不要只设置目标而遗漏 WorkingDirectory，否则服务可能找不到 `.env`。
如果当前环境禁止创建快捷方式，说明失败原因并给我手动操作步骤，不要反复绕过系统限制。

创建完成后告诉我快捷方式的完整路径，并说明：双击即可启动，服务窗口必须保持开启。

## 第九步：输出 OCS 配置和使用说明

读取仓库里的 `ocs-answerer-config.js`，把完整内容输出给我，并说明：

1. 打开 OCS「设置 → 题库 → 自定义题库」；
2. 粘贴并保存这份配置；
3. 启用该题库；
4. 在脚本头部添加 `// @connect 127.0.0.1`，或把 `127.0.0.1` 加入连接白名单；
5. 答题前先启动本地服务；
6. 修改 `.env` 后必须重启服务；
7. 图片题必须确保 OCS 配置里的 `images` 字段没有被删掉。

## 最终报告必须包含

- 项目实际路径；
- Node.js 版本；
- 是否需要安装 Git、是否需要安装依赖；
- 测试通过 / 失败数量；
- 健康检查结果；
- 普通题接口验证结果；
- 图片题配置是否已启用；
- 快捷方式路径；
- OCS 配置内容和下一步使用方法；
- 任何未解决的问题。

API 密钥、完整 `.env` 内容和图片 base64 绝对不能出现在最终报告里。
````

---

## 手动部署版

如果不想让 AI 操作电脑，可以按仓库 README 的「方式一：手动部署」执行，
核心流程是：安装 Node.js → 下载仓库 → 创建 `.env` → 填写上游配置 → 启动服务 →
检查 `/health` → 配置 OCS 题库 → 创建桌面快捷方式。
