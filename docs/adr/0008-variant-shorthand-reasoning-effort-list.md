# 模板条目增设 variant 速记:单轴 `reasoningEffortList`,与显式 variants 深合并

模板里 reasoning 模型的 variants 块是重复度最高的书写负担:每个档位都要把同一个值写两遍(id 与 `reasoningEffort` 值)。新增**「variant 速记」**(术语见 [CONTEXT.md](../../CONTEXT.md)):模板条目可写 `"reasoningEffortList": ["low", "medium", "high"]`,归一化时展开为 `id = 值` 的普通 variants,此后完全走既有管道(链式合并、`{env:VAR}`、ADR-0007 空标记规则),零特判。

决策(逐条经 grill 确认):

- **仅模板条目支持,锚点不支持**:锚点顶层加未知键有官方 schema 判 malformed 的风险(ADR-0001 的教训),且锚点与 ADR-0007 空标记逻辑的交互不宜再叠一层。
- **单轴,字段名焊死 `reasoningEffort`**:泛化方案(`variantExpand: {key: [...]}`)会立刻引出"多键值怎么配对"(笛卡尔积?zip?)的复杂度,而 reasoningEffort 之外暂无真实轴;真要第二轴时泛化作为新决策另立 ADR,路径留而不堵。
- **同 id 深合并**:速记生成的项与同条目显式 `variants` 按 id 对齐、字段叠加、显式赢(复用 `mergeVariants`,base=速记 override=显式),与全局"对象逐层叠加"哲学一致;`variants.low` 不写 `reasoningEffort` 时速记值存活而非被整项替换。
- **顺序约定**:速记项按数组序在前,显式独有 id 追加在后;跨链沿用"已有 id 保位、新 id 追加"。速记的动机之一就是控制 TUI 选择器展示顺序。
- **脏输入**:非字符串/空串元素 → 警告+跳过;重复项 → **静默**去重保留首次(语义等价整理,非错误);字段整体非数组 → 警告+忽略;`[]` 合法(展开为空)。速记键在归一化时被消费,绝不泄漏进输出 partial。

## Consequences

- 只写速记的模板条目仍受 ADR-0007 空标记规则约束(锚点不带 `"variants": []`/`{}` 标记时照样被自动装配覆盖),警告文案无需改动——概念上速记产物就是 variants。
- 展开发生在**每个条目归一化时**、链式合并之前,因此"父模板用速记、子模板显式覆盖同 id"等跨级场景自动遵循 ADR-0004 的链规则(已有集成测试锁行为)。
- 未来若加 `thinkingBudgetList` 之类,会先撞上"单轴 vs 泛化"这条决策——届时应显式修订本 ADR 而非静默扩列。
