// apply.ts:把合并结果写进模型草稿。重点锁住 v2.0.14 实测契约——
// editor.update 的草稿只追踪「属性重赋值」,嵌套字段必须整体赋新对象,
// 因此这里断言:每次合并产生新引用、幂等可重放。

import { test } from "node:test"
import assert from "node:assert/strict"
import { applyModelPartial, stripExtendsKey, type ModelDraft } from "../src/apply.ts"

test("settings 深合并产生新对象且保留草稿原键", () => {
  const draft: ModelDraft = { settings: { apiKey: "sk", nested: { a: 1 } } }
  const before = draft.settings
  applyModelPartial(draft, { settings: { nested: { b: 2 }, baseURL: "u" } })
  assert.notEqual(draft.settings, before) // 新引用(copy-on-write)
  assert.deepEqual(draft.settings, { apiKey: "sk", nested: { a: 1, b: 2 }, baseURL: "u" })
  assert.deepEqual(before, { apiKey: "sk", nested: { a: 1 } }) // 原对象未被原地污染
})

test("stripExtendsKey 剥掉 extends 且整体重赋值", () => {
  const draft: ModelDraft = { settings: { apiKey: "sk", extends: "t1" } }
  const before = draft.settings
  stripExtendsKey(draft)
  assert.notEqual(draft.settings, before)
  assert.deepEqual(draft.settings, { apiKey: "sk" })
  assert.equal(draft.options, undefined) // options 槽缺失时不动
})

test("stripExtendsKey 同时处理 options 槽", () => {
  const draft = { options: { extends: "t", temperature: 0.5 } } as ModelDraft & { options: Record<string, unknown> }
  stripExtendsKey(draft)
  assert.deepEqual(draft.options, { temperature: 0.5 })
})

test("headers 按 key 大小写不敏感覆盖", () => {
  const draft: ModelDraft = { headers: { Authorization: "keep", "X-Old": "1" } }
  applyModelPartial(draft, { headers: { authorization: "new" } })
  assert.deepEqual(draft.headers, { "X-Old": "1", authorization: "new" })
})

test("limit 只覆写给出的子键", () => {
  const draft: ModelDraft = { limit: { context: 100, output: 50 } }
  applyModelPartial(draft, { limit: { context: 200 } })
  assert.deepEqual(draft.limit, { context: 200, output: 50 })
})

test("capabilities 逐子键合并", () => {
  const draft: ModelDraft = { capabilities: { tools: false, input: ["text"] } }
  applyModelPartial(draft, { capabilities: { tools: true } })
  assert.deepEqual(draft.capabilities, { tools: true, input: ["text"] })
})

test("variants 按 id 对齐合并,新 id 追加", () => {
  const draft: ModelDraft = {
    variants: [
      { id: "low", settings: { a: 1, keep: true } },
      { id: "high", settings: { a: 2 } },
    ],
  }
  applyModelPartial(draft, { variants: [{ id: "low", settings: { a: 9 } }, { id: "x", settings: { z: 1 } }] })
  assert.equal(draft.variants?.length, 3)
  assert.deepEqual(draft.variants?.[0], { id: "low", settings: { a: 9, keep: true } })
  assert.deepEqual(draft.variants?.[1], { id: "high", settings: { a: 2 } })
  assert.deepEqual(draft.variants?.[2], { id: "x", settings: { z: 1 } })
})

test("cost 整值替换;disabled→enabled 取反;name/package 标量替换", () => {
  const draft: ModelDraft = { enabled: true, cost: [{ input: 1 }], name: "old" }
  applyModelPartial(draft, { cost: [{ input: 5, output: 6 }], disabled: true, name: "new", package: "p" })
  assert.deepEqual(draft.cost, [{ input: 5, output: 6 }])
  assert.equal(draft.enabled, false)
  assert.equal(draft.name, "new")
  assert.equal(draft.package, "p")
})

test("同一 partial 重放两次结果一致(两层 transform 幂等)", () => {
  const draft: ModelDraft = { settings: { keep: 1 }, limit: { context: 1 } }
  const partial = { settings: { temperature: 0.5 }, limit: { context: 262144 }, variants: [{ id: "low" }] }
  applyModelPartial(draft, partial)
  const once = JSON.parse(JSON.stringify(draft))
  applyModelPartial(draft, partial)
  assert.deepEqual(JSON.parse(JSON.stringify(draft)), once)
})
