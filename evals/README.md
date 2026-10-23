# Agent 工具评测

在同一批任务上，对比 agent 接入不同 jev 工具配置时的 token 消耗和任务得分。首要指标是 token 效率：得分不下降的前提下，token 越少越好。设计和行为约定见 `openspec/changes/add-agent-tool-eval/`。

## 前置条件

- 本机已安装并登录 Claude Code，版本不低于 2.1.294（`claude auth status` 显示已登录）。SDK 组和延迟加载组依赖的设置只在这个版本上验证过。评测走你的订阅，不需要 Anthropic API key。
- 已执行 `bun install`。jev 组从工作区源码启动 MCP 服务器，需要依赖。
- 跑 jev 组或 SDK 组的任务时，终端里要有 `TYPESAFE_API_KEY`。只跑 `baseline`、或只用 `--probes-only` 测工具定义开销时不需要。
- 任务目录里有 `REVIEW.md`（标准答案经过人工复核）才能正式运行。试跑可以加 `--allow-unreviewed`，报告会注明结果不能用来下结论；`--dry-run` 不受这个限制。

## 常用命令

只打印运行矩阵和消耗估算，不启动任何运行：

```bash
bun run eval --dry-run
```

只测各组工具定义占多少上下文（每组一次探测，不需要 key，几分钱）：

```bash
bun run eval --probes-only --arms baseline,jev,jev-all,jev-v0.1.1
```

所有 dev 任务 × 默认 3 个组别（`baseline`、`jev`、`jev-v0.1.1`），每组跑 1 次（先用来校准消耗）：

```bash
bun run eval --reps 1
```

指定任务和组别：

```bash
bun run eval --tasks triage-tickets --arms baseline,jev,jev-directed
```

额度用完后续跑（已完成的运行不会重跑）：

```bash
bun run eval --resume evals/results/<目录名>
```

全部参数：`bun run eval --help`。

## 组别

| 组别 | jev 服务器 | agent 可见的 jev 工具 |
| --- | --- | --- |
| `baseline` | 无 | 无 |
| `jev` | 工作区源码，默认配置 | `jev_ask` |
| `jev-directed` | 同 `jev`，系统提示要求 agent 的判断都交给 jev | `jev_ask` |
| `jev-all` | 工作区源码，`TYPESAFE_TOOLS=all` | 全部 5 个 |
| `jev-v0.1.1` | 上一个发布版本：用 `git archive` 取出标签 `v0.1.1` 的 `src/`，链接本仓库的 `node_modules` 运行，不联网 | 全部 5 个 |
| `jev-directed-code` | 同 `jev-directed`，另有编码工具（沙箱里的 Bash、Edit、Write） | `jev_ask` |
| `jev-code` | 工作区源码，有编码工具；`jev_ask` 一开始就加载，不提示 agent 用 jev | `jev_ask` |
| `jev-code-deferred` | 同 `jev-code`，但 `jev_ask` 延迟加载 | `jev_ask`（要先用 ToolSearch 加载） |
| `jev-code-rule` | 同 `jev-code`，系统提示里多一句用户规则，相当于用户在 CLAUDE.md 或 AGENTS.md 里写了"判断几个文件或记录时，先问 Jev 再自己读" | `jev_ask` |
| `jev-code-deferred-rule` | 同 `jev-code-deferred`，加同一句规则 | `jev_ask`（要先用 ToolSearch 加载） |
| `sdk` | 无。工作区里装好 `@typesafe-ai/sdk` 并加载官方 TypeSafe skill，有编码工具，系统提示说明 SDK 已安装、key 已设置 | 无，agent 自己写 bun 脚本调 SDK |
| `sdk-directed` | 同 `sdk`，系统提示还要求判断都通过 SDK 交给 Jev | 无 |

`jev-code-deferred` 最接近日常的 Claude Code 会话：装了很多 MCP 服务器时，Claude Code 会把它们的工具延迟加载，agent 起初只看到工具名和 server instructions，用 ToolSearch 加载后才能调用。评测里只有一个 MCP 服务器，所以用 `ENABLE_TOOL_SEARCH=true` 强制走这条路。`jev-code` 对应只装了这一个服务器的会话，工具少，Claude Code 一开始就加载 `jev_ask`。测调用意愿主要看这两组。两个 `-rule` 组和它们对照：会话一样，只是用户自己写了一条规则，用来看 agent 照规则用 Jev 时用得多不多、多花多少 token。

编码工具组的隔离有限：沙箱只管 Bash 的写入和联网，Bash 照样能读本机的其他文件，包括评测仓库里的标准答案；Edit、Write 不经过沙箱；`TYPESAFE_API_KEY` 也在 Bash 能看到的环境变量里。目前的运行记录里没有 agent 越界，但评测机上不要放不该被读到的东西。

默认跑 `baseline`、`jev`、`jev-v0.1.1`：一次评测里同时回答"接 jev 值不值"和"这版比上一个发布版省了多少"。

`sdk` 和 `sdk-directed` 用来比较 MCP 和"官方 SDK 加 skill"这条路，和 MCP 组只差接入 Jev 的方式：

