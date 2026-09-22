// 归一化:V1/V2 双格式、校验失败字段丢弃、extends 剥离
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeModelEntry, readAnchorExtends } from "../src/normalize.ts"

function collect() {
  const warnings: string[] = []
  return { warnings, warn: (m: string) => warnings.push(m) }
}

test("V1 catalog 风格条目 → V2 partial(对应用户样例)", () => {
  const { warnings, warn } = collect()
  const norm = normalizeModelEntry(
    {
      attachment: true,
      limit: { context: 262144, output: 64000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      temperature: true,
      tool_call: true,
      variants: { low: { reasoningEffort: "low" }, xhigh: { reasoningEffort: "xhigh" } },
    },
    "t",
    "template",
    warn,
  )!
  assert.deepEqual(norm.partial, {
    limit: { context: 262144, output: 64000 },
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: [
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "xhigh", settings: { reasoningEffort: "xhigh" } },
    ],
  })
  assert.equal(norm.extendsId, undefined)
  assert.equal(warnings.length, 2) // attachment + boolean temperature
  assert.match(warnings.join("\n"), /attachment/)
  assert.match(warnings.join("\n"), /temperature/)
})

test("数值 temperature → settings.temperature;V2 原生键透传", () => {
  const { warnings, warn } = collect()
  const norm = normalizeModelEntry(
    { temperature: 0.3, settings: { base: 1 }, headers: { "X-K": "v" }, limit: { context: 10 } },
    "t",
    "template",
    warn,
  )!
  assert.deepEqual(norm.partial.settings, { base: 1, temperature: 0.3 })
  assert.deepEqual(norm.partial.headers, { "X-K": "v" })
  assert.deepEqual(warnings, [])
})

test("settings 已给 temperature 时数值顶层键不覆盖", () => {
  const { warn } = collect()
  const norm = normalizeModelEntry({ temperature: 0.9, settings: { temperature: 0.1 } }, "t", "template", warn)!
  assert.equal((norm.partial.settings as Record<string, unknown>).temperature, 0.1)
})

test("无效字段丢弃、其余保留", () => {
  const { warnings, warn } = collect()
  const norm = normalizeModelEntry(
    { limit: { context: "big", output: 7 }, tool_call: "yes", name: "ok" },
    "t",
    "template",
    warn,
  )!
  assert.deepEqual(norm.partial, { limit: { output: 7 }, name: "ok" })
  assert.equal(warnings.length, 2)
})

test("V1 id→modelID;modelID 键优先;status deprecated→disabled", () => {
  const { warn } = collect()
  const a = normalizeModelEntry({ id: "Qwen/Qwen3.8-Flash" }, "t", "template", warn)!
  assert.equal(a.partial.modelID, "Qwen/Qwen3.8-Flash")
  const b = normalizeModelEntry({ id: "api-name", modelID: "real-name" }, "t", "template", warn)!
  assert.equal(b.partial.modelID, "real-name")
  const c = normalizeModelEntry({ status: "deprecated" }, "t", "template", warn)!
  assert.equal(c.partial.disabled, true)
})

test("cost:V1 cache_read/cache_write → cache.read/write,单对象包成数组", () => {
  const { warn } = collect()
  const norm = normalizeModelEntry({ cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 } }, "t", "template", warn)!
  assert.deepEqual(norm.partial.cost, [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }])
})

test("锚点模式:settings.extends 与 options.extends 读取并剥离", () => {
  const { warn } = collect()
  assert.equal(readAnchorExtends({ settings: { extends: "id-a" } }), "id-a")
  assert.equal(readAnchorExtends({ options: { extends: "id-b" } }), "id-b")
  assert.equal(readAnchorExtends({ settings: { other: 1 } }), undefined)
  const norm = normalizeModelEntry({ options: { extends: "x", setCacheKey: true } }, "a", "anchor", warn)!
  assert.deepEqual(norm.partial.settings, { setCacheKey: true })
  assert.equal(norm.extendsId, undefined) // 锚点模式指针不进 extendsId
})

test("未知字段与顶层 extends(锚点模式)会被警告", () => {
  const { warnings, warn } = collect()
  normalizeModelEntry({ foo: 1, extends: "x" }, "a", "anchor", warn)!
  assert.match(warnings.join("\n"), /foo/)
  // 锚点模式顶层 extends 不消费(只认 settings/options 内),但也不应崩
})
