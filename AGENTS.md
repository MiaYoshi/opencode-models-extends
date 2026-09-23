# AGENTS.md

面向 **贡献者与 coding agent** 的开发/维护手册。用户文档见 [`README.md`](./README.md);设计术语与决策见 [`CONTEXT.md`](./CONTEXT.md) 与 [`docs/adr/`](./docs/adr/)(0001–0007)。

## 本地开发

```sh
npm install
npm test
```

- 无构建步骤:以 TypeScript **源码**形态发布(`package.json#files` 只含 `index.ts` 与 `src/`,运行时由 OpenCode 直接 import)。
- 测试依赖 Node ≥ 24 的原生 TS type-stripping 直接跑 `.ts`(`node --test "test/*.test.ts"`);本机无 bun。
- 目录职责:
  - 根 `index.ts` —— 入口 re-export。**OpenCode 对目录插件只解析 `<dir>/server.*` / `<dir>/index.*`,完全无视 `package.json#main`,找不到就静默跳过零日志**——此文件不可删除或挪走。
  - `src/index.ts` —— 插件接线:`ctx.model.transform` 主注入、`provider.transform` 兜底内置目录模型、已知文件 mtime+size 轮询触发 `model.reload()/provider.reload()`。
  - `src/dataset.ts` —— 配置/模板查找链叠合、extends 链展开、构建期警告(含 variants 空标记检测)。
  - `src/normalize.ts` —— V1 catalog 风格 → V2 归一化(`tool_call`→capabilities.tools、`modalities`→input/output、variants 对象→带 id 数组等)。
  - `src/merge.ts` —— 深合并(对象递归、headers 大小写不敏感、variants 按 id 对齐、`null` 删键)。
  - `src/apply.ts` —— 草稿写入:copy-on-write + 剥除 `extends` 键。
  - `src/jsonc.ts` —— JSONC 解析(jsonc-parser)。
- 测试:`test/*.test.ts`,32 项纯逻辑断言,无运行时 e2e(实机验证方法见下)。

## OpenCode v2.0.14 硬契约(源码+实测坐实,勿再猜测/重复验证)

1. **目录插件入口**:`<dir>/server.*` 或 `<dir>/index.*`,package.json#main 无效;缺失=静默跳过。
2. **`ctx.provider.transform` 可见性**:editor 快照只含内置 catalog provider(约 221 个),配置注入的 provider 不在其中;主注入点必须用 `ctx.model.transform`。
3. **草稿变更追踪**:editor 只追踪属性**重赋值**,对嵌套对象原地 mutate/delete 会丢失 → 必须 copy-on-write 整体重赋值(`src/apply.ts` 已处理)。
4. **variants 装配**:最终 variants 由内置 `opencode.config.provider` 在外部 transform 之后重建——配置条目声明过 `variants`(含空数组/空对象)→ 按 id merge(插件注入存活);完全没声明 → 按 package+模型名自动装配整字段覆盖。绕过 = 条目空标记,全链路见 [ADR-0007](./docs/adr/0007-variants-assembly-bypass.md)。

## 改动原则

- 一切错误路径 = **警告 + 跳过**,绝不抛出异常阻塞 opencode 启动;日志前缀 `[opencode-models-extends]`。
- 模板绝不凭空注册模型;锚点 = 配置里写了 `extends` 的模型条目。
- 用户显式 `null` = 删除键;仅限 V2 `settings`(V1 `options` 写 null 会让官方解码把 provider 判 malformed)。
- commit 信息用 Conventional Commits。

## 实机验证方法

- 另起独立服务:`opencode serve --port <空闲端口> --print-logs`,Basic 认证 `opencode:<password>`(密码见其启动日志);查询 `/api/model` 断言(响应里 `id` == `modelID`,过滤用 `providerID` + `id`)。
- **不要**对共享服务/TUI 执行会触发重启的操作(历史事故:`opencode plugin list` 重启打断活动会话)。
- 冷启动竞态:`editor.list()` 可能为空,判空跳过;插件 `console.log/warn` 只在 `--print-logs` 的 stdout 可见。
- 插件文件被 OpenCode watch,改 `src/*.ts` 后热重载重放,无需重启验证服务。
- 展示层注意:`/api/model` 仍会显示配置里的原始 `extends` 键(OpenCode 在 transform 之后把 raw config 合并回展示层),生效参数不受影响。

## 发布

日常发版(全自动,无任何仓库 secret):

```sh
npm version 0.0.2 -m "chore: release 0.0.2"   # 改 package.json + lock,生成 commit 与 tag
git push origin main && git push origin v0.0.2
# → .github/workflows/release.yml:测试 → tag 与版本一致性校验(不一致直接拒发)→ npm publish --provenance
```

- 认证走 npm Trusted Publishing(OIDC),需要 `permissions: id-token: write` 与 GitHub **公共仓库**(私有仓库不生成 provenance)。
- `ci.yml` 在 push/PR 到 `main` 时跑测试。

一次性引导(**已完成,勿重做**,留档备查):

- npm 不允许 OIDC 发包的首个版本,trusted publisher 也必须在包存在后登记(npm/cli#8544;`npm trust` 文档 "Package must exist")。0.0.1 由 `npm login` + `npm publish --access public` 手动首发(该版本无 provenance;本地发布不支持 provenance)。
- Trusted Publisher 已登记:`npm trust github --file release.yml --repo MiaYoshi/opencode-models-extends --allow-publish`(`npm trust list` 可查;npm CLI ≥ 11.15 才有 `npm trust`,账号需开 2FA,绕过 2FA 的 Granular Token 不被接受)。
- 坑:npm 保存 trusted publisher 配置时**不做校验**(写错只在发布那刻报 ENEEDAUTH);2026-09-03 起新建 trusted publisher 默认只允许 `npm stage publish`,必须显式 `--allow-publish`(或网页 Allowed actions 勾上 `npm publish`)。

## 其他事实

- npm 包 metadata 的 `maintainers` 字段由 registry 自动写入账号邮箱,无法隐藏。
- `@opencode/plugin` 钉 2.0.14(与实测运行时一致);升级 OpenCode 版本后上述契约需回归验证(尤其第 4 条)。
