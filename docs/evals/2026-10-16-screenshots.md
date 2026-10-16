# 截图分拣：让 Jev 看图

2026-10-16，Sonnet（claude-sonnet-5-5），Claude Code 2.1.294，每组跑 2 次，每次最多 20 轮。代码是 `752a261`，也就是 SDK 0.7.0 加上图片支持；Jev 用默认的 `jev-latest`，现在指向 jev-1.13.0。标准答案还没经过人工复核，所以这里的得分只用来比较各组之间的差别。

## 问题

TypeSafe 10 月 14 日的版本让 Jev 能看 PNG 和 JPEG。服务器设了 `TYPESAFE_IMAGES=1` 后，`files` 会把这两种文件当成图片发给 Jev。这次想知道：答案只在图里的时候，让 Jev 看，比 agent 自己一张张打开能省多少 token。agent 打开一张 1280×720 的截图，上下文里大约多 1,300 token，之后每次模型调用都要再读一遍。

## 任务

新加的 `screenshot-triage`。工作区里只有 40 张商城页面截图，1280×720 PNG，用无头 Chrome 渲染：26 张正常，9 张报错，5 张一直没加载完。agent 要列出坏掉的页面，并说明是报错（error）还是没加载完（loading）。

评分把"文件加原因"当成一对，算 F1：既看列出来的对不对，也看有没有漏，满分 1，0.8 以上算通过。正常页面里放了干扰项：红色促销角标、绿色成功提示、写明为空的列表，还有一篇讲支付失败的帮助文章。文件名看不出页面状态。

## 怎么测

| 组别 | 设置 |
| --- | --- |
| baseline | 没有 Jev，agent 只能自己打开截图 |
| jev | 有 `jev_ask`，不提示 agent 用 |
| jev-directed | 同 jev，系统提示要求判断都交给 Jev |
| jev-code | 另有编码工具，`jev_ask` 一开始就加载，不提示 |
| jev-code-deferred | 同 jev-code，但 `jev_ask` 要先用 ToolSearch 加载 |

任务自带 `TYPESAFE_IMAGES=1`，所有带 Jev 的组都开着。开了以后，server instructions 多一句：Jev 也能看截图，agent 自己打开一张要多大约一千 token。instructions 原来的门槛是超过大约 50 个文件才先问 Jev，这个任务只有 40 张。

## 结果

| 组别 | 平均 token | 相对 baseline | 平均费用 | 峰值上下文 | 耗时 | 得分 |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 109k | — | $0.298 | 60k | 32 秒 | 0.96 |
| jev | 53k | −52% | $0.094 | 21k | 15 秒 | 1.00 |
| jev-directed | 37k | −66% | $0.053 | 14k | 13 秒 | 1.00 |
| jev-code | 53k | −52% | $0.075 | 18k | 12 秒 | 1.00 |
| jev-code-deferred | 65k | −40% | $0.112 | 24k | 17 秒 | 1.00 |

token 和费用只算 Claude 这边，费用按 API 标价折算。峰值上下文是一次模型调用最多读了多少 token。

4 个 Jev 组的 8 次运行都主动用了 Jev，平均 52k token，比 baseline 少 52%。baseline 两次都打开了全部 40 张；第 2 次把 product-lamp 和 product-chair 记混了，得 0.93。

每次运行：

| 组别 | 第几次 | token | 自己打开的截图 | 怎么问的 |
| --- | --- | --- | --- | --- |
| jev | 1 | 36k | 1 | 两个是非题，`where` 只要有问题的 |
| jev | 2 | 69k | 16 | 两个是非题，拿回全部 40 条 |
| jev-directed | 1 | 43k | 1 | 两个是非题，拿回全部；没把握的 12 张再问一个选择题 |
| jev-directed | 2 | 31k | 4 | 两个是非题，`where` |
| jev-code | 1 | 45k | 2 | 两个是非题，`where` |
| jev-code | 2 | 60k | 2 | 两个是非题，拿回全部 |
| jev-code-deferred | 1 | 62k | 5 | 两个是非题，`where` |
| jev-code-deferred | 2 | 68k | 9 | 一个三选一（error、loading、fine），`where` |

