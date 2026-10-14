# 小任务让 agent 自己读

2026-10-14 到 15 日，Sonnet（claude-sonnet-5-5），Claude Code 2.1.294，每组每个任务跑 2 次。写代码的任务每次最多 20 轮，其他任务最多 12 轮。标准答案还没经过人工复核，所以这里的得分只用来比较版本之间的差别。

## 问题

[写代码时的调用意愿](2026-10-14-coding-moments.md)里发现，文件不多的任务上，agent 用 Jev 比自己读文件多花 token。发布版的说明（V6）要求"哪怕仓库很小、只有几个文件"也先问 Jev。这个项目要省的是 agent 的 token，所以试着把小任务交还给 agent 自己读。

## 测了哪几版

| 版本 | 说明里怎么写 | 长度 |
| --- | --- | --- |
| V6 | 发布版：哪怕只有几个文件，也先问 Jev | 993 字符 |
| V11 | 超过大约 50 个文件或记录才先问 Jev，几个短文件自己读 | 997 字符 |
| V12 | V6 加一句：jev_ask 还要先加载时，50 个以内的短文件自己读 | 1,095 字符 |

V12 是看了 V11 的结果之后加测的。jev_ask 延迟加载时，agent 要先花一轮用 ToolSearch 把它找出来，小任务上这一轮不划算；jev_ask 一开始就加载好时，agent 第一轮就能问，问 Jev 反而比自己读便宜。V12 想两头都占。

## 怎么测

两组都没有提示 agent 用 Jev：

- `jev-code-deferred`：jev_ask 要先通过 ToolSearch 加载，像装了很多 MCP 的 Claude Code；
- `jev-code`：jev_ask 一开始就加载好，像只装了这一个 MCP。

任务分三类：

- 6 个小的判断任务：bug-files、change-review、ci-failures、incident-logs、triage-tickets、repo-feature-files；
- 1 个大任务：refund-promises-audit，100 份对话记录；
- 2 个对照任务：rename-callers、payment-log-duplicates，这两个任务用 Jev 算误用。

三个版本都跑在加 `$or` 之前的代码上，只有说明不同。V6 在写代码任务上的数据取自[写代码时的调用意愿](2026-10-14-coding-moments.md)，其余数据是同一天重跑的。

## 结果

6 个小判断任务的 token 总和：

| | V6 | V11 | V12 |
| --- | --- | --- | --- |
| 延迟加载 | 359k | 273k（−24%） | 300k（−16%） |
| 一开始加载 | 288k | 313k（+9%） | 305k（+6%） |
| 合计 | 647k | 586k（−9%） | 605k（−6%） |

各任务的平均 token，斜杠前是延迟加载，后面是一开始加载：

| 任务 | V6 | V11 | V12 |
| --- | --- | --- | --- |
| bug-files | 69k Jev / 62k | 51k / 54k | 62k / 52k |
| change-review | 78k Jev / 51k | 48k / 50k | 49k / 52k |
| ci-failures | 48k / 49k | 46k / 50k | 46k / 50k |
| incident-logs | 74k / 70k | 54k / 78k | 64k / 67k |
| triage-tickets | 44k Jev，0.91 / 30k Jev，0.90 | 38k，0.86 / 41k，0.88 | 43k Jev，0.91 / 30k Jev，0.91 |
| repo-feature-files | 46k Jev，1.00 / 26k Jev，1.00 | 36k，0.95 / 40k，0.92 | 36k，0.91 / 54k，1.00 |

标了 Jev 的，两次运行都用了 Jev；没标的，两次都是 agent 自己读。没写得分的都是 1.00，只有 incident-logs 在 0.96 到 0.98 之间。两版都是自己读的时候，token 也会差 10k 左右，比如 V11 和 V12 的 bug-files 和 incident-logs。每组只跑 2 次，这个量级算正常波动。

大任务上，三个版本的每次运行都问了 Jev。12 轮内做完的，V6 是 4 次里 2 次，V11 是 0 次，V12 是 2 次，V12 那 2 次都在一开始加载那组，得分 1.00。没做完的运行，都是拿到 Jev 的结果后还在用 grep 和读文件逐条核对。对照任务上三个版本都没有误用。

## 结论

1. 延迟加载时，小任务让 agent 自己读更省：V11 比 V6 少 24%。V6 在 bug-files 和 change-review 上用了 Jev，比 V11 自己读多花 18k 和 30k。
2. 一开始就加载时，triage-tickets 和 repo-feature-files 上问 Jev 更便宜，30k 和 26k，V11 自己读要 41k 和 40k，得分也略高。V11 让 agent 改成自己读，这两项多花了 25k。
3. V12 没有做到按加载方式区分。两种加载方式下 agent 的做法一样：triage-tickets 都问了 Jev，其余任务都自己读。agent 看的是任务本身，不是工具怎么加载的。V12 和 V11 的 token 差别，大部分出在两版都自己读的任务上。
4. 采用 V11。在常见的延迟加载场景里它最省，也不依赖 Claude Code 把这类工具叫作 deferred。代价是 jev_ask 一开始就加载时，triage-tickets 这类任务比 V6 多花一些 token。

## 复现

三个版本都在 `f5aeb45` 上跑，只换 `src/tools/ask.ts` 里的 `ASK_INSTRUCTIONS`。V6 就是那个提交本身，V11 用本分支的说明，V12 在 V6 的第二句后面加上 "If jev_ask is deferred, loading it costs a turn, so read up to about 50 short files yourself instead."。

```bash
bun run eval --tasks bug-files,change-review,ci-failures,incident-logs,rename-callers --arms jev-code-deferred,jev-code --reps 2 --max-turns 20 --allow-unreviewed
bun run eval --tasks triage-tickets,repo-feature-files,payment-log-duplicates,refund-promises-audit --arms jev-code-deferred,jev-code --reps 2 --max-turns 12 --allow-unreviewed
```
