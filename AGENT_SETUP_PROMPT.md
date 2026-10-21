# 部署提示词：把这段完整发给任意 AI 智能体

下面框起来的内容可以直接复制给 Cursor、Codex、Claude Code、通义灵码等
任意能操作本地文件的 AI 智能体。它会自己完成下载、配置、启动和验证。

> 提示词里的 `{仓库地址}` 请替换成实际仓库 URL（clone 用 HTTPS 地址）。

---

````text
请帮我在本机部署一个「OCS 题库 AI 答题本地转发」服务。它是一个零依赖的
Node.js 服务，把 OCS 答题脚本的请求转发给 OpenAI 兼容的 AI 接口，
并把模型返回的答案转成 OCS 能选中的格式。

## 目标

部署完成后，本机 http://127.0.0.1:8765/answer 能接收 POST 请求，
返回形如 {"code":1,"question":"...","answer":"A"} 的 JSON。

## 第一步：拿到代码

git clone {仓库地址} ocs-ai-forwarder
cd ocs-ai-forwarder

如果 git 不可用，就下载仓库 ZIP 并解压，再进入目录。

## 第二步：确认环境

运行 node --version。需要 18 或更高。
如果没装 Node.js，先告诉我，不要自作主张安装。

## 第三步：向我索取三项信息（必须问，不要猜）

1. 上游 API 地址（形如 https://example.com/v1）
2. API 密钥
3. 至少两个模型名：一个强的、一个备用的。
   如果我不知道有哪些模型，请帮我调用 GET {上游地址}/models 列出可用模型，
   再让我从中挑选。绝对不要自己编造模型名。

## 第四步：写 .env

复制 .env.example 为 .env，然后按下面填写：

MOLLY_API_KEY=<我给你的密钥>
MOLLY_BASE_URL=<我给你的地址>
MOLLY_CHAIN=<强模型>:max:90000,<备用模型>:medium:30000

格式说明：每一档是「模型名:思考强度:超时毫秒」，用逗号分隔。
第一档超时或报错，会自动切到第二档，第二档有自己完整的 30 秒预算。

其余字段保持默认即可。

## 第五步：启动并验证

启动：node src/run.mjs

请依次验证这四件事，并把结果贴给我：

1. 健康检查：curl http://127.0.0.1:8765/health
   应返回 {"ok":true,...}
2. 判断题：
   curl -X POST http://127.0.0.1:8765/answer \
     -H "Content-Type: application/json" \
     -d '{"title":"水的化学式是H2O。","type":"judgement","options":"对\n错"}'
   应返回 code:1 且 answer 是「对」或「错」之一（注意：不是字母 A/B）
3. 单选题：
   curl -X POST http://127.0.0.1:8765/answer \
     -H "Content-Type: application/json" \
     -d '{"title":"1+1等于几？","type":"single","options":"A. 1\nB. 2\nC. 3"}'
   应返回 answer 为 B
4. 多选题：
   curl -X POST http://127.0.0.1:8765/answer \
     -H "Content-Type: application/json" \
     -d '{"title":"以下哪些是编程语言？","type":"multiple","options":"A. Python\nB. HTML\nC. Java"}'
   应返回 answer 形如 A#C

注意：本机可能设置了 HTTP_PROXY，curl 访问 127.0.0.1 请加 --noproxy '*'，
否则会被代理拦截返回 502。

如果验证失败，去读 logs/ 目录下当天的日志，把 [请求] [失败] [解析]
这几行贴给我，不要凭猜测改代码。

## 第六步：创建桌面快捷方式（必须做）

用户日常靠双击启动，所以要建一个桌面快捷方式，指向项目目录里的 start.cmd。

Windows 上请用下面任一方式：

- 方式 A：在文件管理器里进入项目目录，右键 start.cmd → 发送到 → 桌面快捷方式。
- 方式 B：如果只能用命令行，创建一个 .vbs 脚本并执行它：

```vbs
Set WshShell = CreateObject("WScript.Shell")
Set Lnk = WshShell.CreateShortcut("<桌面路径>\OCS 答题转发.lnk")
Lnk.TargetPath = "<项目绝对路径>\start.cmd"
Lnk.WorkingDirectory = "<项目绝对路径>"
Lnk.Description = "OCS AI Answer Forwarder"
Lnk.Save
```

快捷方式必须同时设置 TargetPath 和 WorkingDirectory，
否则服务会在错误的目录里启动，读不到 .env。

建好后告诉我快捷方式的完整路径，并说明：
以后双击它就能启动，窗口要保持开着，关掉窗口就等于停掉服务。

## 第七步：告诉我 OCS 怎么填

把仓库里 ocs-answerer-config.js 的内容给我，并说明：
把它填进 OCS 的「设置 → 题库 → 自定义题库」，
同时需要在脚本头部加 // @connect 127.0.0.1 放行本地请求。

## 重要约束

- 不要把 .env 提交到 git。它在 .gitignore 里，提交前请确认。
- 不要把 API 密钥写进任何源码、日志或提交信息。
- 不要猜测模型名，模型名只能来自 /models 接口或我明确告知。
- 服务只监听 127.0.0.1，不要改成 0.0.0.0。
- 上游延迟波动很大（同一道题可能 3 秒也可能 70 秒），
  遇到超时请调大超时，而不是换模型或改代码逻辑。
- 修改源码后请运行 node --test test/*.test.mjs 确保测试仍然全绿。
````

---

## 手动部署版

如果你打算自己动手，看仓库 README 的「方式一：手动部署」，步骤是一样的，
只是省掉「向用户提问」这一环——用你自己的密钥和模型名即可。
