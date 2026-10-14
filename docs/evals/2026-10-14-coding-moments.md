# 写代码时的调用意愿

2026-10-13 到 14，Sonnet（claude-sonnet-5-5），Claude Code 2.1.294。新任务每次运行最多 20 轮，旧任务的回归检查最多 12 轮，和上一轮一致。每格跑 2 次；repo-feature-files 在 `jev-code` 组另外补跑了几次，见下文。标准答案还没经过人工复核，所以这里的得分只用来比较版本。

## 为什么做

上一轮（[调用意愿和小任务开销](2026-10-12-willingness.md)）的判断类任务是工单分诊、找功能文件和审客服对话，写代码时最常碰到的几种判断都没测过。说明里描述判断用的也是"分类、筛选、按规则检查"这类笼统的词，没有 bug、测试失败、代码审查这些写代码时的说法。

这一轮加了 5 个写代码场景的任务，再在说明里点名这些场景，看 agent 会不会因此主动用 Jev。

## 新任务

| 任务 | 场景 | 类别 | 为什么 grep 不够 |
| --- | --- | --- | --- |
| bug-files | 修一个计费 bug 之前，找出修复要改的文件（31 个文件） | 判断 | 相关文件把计费周期叫成 cadence、term、12 个月，各不相同；14 个无关文件里满是 trial、yearly、price |
| change-review | 按 6 条团队规范审一个 PR 改动的 10 个文件，列出违规 | 判断 | 违规要读懂才看得出，比如先换算成美元再乘税率；PR 之外的旧代码也违规，但不在审查范围内 |
| ci-failures | 16 个 e2e 测试失败，判断各自是 PR 引起的、已知的不稳定问题，还是 CI 环境坏了 | 判断 | 好几个不稳定的失败也提到 PR 改过的按钮和运费；环境问题看起来像普通的断言失败，只有服务器输出里的连接被拒能说明原因 |
| incident-logs | 327 条日志里，哪些属于前一晚的结账故障，原因也算 | 判断 | 提示里不说原因；原因相关的日志不出现 checkout，搜 timeout 又会搜出无关的超时 |
| rename-callers | 改函数名之前，列出所有调用处 | 对照 | 精确查找，grep 加上看 import 就能做完；用 Jev 算误用 |

bug-files 的评分要说明一下。bug 描述里说续费已经是对的，所以订阅里本来就存着正确的周期，转换任务改读订阅的周期，只改一个文件也能修好。因此 `convertTrials.ts` 必须写，另外两个有缺陷的文件写不写都不扣分，写其他文件算错。

新任务都放在 dev split。

## 说明改了什么

只换 `src/tools/ask.ts` 里的 `ASK_INSTRUCTIONS`：

- V6（993 字符）：上一轮定下的版本。
- V8（1,278 字符）：V6 原文一字不改，第一句后面加一句"写代码时这类判断很多：修 bug 或改功能之前，问它涉及哪些文件；审改动时，问每个改动的文件是否符合规范；测试失败时，问每个为什么失败；看日志时，问哪些条目属于这次事故"。精确查找的例子里加了"找某个符号的调用方"。
- V9（1,318 字符）：在 V8 基础上，把"哪怕仓库很小、只有几个文件"扩成"……或者一条命令就能把它们全打印出来"，专门回应 agent 跳过 Jev 时给的理由。

V7 这个编号上一轮已经用过，所以这一轮从 V8 开始。

第一轮上下文：`jev-code-deferred` 组 V6 是 10,592 token，V8 是 10,680，V9 是 10,682；`jev-code` 组分别是 11,590、11,674、11,696。V8 让每次模型调用多读大约 88 token。

## 结果：新任务

主动用了 Jev 的运行，每格 2 次：

