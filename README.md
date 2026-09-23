# opencode-models-extends

OpenCode 插件:用 `extends` 引用模板文件,消除多个 provider 之间重复的模型参数配置。

设计决策见 [`CONTEXT.md`](./CONTEXT.md) 与 [`docs/adr/`](./docs/adr/)(0001–0006)。

## 安装

在**全局**配置 `~/.config/opencode/opencode.jsonc`(Windows:`%USERPROFILE%\.config\opencode\`)的 `plugins` 里引用本目录:

```jsonc
{
  "plugins": ["D:/Repo/Temp/opencode-plugin/provider-model-update"],
}
```

(或将路径改成本机实际位置;项目级配置的 `plugins` 里写相对路径如 `"../provider-model-update"` 实测也可。)改完后重启 opencode 后台服务或新开会话生效。

**目录插件入口契约**(v2.0.14 实测):OpenCode 对目录型插件只解析 `<目录>/server.*` 与 `<目录>/index.*`,**完全无视 `package.json#main`**;两者都找不到就静默跳过、零日志。所以仓库根必须有 `index.ts`(re-export `src/index.ts`),不要删除或挪走。


## 用法

### 1. 模板文件 `extends.models.jsonc`

以 id 为键,值是模型参数模板。**V1 catalog 风格与 V2 原生风格都接受**(内部归一化为 V2):

```jsonc
{
  // V1 风格
  "qwen3.8-flash": {
    "limit": { "context": 262144, "output": 64000 },
    "modalities": { "input": ["text", "image"], "output": ["text"] },
    "tool_call": true,
    "variants": {
      "low": { "reasoningEffort": "low" },
      "xhigh": { "reasoningEffort": "xhigh" },
    },
  },
  // V2 风格 + 链式继承(ADR-0004)
  "qwen-common": { "settings": { "setCacheKey": true } },
  "qwen-flagship": {
    "extends": "qwen-common",
    "capabilities": { "tools": true, "input": ["text", "image"], "output": ["text"] },
    "limit": { "context": 262144 },
  },
}
```

> 💡 **模板里的 `variants` 需要配置条目加一个空标记才会生效**:OpenCode v2 在插件 transform 之后按「配置条目声明的 variants 做 merge ?? 包与模型名自动装配整覆盖」重建 variants。条目写 `"variants": {}`(V1)或 `"variants": []`(V2)即可切到 merge 路径、启用模板值并压掉自动装配(ADR-0007)。没加标记且模板含 variants 时插件会警告。

### 2. 在 opencode 配置里引用(锚点)

`extends` 写在模型级 `settings`(V1 写法为 `options`)里(ADR-0001):

```jsonc
// V2 原生写法。模板若含 variants,条目必须声明 variants:写 [] 启用模板值(见 ADR-0007);
// 也可直接写真实 variants,会按"用户 > 模板"叠加。不含 variants 的模板可省略这个键。
{
  "providers": {
    "aihub": {
      "package": "aisdk:@ai-sdk/openai",
      "models": {
        "gpt-6-sol": {
          "settings": { "extends": "qwen3.8-flash" },
          "variants": [],
        },
      },
    },
  },
}
```

```jsonc
// V1 写法(npm 为 V1 provider 字段;模型级 options.extends 作锚点)
{
  "provider": {
    "aihub": {
      "npm": "@ai-sdk/openai",
      "models": {
        "gpt-6-sol": {
          "options": { "extends": "qwen3.8-flash" },
          "variants": {}, // 模板 variants 生效所需:V1 用 {} 而非 [](V2)
        },
      },
    },
  },
}
```

## 语义速查

| 主题 | 规则 |
|---|---|
| 查找链(低→高) | 全局 `~/.config/opencode/extends.models.json(c)` → 从文件系统根到启动目录逐级 `extends.models.json(c)` → 各级 `.opencode/` 下的同名文件 |
| 同 id 合并 | 就近文件的条目深合并覆盖远端;用户配置最终覆盖模板 |
| 合并规则 | `settings`/`body`/`compatibility` 递归合并;`headers` 按 key(大小写不敏感)覆盖;`limit`/`capabilities` 逐子键;数组与标量整值替换 |
| **`variants` 需空标记**(v2.0.14) | OpenCode 在插件 transform 之后重建 variants:条目**声明过** `variants`(含空)→ 按 id merge,模板值存活;条目**没声明** → 按包+模型名自动装配整覆盖,模板值丢失。所以模板若提供 variants,配置条目需加 `"variants": []`(V2)/ `"variants": {}`(V1)空标记。条目声明真实 variants 时按"用户 > 模板"叠加。无标记且模板含 variants → 警告。详见 ADR-0007 |
| 删除模板键 | 用户侧写显式 `null`(ADR-0003)。⚠️ 只可靠用于 **V2 `settings`**:V1 `options` 里写 `null` 会让 OpenCode 把整个 provider 判为非法直接跳过(官方解码行为) |
| 凭据 | 模板可用 `{env:VAR}` / `{env:VAR:-默认值}`;变量未设且无默认 → 警告并删除该键(ADR-0005) |
| 链式 extends | 模板条目顶层 `extends`;每跳按查找链就近解析;成环/断链 → 警告并停止展开(ADR-0004) |
| `extends` 键显示 | 插件会从生效配置剥掉 `extends`,但 `/api/model`、TUI `/models` 详情仍可能显示它——OpenCode 在插件 transform 之后还会把模型原始 config 合并回展示层。生效参数不受影响;残留的 `extends` 对 SDK 是未知选项,会被忽略 |
| 注入机制 | 主注入点 `ctx.model.transform`(config 注入的 provider 在 `provider.transform` 快照中不可见,v2.0.14 实测);`provider.transform` 仅兜底内置目录模型;草稿编辑必须**整体重赋值**嵌套对象(原地 mutate 不被追踪) |
| 失败面 | 全部为**警告 + 跳过**,不阻塞启动;日志前缀 `[opencode-models-extends]`,见 `~/.local/share/opencode/log/opencode.log` |
| 热生效 | 修改链上**已知**模板/配置文件约 2 秒内自动生效;在更近的目录**新建**模板文件需重启 |
| 无效字段 | `attachment`、布尔 `temperature`、`release_date` 等在 V2 无对应 → 警告并忽略(对齐官方 V1→V2 迁移语义) |

## Non-goals

- **provider 级 extends**(共享 `package`/`settings`/`baseURL`)不做 —— ADR-0006。
- 模板**绝不凭空注册模型**:只有 opencode.json 里写了 `extends` 的模型配置项(锚点)会触发注入。
- 内置 provider(如 `anthropic`)的模型配置项**可以**作锚点,顺带支持。

## 开发

```sh
npm install
npm test
```

纯逻辑(合并/归一化/数据集/草稿写入)在 `src/{merge,normalize,dataset,jsonc,apply}.ts`,插件接线在 `src/index.ts`(根 `index.ts` 是加载契约要求的入口 re-export)。测试:`test/*.test.ts`,共 32 项。

## 发布(GitHub Actions)

CI(`.github/workflows/ci.yml`)在 push/PR 到 `main` 时跑测试;发布(`.github/workflows/release.yml`)由 **tag push 触发**,链路为:测试 → 校验 tag 与 `package.json` 版本一致 → `npm publish --provenance`(npm Trusted Publishing / OIDC,常态化后**无需**任何仓库 secret)。

### 一次性引导:首发

npm 目前不允许用 OIDC 发包的**首个版本**,trusted publisher 也必须在包已存在之后才能登记(见 npm/cli#8544 与 `npm trust` 文档 "Package must exist")。所以首发要手动两步,之后全部回归纯 tag 流水线:

```sh
# 前提:npm 账号已开 2FA;npm CLI ≥ 11.15(npm trust 命令要求)
npm login          # 浏览器网页授权(不要用绕过 2FA 的 Granular Token,npm trust 不接受)
npm publish --access public   # 首发 0.1.0;本地发带不了 --provenance(provenance 仅支持 GitHub Actions/GitLab 云 runner),从下一版起都有
npm trust github --file release.yml --repo MiaYoshi/opencode-models-extends --allow-publish
npm trust list     # 确认登记成功
```

`npm trust github` 是网页 "Add trusted publisher" 表单的 CLI 等价物(匹配条件 = 仓库 + workflow 文件名,与 tag 模式无关;限定 tag 推送是我们 workflow 自己的 `on.push.tags`)。也可以在 npmjs.com 网页上完成同样的登记。

### 常规发版

1. 改 `package.json` 的 `version`(如 `0.1.1`)并提交推送;
2. `git tag v0.1.1; git push origin v0.1.1`;
3. Actions 自动:测试 → 版本一致性校验 → OIDC 换取一次性发布令牌 → `npm publish --provenance`,包页出现 Attestations。

tag 与 `package.json` 版本不一致时 workflow 直接失败拒发。