- 工作区里多一份从本仓库依赖复制来的 `node_modules/@typesafe-ai/sdk`，`package.json` 里声明这个依赖。
- 加载 `evals/vendor/typesafe-plugin/`，即官方插件 typesafe-ai/skills 0.5.7 的固定副本（MIT）。其他 skill 全部关闭：设 `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`，再用 `skillOverrides` 关掉仍会加载的 design、doctor、plugin-authoring。`system/init` 里的 skill 列表必须正好是 `typesafe:typesafe-ai`，否则这次运行判为 invalid。
- 多出 WebFetch（只能访问 docs.typesafe.ai）和 Skill，另有和 `jev-directed-code` 一样的编码工具：Bash 跑在 Claude Code 的沙箱里，任何命令都不用确认，但只能写工作区，联网只能访问 api.typesafe.ai 和 docs.typesafe.ai；沙箱起不来时这次运行直接失败。
- 报告里的 jev 使用率对 SDK 组这样算：用 Write、Edit 或 shell 重定向写入导入 SDK 或请求其 API 的代码，在 Bash 里内联这样的代码，或者用 `bun`、`node` 这类命令运行写过这种代码的脚本，都算用了 jev。用 `ls`、`cat` 看 SDK 的文件、改脚本都不算。
- 任务自带 `package.json` 时只在它的依赖里加上 SDK，其余不动，保证 SDK 组看到的仓库和别的组一样。

## 额度控制

- 默认串行执行。单次运行最多 40 轮、$2；整次评测最多 $30。费用都按 API 标价折算，用来比较消耗，不是订阅的实际扣费。
- 订阅的 5 小时或 7 天窗口用到 85% 时停止启动新运行（`--stop-at-utilization`），给你自己的日常使用留出额度。遇到限额也会停。之后用 `--resume` 续跑。
- 建议先跑一轮 `--reps 1`，看报告里每次运行的平均消耗，再决定重复次数。

## 怎么读报告

每次评测写到 `evals/results/<时间>-<模型>/`（不进 git）：

- `summary.md`：
  - **Token 效率摘要**：每组的平均 token/次、相对 baseline 的变化、得分变化和结论（更省且不降分、更省但降分、更费）。
  - **调用意愿**：判断类任务上主动用了 Jev 的运行占比 × 100（意愿分，每个任务权重相同），第一次用 Jev 时上下文已经多大（越小说明越早交给 Jev），以及对照任务（`category: "control"`，比如 payment-log-duplicates）上的误用次数。只测意愿时可以加 `--max-turns 12` 省钱：被截断的运行没有答案，但用没用 Jev 照样算数。
  - **工具定义开销**：每组第一轮请求的上下文 token，差值就是工具定义占的量。
  - 各任务明细、未计入的运行、未执行的运行。
- `metrics.json`：汇总数据。
- `runs/*.jsonl`：每次运行的完整事件流，已脱敏。

人工整理的结论放到 `docs/evals/`，原始结果不提交。

## 分析和改进流程

1. 跑 dev 任务，看哪一组更省、哪里掉分。
2. 挑几份有代表性的 `runs/*.jsonl` 交给 Claude，让它找出 agent 卡住、误用工具或浪费 token 的地方。
3. 改完工具，在 dev 上重跑，看 `jev` 相对 `baseline` 和上一个发布版（`jev-v0.1.1`）的变化；确认有改进后，再用 `--split holdout` 验证。

## 已验证的 Claude Code 行为

2026-10-08，Claude Code 2.1.284，模型别名 `sonnet` 解析为 `claude-sonnet-5-5`：

- 从 Claude Code 桌面应用的终端启动时，继承的环境变量会让子进程报"未登录"。所以评测只传 `HOME`、`PATH` 等白名单变量；jev 组和 SDK 组另外传 `TYPESAFE_API_KEY`。
- `--restricted` 下不加载用户和项目的设置、hooks、CLAUDE.md 和技能。实测 agent 看不到用户全局 CLAUDE.md 里的指令。
- baseline 和各 MCP 组可见的内置工具都是 Glob、Grep、Read、StructuredOutput，jev 工具见上面的组别表。后来加的编码工具组另有 Bash、Edit、Write，延迟加载组另有 ToolSearch。
- 第一轮上下文（`--probes-only`，Sonnet）：`baseline` 4,310 token，`jev` 5,468，`jev-all` 7,340，`jev-v0.1.1` 9,152。也就是工具定义从 v0.1.1 的 4,842 token 降到 1,158 token（其中 `files` 批量模式约占 240）。
- 宿主会通过 MCP `roots` 告诉服务器项目目录（Claude Code 给的是它的工作目录，评测里就是工作区副本），`jev_ask` 的 `files` 只读这个目录。
- agent 读到的是 MCP 结果的 `structuredContent`（序列化成 JSON），`content` 里的文本不会进上下文；`_meta` 也不进上下文，但会出现在 stream-json 事件的 `tool_use_result` 里。评测从那里读 Jev 的 token 用量（v0.1.1 的用量写在结果 JSON 里，同样能读到）。
- `outputSchema` 不占上下文：有无一段很长的输出 schema，第一轮上下文只差 2 token。
- MCP 配置里给服务器的 `env` 会和 Claude Code 继承下来的环境合并，所以 `jev-all` 设了 `TYPESAFE_TOOLS` 也照样拿得到 `TYPESAFE_API_KEY`。
- 只有这 5 个 MCP 工具时，Claude Code 会一开始就加载它们，不走延迟加载。
- 工具输出过大时，Claude Code 会把完整输出写到 `~/.claude/projects/<工作目录对应的键>/` 下再让 agent 读取。评测在每次运行后删除这些目录，只删名字里带 `typesafe-mcp-eval` 或 `typesafe-mcp-probe` 的。

