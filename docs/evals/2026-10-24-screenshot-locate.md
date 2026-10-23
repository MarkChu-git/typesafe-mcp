# 截图定位：让 Jev 框出问题在哪

2026-10-24，Sonnet（claude-sonnet-5-5），Claude Code 2.1.294，每组跑 2 次，每次最多 40 轮。代码是 PR #42：第一轮用的是其中的 `a646f50`，即 `jev_ask` 的 Box 问题加上这次新加的任务；重跑用的是改了 Box 说明的 `b3706b1`，这句说明后来改回了原样。两个提交都在 PR #42 里。Jev 用默认的 `jev-latest`，现在指向 jev-1.14.0。标准答案还没经过人工复核，所以这里的得分只用来比较各组之间的差别。

## 问题

`jev_ask` 新加了 Box 问题：给一张图和一句描述，Jev 返回一个框，四条边是图片高和宽的比例。[直接调 API 的测试](2026-10-23-box.md)量过 Jev 框得准不准。这次换成 agent 来做同一类事：说出每张截图上的问题在哪。agent 自己打开截图估坐标，和把截图交给 Jev 框，token 和准确度各差多少。

## 任务

新加的 `screenshot-locate`，用 `screenshot-triage` 的 40 张商城截图（1280×720 PNG）。提示里直接列出 14 张坏掉的页面和原因：9 张报错，5 张没加载完。agent 要给每张一个框，用像素坐标写左、上、右、下。框什么，提示里写明了：

- 报错：提示条、弹出的提示、出错的输入框连同下面的错误信息，或错误页上的代码、文字和按钮。
- 没加载完：转圈图标连同加载文字，或灰色占位块。

标准框用 Playwright 在渲染截图的同一个 Chrome 里量。有背景或边框的部分取元素的框，居中的文字取文字本身占的范围，再把这些合成一个框。量之前先核对 Playwright 截的图和工作区里的截图逐字节相同。

评分时每张只看 agent 给的第一个框：框的中心落在标准框里（四边各放宽 16 像素）就算找到。得分是 14 张里找到的比例，0.8 以上算通过。另外算了 IoU，即两个框重叠部分占两者合起来面积的比例，1 是完全重合；它只用来看框得紧不紧，不计分。

## 怎么测

| 组别 | 设置 |
| --- | --- |
| baseline | 没有 Jev，agent 只能自己打开截图 |
| jev | 有 `jev_ask`，不提示 agent 用 |
| jev-code-deferred | 另有编码工具，`jev_ask` 要先用 ToolSearch 加载，也不提示 |

任务自带 `TYPESAFE_IMAGES=1`，两个 Jev 组都开着。开了以后 `jev_ask` 的说明里多出图片和 Box 两段，其中写着 Box 总会给一个框，所以要在同一次调用里配一个是非题问目标在不在。这个任务的提示已经说了 14 张都坏了，配不配是非题都行。

## 结果

| 组别 | 平均 token | 相对 baseline | 平均费用 | 峰值上下文 | 耗时 | 得分 | 平均 IoU |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 43k | — | $0.118 | 24k | 20 秒 | 1.00 | 0.96 |
| jev | 26k | −40% | $0.057 | 12k | 17 秒 | 1.00 | 0.71 |
| jev-code-deferred | 84k | +93% | $0.156 | 33k | 22 秒 | 1.00 | 0.97 |

token 和费用只算 Claude 这边，费用按 API 标价折算。峰值上下文是一次模型调用最多读了多少 token。

6 次运行都找到了全部 14 处问题，得分都是 1.00，按中心点算分分不出高下。差别在框得紧不紧：agent 自己看图估的框平均 IoU 在 0.96 以上，用 Jev 框的 jev 组是 0.71。

每次运行：