两个是非题指"有没有报错"和"有没有加载完"。jev-code 第 2 次先用 Bash 数了文件，多一次模型调用，所以打开的截图一样多，token 却多了 15k。jev-code-deferred 两次都先用 ToolSearch 加载 `jev_ask`，再用 Bash 数文件。

Jev 这边，把 40 张截图看一遍要 111k 到 114k input token，平均每张约 2,800，由 TypeSafe 计费。jev-directed 第 1 次又问了 12 张，一共 146k。

不经过 agent，直接调一次 `jev_ask`，用一个三选一问题（正常、报错、没加载完）问这 40 张：jev-1.13 答对 39 张，用时 2.2 秒，114k input token。31 张标了 act，全对；答错的那张 Jev 自己标了 abstain。jev-1.14（`jev-preview`）答对 38 张。

## token 还花在哪

1. 核对 Jev 没把握的截图。文本记录没把握时，原文会放在 `unsure` 里带回来，agent 不用再开文件；图片没有原文可带，只算进 `more_unsure`，agent 想核对只能自己打开。打开 1 张的两次是 36k 和 43k，打开 16 张的那次是 69k。
2. "有没有加载完"那题。合成的商品图是纯色块，Jev 容易看成加载时的灰色占位块，这一题没把握和答错的都多。jev-code-deferred 第 2 次打开的 9 张里，8 张其实是正常页面。
3. jev-directed 第 1 次换了个办法：没把握的 12 张没打开，而是再问 Jev 一个选择题（主区域是真内容，还是只有占位块），最后只开了 1 张。

## 结论

1. 答案只在截图里时，交给 Jev 看能省下一半左右的 agent token：4 个 Jev 组平均 52k，agent 自己看是 109k。Claude 这边的费用少 62% 到 82%，耗时减半，得分没降。
2. 两边加起来，token 并没有少。Jev 看一遍 40 张截图要约 112k token，和 agent 自己看的 109k 差不多，再加上 agent 的 52k，合计比 baseline 多。省下来的是 agent 的上下文、Claude 的费用和时间，TypeSafe 的账单会多一笔。
3. 截图只有 40 张，没到"大约 50 个"的门槛，没被要求用 Jev 的三组也都用了。其中 3 次先数了文件，数出 40 个，还是问了 Jev。图片那句说明可能起了作用，但这次没有不带这句的对照，不能确定。
4. 剩下的开销主要在核对没把握的截图上。

## 局限

- 每组只跑 2 次，几千 token 的差别可能只是波动。
- 只有一个任务，截图是合成的，比真实页面简单；商品图是纯色块，让"没加载完"那题偏难。
- 只测了 Sonnet。
- TypeSafe 还把图片当实验功能，每个请求都要带 `TypeSafe-Danger-Zone-Images: true`，请求格式、答案和限制都可能在之后的版本里变。

## 复现

```bash
bun run eval --tasks screenshot-triage --arms baseline,jev,jev-directed,jev-code,jev-code-deferred --reps 2 --max-turns 20 --allow-unreviewed
```

改了页面要重新生成截图，需要 Chrome，`CHROME` 可以指定别的浏览器：

```bash
bun run evals/tasks/screenshot-triage/generate.ts
```

直接调用那次用 `tests/helpers/mcp.ts` 里的 `inProcessClient` 起服务器，`TYPESAFE_FILES_ROOT` 设为任务的 `workspace/`，再设 `TYPESAFE_IMAGES=1`；`files` 传 `screenshots/*.png`，问一个 choice 问题，三个选项照任务说明写。jev-1.14 那次另设 `TYPESAFE_DEFAULT_MODEL=jev-preview`。
