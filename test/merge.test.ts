// 深合并 / variants 按 id 对齐 / null 删除 / env 替换
import { test } from "node:test"
import assert from "node:assert/strict"
import { deepMerge, mergeVariants, mergeModelPartial, substituteEnv } from "../src/merge.ts"

test("deepMerge:override 赢,对象递归,数组整值替换", () => {
  const base = { limit: { context: 100, output: 50 }, tags: ["a", "b"], name: "x" }
  const merged = deepMerge(base, { limit: { output: 99 }, tags: ["c"], y: 1 })
  assert.deepEqual(merged.limit, { context: 100, output: 99 })
  assert.deepEqual(merged.tags, ["c"])
  assert.equal(merged.name, "x")
  assert.equal(merged.y, 1)
})

test("deepMerge:显式 null 删除键", () => {
  const merged = deepMerge({ settings: { temperature: 0.7, keep: true } }, { settings: { temperature: null } })
  assert.deepEqual(merged, { settings: { keep: true } })
})

test("mergeVariants:按 id 对齐,新增追加,内部深合并", () => {
  const base = [
    { id: "low", settings: { reasoningEffort: "low", extra: 1 } },
    { id: "high", settings: { reasoningEffort: "high" } },
  ]
  const override = [
    { id: "low", settings: { reasoningEffort: "fast" } },
    { id: "deep", body: { store: false } },
  ]
  const merged = mergeVariants(base, override)!
  assert.deepEqual(merged.map((v) => (v as { id: string }).id), ["low", "high", "deep"])
  assert.deepEqual((merged[0] as { settings: unknown }).settings, { reasoningEffort: "fast", extra: 1 })
})

test("mergeModelPartial:一侧无 variants 时不产生 variants 键", () => {
  const merged = mergeModelPartial({ limit: { context: 1 } }, { name: "n" })
  assert.equal("variants" in merged, false)
})

test("substituteEnv:整值替换、默认值、未设删键", () => {
  process.env.PMU_TEST_A = "hello"
  delete process.env.PMU_TEST_B
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(m)
  const out = substituteEnv(
    {
      headers: { "X-A": "{env:PMU_TEST_A}", "X-B": "{env:PMU_TEST_B}", "X-C": "{env:PMU_TEST_B:-fallback}" },
      plain: "not-a-ref",
      list: ["{env:PMU_TEST_A}", "{env:PMU_TEST_B}"],
    },
    warn,
  ) as { headers: Record<string, string>; plain: string; list: string[] }
  assert.deepEqual(out.headers, { "X-A": "hello", "X-C": "fallback" })
  assert.equal(out.plain, "not-a-ref")
  assert.deepEqual(out.list, ["hello"])
  assert.equal(warnings.length, 2) // headers X-B + 数组元素
  assert.ok(warnings.every((w) => w.includes("PMU_TEST_B")))
})
