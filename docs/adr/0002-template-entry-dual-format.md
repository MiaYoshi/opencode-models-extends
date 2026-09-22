# 模板条目同时接受 V1 风格与 V2 原生格式,内部归一化

模板文件条目要注入 V2 域(`Model.Info`),而用户的既有习惯和样例是 V1 catalog 风格(`tool_call`/`modalities`/variants 对象)。我们决定两种格式都接受,插件内归一化到 V2 形态;V2 中已无效的字段(`attachment`、布尔 `temperature`)丢弃并警告。

## Consequences

- 存在一个独立于 OpenCode 的映射层(`tool_call`→`capabilities.tools`、`modalities`→`capabilities.input/output`、variants 对象→带 `id` 的数组、顶层生成参数→`settings`),OpenCode 官方映射规则变化时需人工跟进。
- 若当初选 V2-only,用户须先迁移习惯;若选 V1-only,则 perpetuate 官方劝退的格式。取并集是为 DX 付的小额长期成本。
