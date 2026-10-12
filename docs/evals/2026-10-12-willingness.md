# 调用意愿和小任务开销

2026-10-12，Sonnet（claude-sonnet-5-5），Claude Code 2.1.294。每次运行最多 12 轮。没特别说明的格子每个任务跑 2 次；repo-feature-files 和对照任务在第二步各跑 6 次。标准答案还没经过人工复核，所以这里的得分只用来比较版本。

## 怎么测

意愿分是判断类任务上主动用了 Jev 的运行占比乘以 100，每个任务权重相同。判断类任务有三个：triage-tickets、repo-feature-files、refund-promises-audit。payment-log-duplicates 是对照任务，要的是精确匹配，用了 Jev 就记一次误用。

主要看 `jev-code-deferred` 组。它有沙箱里的 Bash、Edit、Write，jev_ask 延迟加载，系统提示里不提 Jev，最接近装了很多 MCP 服务器的日常 Claude Code 会话：agent 起初只看得到工具名和 server instructions。`jev` 组作为补充，工具一开始就加载，只有 Read、Grep、Glob。

复现命令：

```bash
bun run eval --tasks triage-tickets,repo-feature-files,refund-promises-audit,payment-log-duplicates --arms jev-code-deferred,jev --reps 2 --max-turns 12 --allow-unreviewed
```

## 第一步：让 agent 主动用 Jev

这一步只换 `src/tools/ask.ts` 里的 `ASK_INSTRUCTIONS`：

- V0（394 字符）：main 上原来的文本。介绍 Jev 能回答哪几类问题，最后一句是"精确匹配用 grep 更便宜"。
- V1（760 字符）：开头改成"判断文件之前先用 jev_ask"，列出分类、分诊、排序、过滤、按政策检查这些场景；说明 Jev 读全文、按语义判断，能抓住 grep 漏掉的改写、否定和附带条件；act 的答案很少需要复查。
- V2（850 字符）：场景里加上"判断哪些文件属于某个功能或主题"；明确要在自己读或 grep 之前先问，哪怕只有几十个文件；保留"精确查找，比如核对 ID、加总金额，留给 grep 或代码"。
- V3（963 字符）：V2 再加一句"jev_ask 延迟加载时，和第一次看文件放在同一轮加载"。按轮次拆开 V2 的运行记录后发现，agent 本来就这样做，所以没有采用。

`jev-code-deferred` 组。任务列里是平均 token 和平均得分，没答完的运行不计分：

| 版本 | 意愿分 | 对照误用 | triage-tickets | repo-feature-files | refund-promises-audit | payment-log-duplicates |
| --- | --- | --- | --- | --- | --- | --- |
| V0 | 17 | 0/2 | 26k，0.88 | 36k，1.00 | 315k，两次都没答完 | 35k，1.00 |
| V1 | 67 | 0/2 | 59k，0.90 | 36k，0.92 | 290k，1.00（一次没答完） | 23k，1.00 |
| V2 | 100 | 0/2 | 60k，0.91 | 69k，0.95 | 313k，1.00 | 29k，1.00 |
| V3 | 100 | 0/2 | 60k，0.89 | 53k，0.95 | 276k，0.92（一次没答完） | 23k，1.00 |

意愿分升到了 100，但小任务上用 Jev 的 token 翻了一倍，得分不变。grep 两轮就能交答案；用 Jev 要四轮：加载工具顺便看文件、提问、复查标成 review 或 abstain 的记录、交答案。每轮都要把 11k–17k 的上下文重读一遍。

## 第二步：省掉复查那一轮

复查并没有让答案更准。把所有用了 Jev 的 triage-tickets 运行合起来，agent 复查过的 178 个 review 或 abstain 答案里，Jev 原本答对 152 个，复查后对了 149 个。

于是改了三处：

- jev_ask 的结果新增 `unsure`：返回的记录里只要有 review 或 abstain 的答案，原文不超过 2,000 字符就附上，一次调用最多附 16,000 字符。agent 在同一轮就能看到原文，不用再开文件。refund-promises-audit 的对话记录每份一万多字符，不附。合并前按审查意见改成按 UTF-8 字节计，并加了 `more_unsure` 统计没附原文的记录；评测数据都是英文，字节数等于字符数，上面的结果不受影响。
- `where` 里的是非题现在也接受 `"yes"`/`"no"`。agent 筛选时有时写 `"yes"`，原来会报错，白白多一次调用；repo-feature-files 上用 `where` 筛选的 17 次运行里出过 2 次。
- instructions 告诉 agent 结果里有 `unsure`（V4），再回应它跳过 Jev 时给的理由"仓库小，搜一下就够"：V5 写"哪怕只有几个文件"，V6 写"哪怕仓库很小"，并说明关键词只能找到提到某个主题的文件，判断不了文件是否属于它。V6 是现在的版本，993 字符。