| 组 | 版本 | bug-files | change-review | ci-failures | incident-logs | 意愿分 | 对照误用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jev-code-deferred` | V6 | 2/2 | 2/2 | 0/2 | 0/2 | 50 | 0/2 |
| `jev-code-deferred` | V8 | 2/2 | 2/2 | 2/2 | 0/2 | 75 | 0/2 |
| `jev-code-deferred` | V9 | 2/2 | 2/2 | 2/2 | 0/2 | 75 | 0/2 |
| `jev-code` | V6 | 0/2 | 0/2 | 0/2 | 0/2 | 0 | 0/2 |
| `jev-code` | V8 | 0/2 | 0/2 | 0/2 | 0/2 | 0 | 0/2 |
| `jev-code` | V9 | 0/2 | 0/2 | 1/2 | 0/2 | 13 | 0/2 |

V6 已经能让延迟加载的 agent 在 bug-files 和 change-review 上用 Jev，这两个场景本来就对应说明里的"判断哪些文件属于某个功能"和"按规则检查"。V8 新增的效果只有一处：ci-failures 从 0/2 变成 2/2。incident-logs 三个版本、两个组都没用过 Jev。

所有没用 Jev 的运行，给的理由几乎都是同一个："文件少，一条 bash 命令就读完了"，或者"日志只有 327 行，grep 就够"。V9 正面回应这个理由，只在 `jev-code` 组多换来 1 次。

得分各版本一样：除 incident-logs 外都是 1.00。incident-logs 是 0.96 到 0.98，扣分都来自同一处：有的 agent 认为两条非结账路由上等待连接池的日志可以不算，没写进答案。

用了 Jev 和自己读的 token 对比，三个版本合在一起算：

| 任务 | 用了 Jev | 自己读 | 差别 |
| --- | --- | --- | --- |
| bug-files | 75k，平均 6.7 轮（延迟加载组 6 次） | 59k，5 轮（一开始加载组 6 次） | +27% |
| change-review | 89k，8.5 轮（延迟加载组 6 次） | 52k，5 轮（一开始加载组 6 次） | +71% |
| ci-failures | 63k，6 轮（延迟加载组 4 次） | 48k，4.5 轮（延迟加载组 2 次） | +31% |

bug-files 和 change-review 只能跨组比：延迟加载组每次都用了 Jev，一开始加载组一次都没用。延迟加载组第一轮上下文反而小约 1,000 token，差距主要来自用 Jev 时多出来的轮次。

多出来的 token 几乎都来自多出来的轮次。拿 ci-failures 的一次运行看：加载工具一轮，读 PR 和背景文件一轮，jev_ask 一轮（16 个答案只返回约 2,100 字符），再花一轮打开 6 个文件复查，最后交答案。自己读只要读背景、一次性 cat 16 个文件、交答案三步。每多一轮，就要把 15k 到 20k 的上下文重读一遍。

bug-files 和 change-review 还多一层原因：这类代码判断 Jev 的把握低。bug 要跨文件看数据怎么传，规范违规又很细，Jev 常给 review 或 abstain，agent 于是再去读文件，等于付了两遍。

这和 Jev 有把握的判断正好相反。工单分诊和找功能文件上，agent 拿到答案就用，很少复查。这一轮 repo-feature-files 在 `jev-code` 组用了 Jev 的 3 次平均 30k、4 轮，自己读的 9 次平均 46k、4.4 轮，省了 35%。

## 结果：旧任务回归

`jev-code-deferred` 组，V8 和 V9 与上一轮的 V6 一样：triage-tickets 和 repo-feature-files 都是 2/2 用了 Jev，对照任务 0/2 误用，token 和得分也和上一轮相当。

`jev-code` 组，triage-tickets 三个版本都是 2/2，对照任务都没误用。repo-feature-files 有一个值得注意的信号：

| 版本 | 用了 Jev 的次数 |
| --- | --- |
| V6 | 8/12（上一轮 6/8，这一轮同一天重跑 2/4） |
| V8 | 1/6 |
| V9 | 0/2 |

只看同一天的数据是 2/4 对 1/8，样本太小，不算显著，但方向一致。跳过的理由仍然是"仓库很小，直接读就行"。这个格子恰好是 Jev 省 token 的场景，所以采用 V8 之前值得多跑几次确认。

## 改工具描述（V10）

前面几版只改了 server instructions。工具一开始就加载时，agent 还能看到 `jev_ask` 自己的描述，可这段描述只讲怎么调用，不讲什么时候该用。V10 在 V8 的基础上把描述的开头改成什么时候用：一次判断 glob 匹配到的所有文件或记录，比如 bug 涉及哪些文件、改动的文件是否符合规范、每个失败的测试为什么失败、哪些日志属于事故；文件少而短也先问，然后只看 Jev 没把握的；精确查找留给 grep。描述从 827 字符变成 1,230 字符，`jev-code` 组第一轮上下文从 11,674 涨到 11,789 token。

| 组 | 版本 | bug-files | change-review | ci-failures | incident-logs | 意愿分 | 对照误用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jev-code-deferred` | V8 | 2/2 | 2/2 | 2/2 | 0/2 | 75 | 0/2 |
| `jev-code-deferred` | V10 | 1/2 | 2/2 | 2/2 | 0/2 | 63 | 0/2 |
| `jev-code` | V8 | 0/2 | 0/2 | 0/2 | 0/2 | 0 | 0/2 |
| `jev-code` | V10 | 0/2 | 0/2 | 0/2 | 0/2 | 0 | 0/2 |