2026-10-12，Claude Code 2.1.294：

- 沙箱的自动放行只覆盖能事先检查的命令：`for` 循环、awk 程序、heredoc 在 `dontAsk` 下会被拒。所以编码工具组在权限规则里显式放行 Bash，效果接近跳过权限确认的会话，沙箱照样把写入限制在工作区、把联网限制在白名单域名。
- `ENABLE_TOOL_SEARCH=true` 只有在 `--tools` 里也放行 ToolSearch 时才生效：之后 `jev_ask` 仍出现在 `system/init` 的工具列表里，但定义不进第一轮上下文（少约 1,000 token）。
- `--disable-slash-commands` 会关掉所有 skill，所以 SDK 组不加这个参数，改用上面的办法只留下 TypeSafe skill。只设 `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` 时还剩 design、doctor、plugin-authoring 三个，不关的话会多出 17 个自带 skill。
- 第一轮上下文（`--probes-only`，Sonnet）：`baseline` 4,533 token，`jev` 6,290，`jev-directed` 6,326，`sdk` 7,481，`sdk-directed` 7,526。`jev_ask` 加上记录拆分、`where`/`top`/`counts` 和 server instructions 后比 baseline 多 1,758 token；SDK 组的四个工具和一个 skill 多 2,948。

## 评分规则的形式化保证

`evals/laws/` 用 Bend 2 给代价表加权评分（门控类任务用）加了一道机械检查：

- `LAWS.bend`：评分必须满足的法则，例如全对得满分、得分落在 [0, 1]、缺答按最坏情况算、改对一项不会让总代价变高。由人编写，证明它们的 AI 不能修改。
- `scoring.bend`：评分规则的参考模型；`PROOF.bend`：逐条证明；`lemmas.bend`：证明用到的自然数引理。
- `tests/evals/laws.test.ts`：把 TS 的 `weightedCost` 和参考模型逐个组合对照，确保 TS 实现的就是被证明的那套规则。

需要本机安装 Bend 2。改评分规则或代价表后运行：

```bash
bend evals/laws/PROOF.bend --check-only
```

退出码为 0 才算通过（2.0.36 输出 "ALL PROOFS CHECK"，更早的版本输出 "All terms check."）。CI 的 Ubuntu 任务会装上 `scripts/ci/tools.json` 里固定的 Bend 版本并跑这些测试；macOS、Windows 任务和没装 `bend` 的机器会自动跳过。

## 新增任务

每个任务一个目录 `evals/tasks/<id>/`：

- `task.ts`：用 `defineTask` 定义提示、split、答案 schema（必须是 `z.object`）和评分规则，并在 `evals/tasks/index.ts` 注册。
- `gold.json`：标准答案。
- `workspace/`：agent 能看到的全部数据。它就是 agent 的工作目录，所以提示里的路径要相对于它写。
- `REVIEW.md`：人工复核标准答案后再加。
- `serverEnv`（可选）：任务需要的 jev 服务器环境变量，所有带 jev 服务器的组都会加上；组自己设的变量优先。`screenshot-triage` 用它设 `TYPESAFE_IMAGES=1`，这样 Jev 才能看截图。
- `workspace`（可选）：要用另一个任务的 `workspace/` 时，写它的绝对路径，省得复制一份。

`screenshot-triage` 的工作区只有 40 张商城页面截图（1280×720 PNG）：26 张正常，9 张报错，5 张一直没加载完，答案只在图像里。截图由 `generate.ts` 用无头 Chrome 渲染，改了页面要重新运行它（`CHROME` 可指定别的浏览器）。

`screenshot-locate` 用同一批截图。提示里直接列出 14 张坏掉的页面和原因，agent 要给每张框出问题在哪，用像素坐标。框的中心落在标准框里（四边各放宽 16 像素）算找到，得分是找到的比例。标准框由它的 `generate.ts` 用 Playwright 在同一个 Chrome 里量出来，量之前先核对 Playwright 截的图和工作区里的截图逐字节相同；`screenshot-triage` 的截图重新生成后，它也要重新运行。

数据用英文、全部合成；工作区里不放 `AGENTS.md`、`CLAUDE.md`，也不放 `*.test.*`、`*.spec.*` 这类文件名。`bun test` 会检查标准答案用自身评分规则能得 1.0。