| 组别 | 第几次 | token | 自己打开的截图 | 怎么问 Jev | 用了 Jev 的框 | 平均 IoU |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 1 | 32k | 14 | — | — | 0.96 |
| baseline | 2 | 55k | 15 | — | — | 0.96 |
| jev | 1 | 18k | 0 | 报错和没加载完分两次问，每次一个 Box 问题 | 14 张 | 0.68 |
| jev | 2 | 34k | 4 | 一次问 14 张，每张两个 Box 问题：报错在哪、加载提示在哪 | 10 张 | 0.74 |
| jev-code-deferred | 1 | 102k | 14 | 先用 ToolSearch 加载，再像 jev 第 2 次那样问 | 0 | 0.97 |
| jev-code-deferred | 2 | 66k | 14 | 没用 Jev | — | 0.98 |

baseline 两次都在第一轮就打开了全部 14 张，上下文从 4.5k 涨到 24k。第 2 次又打开一遍 returns-start，多一次模型调用，token 多了 23k。

Jev 这边，看 14 张截图要 38.5k 到 38.9k input token，平均每张约 2,750，由 TypeSafe 计费。每张多问一个 Box 问题只多二十几个 token。

## 框得准不准

Box 答案按比例给，jev 组的 agent 自己乘上 1280 和 720 换成像素。三次调用里，问对类型的框有 42 个（报错页问报错，没加载完的页面问加载提示），中心全都落在标准框里，但框得偏松，IoU 中位数 0.74：

- 整行宽的提示条：左右差 2 像素以内，下边多出 12 到 19 像素。提示条只有 48 像素高，IoU 只有 0.7 左右。
- 转圈图标加文字：Jev 的框比标准框窄，左边缩进 16 到 43 像素，右边缩进 3 到 30 像素，没包住整行加载文字，IoU 0.38 到 0.74。
- 错误页：jev 第 1 次的两个框只包住中间一块，左右各窄了 68 到 93 像素，IoU 0.47 和 0.50。

Jev 的把握和框紧不紧关系不大。42 个框里 25 个标了 act，IoU 从 0.38 到 0.95；标 abstain 的 7 个里，两张灰色占位页的框反而很准，IoU 0.84 到 0.91。act 只说明框在对的位置，不说明框得紧。

agent 最后交上来的框里，24 个直接用了 Jev 的，IoU 中位数 0.71，最低 0.39；60 个是自己看图估的，中位数 0.98，最低 0.83。

## token 还花在哪

1. 每张都问两个 Box。jev 第 2 次和 jev-code-deferred 第 1 次对每张截图都问了"报错在哪"和"加载提示在哪"。Box 总会给一个框，问错类型的那题没把握，于是 14 张都进了 `more_unsure`。jev 第 2 次只打开了对的那题把握最低的 4 张（0.59 以下）。jev-code-deferred 第 1 次觉得"有几张 Jev 弃权了"，把 14 张全打开，token 比没用 Jev 的第 2 次还多 37k。
2. 编码工具。jev-code-deferred 第一轮上下文就有 10.6k token，baseline 是 4.5k，多出来的是编码工具和 ToolSearch 的定义，每次模型调用都要再读一遍。
3. 图不多。14 张截图自己看一遍只多约 1.9 万 token，jev-code-deferred 第 2 次没去加载 `jev_ask`，直接自己看了。

## 改说明后重跑

针对第 1 点，把 `jev_ask` 说明里 Box 那段的第二句换成 "Jev gives a box even for a missing target, so ask one box per target, only of files known to show it, else pair it with a noul."，意思是 Jev 对图里没有的目标也会给框，所以每种目标只问一个 Box，只问已知有这个目标的文件，否则配一个是非题。这段从 195 个字符变成 220 个，没开图片时工具定义不变。jev 和 jev-code-deferred 各重跑 2 次，花了约 $0.47：

| 组别 | 第几次 | token | 自己打开的截图 | 没把握的文件 | 用了 Jev 的框 | 平均 IoU |
| --- | --- | --- | --- | --- | --- | --- |
| jev | 1 | 80k | 14 | 6 | 0 | 0.97 |
| jev | 2 | 32k | 3 | 9 | 11 | 0.70 |
| jev-code-deferred | 1 | 63k | 4 | 4 | 10 | 0.78 |
| jev-code-deferred | 2 | 95k | 14 | 7 | 0 | 0.97 |