没有变化。`jev-code` 组 8 次都没用 Jev，理由还是"文件小，直接读"。延迟加载组的 bug-files 少了 1 次：那次 agent 已经把 jev_ask 加载进来，看到仓库小，又改成自己读。每格只跑 2 次，这点差别算正常波动。

两组的差别出在做决定的时机。延迟加载时，agent 通常在第一轮就把 jev_ask 和 PR、规范文件一起加载进来，这时它还不知道要判断几个文件，加载之后多半就用了。工具一开始就加载时没有这一步：agent 先读完背景，看到只有 10 个小文件，才决定不用。

## 用户自己写一条规则

server instructions 是第三方工具给的建议，agent 会拿自己的判断去衡量；用户在 CLAUDE.md 或 AGENTS.md 里写的规则，agent 会当成要求照做。为了看这条路能把调用率推到多高、要多花多少 token，加了 `jev-code-rule` 和 `jev-code-deferred-rule` 两组。会话和 `jev-code`、`jev-code-deferred` 一样，只是系统提示里多一句规则（`HOUSE_RULE_PROMPT`）：

> When a task needs a judgment about several files or records, ask Jev with jev_ask before reading them yourself, even if there are only a few: which files a bug or change involves, whether changed files follow the conventions, why each failed test failed, which log entries belong to an incident, or classifying and ranking items. Read only what Jev is unsure about. Use grep or code for exact lookups, such as a symbol's callers.

规则用 `--append-system-prompt` 加进去，位置和真实的 CLAUDE.md 不完全一样。jev 用的是当前发布的 V6。

| 组 | bug-files | change-review | ci-failures | incident-logs | 意愿分 | 对照误用 |
| --- | --- | --- | --- | --- | --- | --- |
| `jev-code-deferred-rule` | 2/2 | 2/2 | 2/2 | 2/2 | 100 | 0/2 |
| `jev-code-rule` | 2/2 | 2/2 | 2/2 | 0/2 | 75 | 0/2 |

V6 不加规则时，这两组是 50 和 0。规则把调用率推了上去，而且一次误用都没有：在找调用方的任务上，agent 都说这是精确查找，该用 grep。工具一开始就加载时，incident-logs 仍然两次都没用，agent 认为 327 行、格式整齐的日志用 grep 就够了。

代价是 token。和所有不加规则、自己读文件的运行比：

| 任务 | 自己读 | 延迟加载 + 规则 | 一开始加载 + 规则 |
| --- | --- | --- | --- |
| bug-files | 60k，5.1 轮 | 78k（+30%） | 70k（+17%） |
| change-review | 52k，5.0 轮 | 75k（+44%） | 72k（+38%） |
| ci-failures | 49k，4.1 轮 | 52k（+6%） | 61k（+24%） |
| incident-logs | 76k，6.0 轮，0.97 分 | 88k（+16%），0.98 分 | 没用 Jev |

除 incident-logs 外，得分都是 1.00。incident-logs 延迟加载加规则的两次里有一次拿了 1.00，是这个任务所有运行里唯一的满分。

规则里"只读 Jev 没把握的"那半句有一点用：ci-failures 有一次 agent 一个文件都没开就交了答案，只用了 44k，比自己读还少。多数运行还是会复查。change-review 多花得最多，原因之一是 `where`。

## `where` 筛选写错