repo-feature-files 上主动用 Jev 的次数：V4 是 2/6，V5 是 4/6，V6 是 6/6；三版的对照任务都是 0/6 误用。V4 到 V6 里用了 Jev 的 12 次全部满分，V6 下每次约 39k token；agent 自己搜的 6 次平均只有 0.90 分。

## 最终结果

`jev-code-deferred` 组：

| 版本 | 意愿分 | 对照误用 | triage-tickets | repo-feature-files | refund-promises-audit | payment-log-duplicates |
| --- | --- | --- | --- | --- | --- | --- |
| V0 | 17 | 0/2 | 26k，0.88 | 36k，1.00 | 315k，两次都没答完 | 35k，1.00 |
| V2 | 100 | 0/2 | 60k，0.91 | 69k，0.95 | 313k，1.00 | 29k，1.00 |
| V6 加 `unsure` | 100 | 0/2 | 43k，0.90 | 39k，1.00 | 347k，1.00（一次没答完） | 23k，1.00 |

`jev` 组：

| 版本 | 意愿分 | 对照误用 | triage-tickets | repo-feature-files | refund-promises-audit | payment-log-duplicates |
| --- | --- | --- | --- | --- | --- | --- |
| V0 | 33 | 0/2 | 37k，0.90 | 23k，0.92 | 455k，两次都没答完 | 43k，1.00 |
| V2 | 67 | 0/2 | 31k，0.89 | 23k，1.00 | 454k，1.00（一次没答完） | 51k，1.00 |
| V6 加 `unsure` | 没算（refund 没跑） | 0/2 | 19k，0.90 | 32k，0.95 | 没跑 | 44k，1.00 |

## 只装这一个服务器时

2026-10-13 加了 `jev-code` 组：编码工具和 `jev-code-deferred` 一样，但 `jev_ask` 一开始就加载，对应只装了这一个 MCP 服务器的会话。V6 这一行合并了两批运行，repo-feature-files 和对照任务各 8 次，其余任务各 2 次：

| 版本 | 意愿分 | 对照误用 | triage-tickets | repo-feature-files | refund-promises-audit | payment-log-duplicates |
| --- | --- | --- | --- | --- | --- | --- |
| V0 | 0 | 0/2 | 47k，0.88 | 38k，0.95 | 282k，0.62 | 25k，1.00 |
| V6 加 `unsure` | 92 | 0/8 | 30k，0.91 | 35k，0.98（8 次里 6 次用了 Jev） | 252k，0.58（一次没答完） | 29k，1.00 |

工具一开始就在时，小任务用 Jev 比自己搜还省：triage-tickets 只要两轮，30k 对 47k。repo-feature-files 上用了 Jev 的 6 次平均 31k、全部满分，agent 自己读的 2 次平均 47k、0.91 分。

那 2 次跳过 Jev，理由还是"仓库小，列一下目录、直接读就够了"。V7 把说明改成"在列目录、读文件或 grep 之前先调用"，并写明一次调用占的上下文比自己读几个文件少，结果 repo-feature-files 只有 4/6 用了 Jev，没有采用。

refund-promises-audit 在这一组两版都不高，在 0.54 和 0.69 之间。V6 那次 0.58 是因为 agent 把"金额是否超过 200 美元"做成两级打分题，再用 `where: {amount: {min: 1}}` 筛选；打分题的答案是 0.93 这类期望等级，一条都没筛出来，agent 只好退回 grep。所有运行里这种用法只出现过这一次。

## 结论

在 `jev-code-deferred` 组，意愿分从 17 升到 100；在 `jev-code` 组，从 0 升到 92。两组的对照任务一次误用都没有。

小任务上用 Jev 的开销降回来了：triage-tickets 从 60k 降到 43k，repo-feature-files 从 69k 降到 39k，得分没降。repo-feature-files 现在和自己搜（36k）差不多，而且次次满分。triage-tickets 还比自己搜（26k）多，因为延迟加载要多花一轮把工具加载进来，这一轮省不掉；工具一开始就加载的 `jev` 组里，同一个任务用 Jev 只要 19k。

refund-promises-audit 是这组任务里唯一 grep 解决不了的。V0 下 agent 不用 Jev，12 轮内两次都没答完；用 Jev 之后能答完并拿满分，token 和 V0 差不多。`unsure` 帮不上这个任务，因为对话记录太长，agent 还要逐份打开核对金额和审批人。

代价是每次模型调用多占一点上下文：instructions 从 394 字符变成 993 字符，jev_ask 的说明也多了一句讲 `unsure`。第一轮上下文 `jev-code-deferred` 从 10,501 涨到 10,655 token，`jev` 从 6,291 涨到 6,490 token。

还没解决的是 `jev` 组的 repo-feature-files：工具一开始就在、又没有 Bash 时，agent 用 Glob 看到 24 个文件，还是说"仓库小，Glob 和 Grep 就够了"，两次都没用 Jev。
