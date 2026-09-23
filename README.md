# opencode-models-extends

OpenCode 插件:在模型配置里写 `extends` 引用共享模板文件,把重复的模型参数(limit、capabilities、settings、variants……)抽到一处维护,消除跨 provider 的重复配置。

支持 OpenCode v2 的两种配置方言(V1 `provider` / V2 `providers`),实测运行时 v2.0.14。

## 安装

在全局配置 `~/.config/opencode/opencode.jsonc`(Windows:`%USERPROFILE%\.config\opencode\`)的 `plugins` 里写包名,改完后重启 opencode 后台服务或新开会话生效:

```jsonc
{
  "plugins": ["opencode-models-extends"],
}
```

## 快速上手

### 1. 建模板文件 `extends.models.jsonc`

以 id 为键,值是模型参数模板(V1 catalog 风格与 V2 原生风格都接受,内部自动归一化):

```jsonc
{
  // V1 catalog 风格
  "qwen3.8-flash": {
    "limit": { "context": 262144, "output": 64000 },
    "modalities": { "input": ["text", "image"], "output": ["text"] },
    "tool_call": true,
    "variants": {
      "low": { "reasoningEffort": "low" },
      "xhigh": { "reasoningEffort": "xhigh" },
    },
  },
  // V2 风格,可再 extends 链式继承
  "qwen-common": { "settings": { "setCacheKey": true } },
  "qwen-flagship": {
    "extends": "qwen-common",
    "capabilities": { "tools": true, "input": ["text", "image"], "output": ["text"] },
    "limit": { "context": 262144 },
  },
}
```

放在全局配置目录或项目(任意上级)目录皆可,见下文「查找链」。

### 2. 在 opencode 配置里引用(锚点)

V2 写法:

```jsonc
{
  "providers": {
    "custom-provider": {
      "package": "aisdk:@ai-sdk/openai",
      "models": {
        "qwen/qwen3.8-flash": {
          "settings": { "extends": "qwen3.8-flash" },
          "variants": [],
        },
      },
    },
  },
}
```

V1 写法:

```jsonc
{
  "provider": {
    "custom-provider": {
      "npm": "@ai-sdk/openai",
      "models": {
        "qwen/qwen3.8-flash": {
          "options": { "extends": "qwen3.8-flash" },
          "variants": {},
        },
      },
    },
  },
}
```

`qwen/qwen3.8-flash` 的全部参数即来自模板;你在配置条目里额外写的部分,永远覆盖模板值。

> 示例中条目里的 `"variants": []` / `{}` 是**空占位标记**,启用模板 variants 所必需,见下表。

## 规则速查

| 主题 | 规则 |
|---|---|
| 查找链(低→高) | 全局 `~/.config/opencode/extends.models.json(c)` → 从文件系统根到启动目录逐级 `extends.models.json(c)` → 各级 `.opencode/` 下的同名文件;就近覆盖 |
| 合并规则 | 用户配置最终覆盖模板:`settings`/`body`/`compatibility` 递归合并;`headers` 按 key(大小写不敏感)覆盖;`limit`/`capabilities` 逐子键;数组与标量整值替换 |
| **模板 variants 需空标记** | 模板若提供 `variants`,对应模型条目必须声明 `variants`——V2 写 `"variants": []`、V1 写 `"variants": {}` 即可启用模板值并压掉 OpenCode 按「包+模型名」自动装配的 variants;条目声明真实 variants 时按「用户 > 模板」叠加。忘加标记会收到一条带解法的警告(详见 [ADR-0007](./docs/adr/0007-variants-assembly-bypass.md)) |
| 删除模板键 | 配置条目里写显式 `null`。⚠️ 只可靠用于 V2 `settings`:V1 `options` 里写 `null` 会让 OpenCode 把整个 provider 判为非法直接跳过(官方行为,非本插件限制) |
| 凭据占位 | 模板值支持 `{env:VAR}` 与 `{env:VAR:-默认值}`;变量未设且无默认 → 警告并删除该键 |
| 链式 extends | 模板条目顶层 `extends` 引用另一模板;成环/断链 → 警告并停止展开 |
| 热生效 | 修改链上已有模板/配置文件约 2 秒内自动生效;在更近的目录**新建**模板文件需重启 |
| `extends` 显示残留 | 注入完成后插件会剥掉 `extends`,但 `/api/model`、TUI `/models` 详情仍可能显示它(OpenCode 展示层行为);实际请求参数不受影响 |
| 失败面 | 一切问题均为**警告 + 跳过**,绝不阻塞启动;日志前缀 `[opencode-models-extends]`,位置在 OpenCode 日志文件 |
| 无效字段 | `attachment`、布尔 `temperature`、`release_date` 等在 V2 无对应语义 → 警告并忽略(对齐官方 V1→V2 迁移) |

## Non-goals

- **provider 级 extends**(共享 `package`/`baseURL` 等)不做——provider 复用交给 OpenCode 自身的配置分层。
- 模板**不会凭空注册模型**:只有在配置里显式写了 `extends` 的模型条目(锚点)才会被注入。
- 内置 provider(如 `anthropic`)的模型条目可以作锚点,顺带支持。

## 更多

- 设计决策与术语:[CONTEXT.md](./CONTEXT.md)、[docs/adr/](./docs/adr/)(0001–0007)
- 本地开发与 npm 发布流程(仓库维护者向):[AGENTS.md](./AGENTS.md)
- 包页:<https://www.npmjs.com/package/opencode-models-extends>