change-review 要按 6 条规则审 10 个文件。agent 一般每条规则问一个是非题，再用 `where` 只取违规的文件。它要的是"违反任意一条"，`where` 却要所有条件都满足才算匹配。12 次用了 Jev 的 change-review 运行里，大约 7 次在这里出了错：

- 只写第一条规则，比如 `{"r1": {"decision": "act"}}`，违反其他规则的文件就被筛掉了；
- 6 条都写上，变成 6 条同时违反才算，一个文件也匹配不上；
- 有一次 agent 发现漏了，改成每条规则单独问，一共调用了 7 次。

每错一次，就要再问一次或者再读一轮，而每一轮都要把 15k 到 20k 的上下文重读一遍。

## 结论

1. 在说明里点名写代码的场景，效果有限：延迟加载时意愿分从 50 升到 75，只多了测试失败这一种场景；工具一开始就加载时没有变化。没有一次误用。
2. agent 跳过 Jev 的理由始终是"文件少"。直接回应这个理由的 V9 几乎没用，和上一轮 V7 的结果一致，措辞已经推不动这一块。
3. 在这几个小的写代码任务上，用 Jev 比自己读多花 27% 到 71% 的 token，得分不变。原因是多出来的轮次：加载工具、复查 Jev 没把握的答案。所以在这些场景里提高调用率，会让 token 效率变差。
4. Jev 有把握、且能省掉整轮阅读时，它省 token，比如找功能文件和工单分诊。要让写代码时多用 Jev 又不多花 token，先要减少这些多出来的轮次。
5. 改工具描述也推不动。说明和描述里一共试了五种写法，agent 跳过 Jev 的理由始终是文件少。
6. 用户自己写一条规则，能把调用率推到 100（延迟加载）和 75（一开始加载），没有误用，但在这些小任务上比自己读多花 6% 到 44% 的 token。

所以这一轮没有采用 V8、V9、V10，说明仍是 V6，也不建议用户写这条规则。目标是 token 效率，小任务让 agent 自己读更省。接下来先让 `where` 支持"满足任意一条"，省掉写错筛选多出来的那一轮。V6 里"哪怕仓库很小"那句是为了让 agent 在小仓库里也用 Jev 加的，之后要改成按文件多少来决定，再用一个大一点的任务确认该用 Jev 的时候 agent 还会用。

## 还没解决

- 测试输出和终端里的报错仍然没法直接交给 Jev。这一轮的 ci-failures 用的是 Playwright 那种每个失败一个文件的产物，Jev 能直接读；单元测试的输出只在终端里。
- 代码类判断上 Jev 给 review 或 abstain 的比例高，agent 因此复查。可以试的方向：让 `unsure` 带回的原文覆盖常见大小的源文件（现在上限是每条 2,000 字节，很多源文件超过这个大小），或者在说明里提示把 bug 拆成单文件就能判断的问题。
- 任务都很小，10 到 31 个文件。大仓库里自己读不完，Jev 的优势可能更明显，这一轮没有测。
- `jev-code` 组 repo-feature-files 的下降信号要多跑几次才能下结论。
- `where` 只能表达"所有条件都满足"，按多条规则找违规时 agent 经常写错。
- V6 的"哪怕仓库很小"是上一轮为了让 agent 在小仓库里也用 Jev 加的，V8 到 V10 都保留了。延迟加载的 agent 因此在 bug-files、change-review 上也用 Jev，几个版本合计 75k 和 85k，比自己读的 60k、52k 多 25% 和 63%。

## 复现

新任务，每个版本在各自的 worktree 里跑：

```bash
bun run eval --tasks bug-files,change-review,ci-failures,incident-logs,rename-callers --arms jev-code-deferred,jev-code --reps 2 --max-turns 20 --allow-unreviewed
```

旧任务回归：

```bash
bun run eval --tasks triage-tickets,repo-feature-files,payment-log-duplicates --arms jev-code-deferred,jev-code --reps 2 --max-turns 12 --allow-unreviewed
```

V10 用第一条命令，在改了描述的 worktree 里跑。用户规则的两组在 V6 上跑：

```bash
bun run eval --tasks bug-files,change-review,ci-failures,incident-logs,rename-callers --arms jev-code-deferred-rule,jev-code-rule --reps 2 --max-turns 20 --allow-unreviewed
```