4 次都照新说明做了：报错和没加载完分两次问，每次只带有这种问题的截图。改之前，用了 Jev 的 3 次里有 2 次每张都问两个 Box，问错类型的框有 28 个；这次一个都没有。没把握的文件从每次 14 个降到 4 到 9 个。

token 却没降：

| 组别 | 改之前平均 token | 改之后平均 token | 用了 Jev 的运行 | 用完 Jev 又把 14 张全打开 |
| --- | --- | --- | --- | --- |
| jev | 26k | 56k | 2/2 → 2/2 | 0 → 1 次 |
| jev-code-deferred | 84k | 79k | 1/2 → 2/2 | 1 → 1 次 |

jev 第 1 次和 jev-code-deferred 第 2 次拿到 Jev 的框以后，还是把 14 张全打开自己框，理由都是几张框得粗、没把握。Jev 的框和第一轮一样松：重跑的 56 个框中心全落在问题上，IoU 中位数 0.73，标 act 的 30 个中位数 0.74。没把握的文件少了，可每次总还剩几张，任务又要像素框，agent 看到有几张没把握，就容易全部自己重看一遍。

## 结论

1. 位置都找得到。10 次运行都找到了全部 14 处问题，Jev 问对类型的 98 个框也都落在问题上。
2. 框的松紧差得多。在这批合成截图上，Sonnet 自己估的框（IoU 中位数 0.98）比 jev-1.14 的框（0.71）紧得多。按目标检测常用的 IoU 0.5 算，jev 第 1 次 14 张里只有 10 张过线，第 2 次 12 张。只要知道问题大概在哪，Box 够用；要贴着边的框，还是 agent 自己看图准。
3. 不打开截图时最省。jev 第 1 次一张图都没开，18k token，不到 baseline 的一半。平均下来 jev 组比 baseline 少 40% token、少 52% 费用，但只跑了 2 次，baseline 自己两次之间就差了 23k。
4. 每张都问两个 Box，14 张会全显得没把握。说明改成每种目标只问有它的文件以后，重跑的 4 次全照做，没把握的文件降到 4 到 9 个，但 token 没省下来：有 2 次照样把 14 张全打开。agent 会不会自己重看，主要看 Jev 的框紧不紧、把握高不高，问法只占一部分。
5. Claude 和 Jev 的 token 加起来并没有少：jev 组 agent 平均 26k，Jev 看 14 张要 39k，合计比 baseline 的 43k 多。省下的是 agent 的上下文和 Claude 的费用。

## 局限

- 每组只跑 2 次，第一轮 jev-code-deferred 只有 1 次用了 Jev。重跑没有重跑 baseline，比较用的是第一轮的 baseline。
- 只有一个任务。截图是合成的，干净、对比强，agent 自己估坐标比在真实页面上容易。
- 提示里直接给了坏掉的页面和原因，只测定位，不测找出哪些页面坏了，那是 `screenshot-triage` 测的。
- 按中心点算分太宽，三组都是满分；IoU 只作参考，没算进得分。
- 只测了 Sonnet 和 jev-1.14。TypeSafe 还把图片当实验功能，每个请求都要带 `TypeSafe-Danger-Zone-Images: true`。

## 复现

```bash
bun run eval --tasks screenshot-locate --arms baseline,jev,jev-code-deferred --reps 2 --allow-unreviewed
```

重跑是在 `b3706b1` 上：

```bash
bun run eval --tasks screenshot-locate --arms jev,jev-code-deferred --reps 2 --allow-unreviewed
```

IoU 不在 `summary.md` 里：用任务的 `score()` 给 `runs/*.json` 里每次的答案重新打分，`details.iou` 就是平均 IoU；单张的 IoU 把答案和标准答案各留一张再打分。Jev 每个框的把握和 decision 在 `runs/*.jsonl` 的 `tool_use_result` 里。

截图重新生成后，标准框也要重新量，需要 Chrome，`CHROME` 可以指定别的浏览器：

```bash
bun run evals/tasks/screenshot-locate/generate.ts
```
