# variants 不可经模板注入:保持写入 draft 但构建期警告

v2.0.14 实机实验(双探针:模板注入项用独有 id `tmpl-only`/独有键 `probeOnLow` 与自动装配集区分;对照组在配置条目直写 variants)证明:OpenCode 对模型 `variants` 的最终装配发生在 `ctx.model.transform` **之后**,公式为 `最终 variants = 配置条目原始 variants ?? 按 package 与模型名的自动装配`(装配源码实测:`FL` 表按包选生成器,openai 六档 effort、openai-compatible 兜底 low/medium/high、qwen/deepseek/kimi/glm 等名称有针对性的 toggle/effort 模板),transform 写入的 `draft.variants` 无论内容为何都被整体丢弃——连"Cw 返回空 + draft 非空"的兜底场景都不回读 draft(实验:`package` 伪造成 FL 表外值后响应 variants 为空而非 draft 的 4 项)。而 limit/capabilities/settings 等字段来自 transform 输出,不受影响。因此我们决定:插件**继续**把模板 variants 合并进 draft(前向兼容,若 OpenCode 未来改读 draft 则自动生效),但在数据集构建期对"模板链提供了 variants"的锚点输出一条警告,告知用户把 variants 写回模型配置条目(配置显式声明可完整压过自动装配,实测确认)。

## Consequences

- 模板消除重复的能力对 variants 这一项失效:用户配置里 variants 必须留在模型条目本地,不能集中到模板文件。README 显著说明,并给出替代方案(v2 的自动装配已覆盖常见包+模型组合;不匹配时保留配置条目 variants)。
- 这是运行时装配层的限制,不是合并语义的问题:ADR-0003 的"按 id 对齐深合并"仍在插件层保留(写进 draft 的值本身是正确的),未来 OpenCode 若把 draft.variants 纳入装配链,警告即可撤销而无需改动合并逻辑。
- 警告放在构建期而非 transform 期:构建期能区分"variants 来自模板链"与"variants 是锚点自带"(后者天然生效,不应告警),且每世代每锚点只警一次,不随 reload 重放刷屏。
