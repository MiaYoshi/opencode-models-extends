// 数据集集成:查找链层叠、锚点提取、模板链解析、env 替换、失效检测
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { buildDataset, type DatasetOptions } from "../src/dataset.ts"

function fixture(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), "pmu-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content, "utf8")
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5 }) }
}

function run(root: string, opts: DatasetOptions = {}) {
  const warnings: string[] = []
  const dataset = buildDataset(path.join(root, "project"), (m) => warnings.push(m), {
    globalConfigDir: path.join(root, "global"),
    ...opts,
  })
  return { dataset, warnings }
}

const QWEN_TEMPLATE = JSON.stringify({
  "qwen3.8-flash": {
    attachment: true,
    limit: { context: 262144, output: 64000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    temperature: true,
    tool_call: true,
    variants: {
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      xhigh: { reasoningEffort: "xhigh" },
    },
  },
})

test("基础:V1 锚点(options.extends)+ V1 模板", () => {
  const { root, cleanup } = fixture({
    "global/extends.models.jsonc": QWEN_TEMPLATE,
    "project/opencode.jsonc": JSON.stringify({
      provider: {
        aihub: {
          npm: "@ai-sdk/openai",
          models: { "gpt-6-sol": { options: { extends: "qwen3.8-flash" }, temperature: 0.5 } },
        },
      },
    }),
  })
  try {
    const { dataset, warnings } = run(root)
    assert.equal(dataset.anchors.length, 1)
    const anchor = dataset.anchors[0]!
    assert.equal(anchor.providerID, "aihub")
    assert.equal(anchor.modelID, "gpt-6-sol")
    assert.equal(anchor.stripExtends, true)
    assert.deepEqual(anchor.partial.limit, { context: 262144, output: 64000 })
    assert.deepEqual(anchor.partial.capabilities, { tools: true, input: ["text", "image"], output: ["text"] })
    assert.equal(anchor.partial.settings && (anchor.partial.settings as Record<string, unknown>).temperature, 0.5)
    assert.equal(anchor.partial.settings && "extends" in (anchor.partial.settings as object), false)
    assert.equal((anchor.partial.variants as unknown[]).length, 3)
    assert.equal(warnings.filter((w) => w.includes("attachment")).length, 1)
  } finally {
    cleanup()
  }
})

test("用户覆写 + null 删除模板键", () => {
  const { root, cleanup } = fixture({
    "global/extends.models.jsonc": JSON.stringify({
      base: { limit: { context: 1000, output: 100 }, settings: { temperature: 0.7, keep: true } },
    }),
    "project/opencode.jsonc": JSON.stringify({
      providers: {
        aihub: {
          package: "aisdk:@ai-sdk/openai",
          models: {
            "m1": { settings: { extends: "base", temperature: null, keep: false, limit: undefined } , limit: { context: 2000 } },
          },
        },
      },
    }),
  })
  try {
    const { dataset } = run(root)
    const anchor = dataset.anchors[0]!
    assert.deepEqual(anchor.partial.limit, { context: 2000, output: 100 })
    assert.deepEqual(anchor.partial.settings, { keep: false })
  } finally {
    cleanup()
  }
})

test("链式 extends:子条目覆写父条目", () => {
  const { root, cleanup } = fixture({
    "global/extends.models.jsonc": JSON.stringify({
      parent: { limit: { context: 100, output: 10 }, tool_call: false },
      child: { extends: "parent", limit: { output: 20 }, settings: { k: 1 } },
    }),
    "project/opencode.jsonc": JSON.stringify({
      providers: { p: { models: { m: { settings: { extends: "child" } } } } },
    }),
  })
  try {
    const { dataset, warnings } = run(root)
    const anchor = dataset.anchors[0]!
    assert.deepEqual(anchor.partial.limit, { context: 100, output: 20 })
    assert.deepEqual(anchor.partial.capabilities, { tools: false })
    assert.deepEqual(anchor.partial.settings, { k: 1 })
    assert.deepEqual(warnings, [])
  } finally {
    cleanup()
  }
})

test("断链:警告且只保留用户配置", () => {
  const { root, cleanup } = fixture({
    "project/opencode.jsonc": JSON.stringify({
      providers: { p: { models: { m: { name: "mine", settings: { extends: "nope" } } } } },
    }),
  })
  try {
    const { dataset, warnings } = run(root)
    assert.equal(dataset.anchors.length, 1)
    assert.deepEqual(dataset.anchors[0]!.partial, { name: "mine" })
    assert.equal(dataset.anchors[0]!.stripExtends, true)
    assert.equal(warnings.some((w) => w.includes("未找到")), true)
  } finally {
    cleanup()
  }
})

test("成环:警告并停止展开", () => {
  const { root, cleanup } = fixture({
    "global/extends.models.jsonc": JSON.stringify({
      x: { extends: "y", limit: { context: 1 } },
      y: { extends: "x", limit: { output: 2 } },
    }),
    "project/opencode.jsonc": JSON.stringify({
      providers: { p: { models: { m: { settings: { extends: "x" } } } } },
    }),
  })
  try {
    const { dataset, warnings } = run(root)
    assert.deepEqual(dataset.anchors[0]!.partial.limit, { context: 1, output: 2 })
    assert.equal(warnings.some((w) => w.includes("成环")), true)
  } finally {
    cleanup()
  }
})

test("就近覆写:项目模板与全局同 id 深合并,项目赢", () => {
  const { root, cleanup } = fixture({
    "global/extends.models.jsonc": JSON.stringify({ t: { limit: { context: 1000, output: 50 } } }),
    "project/extends.models.jsonc": JSON.stringify({ t: { limit: { output: 60 }, name: "from-project" } }),
    "project/opencode.jsonc": JSON.stringify({
      providers: { p: { models: { m: { settings: { extends: "t" } } } } },
    }),
  })
  try {
    const { dataset } = run(root)
    const anchor = dataset.anchors[0]!
    assert.deepEqual(anchor.partial.limit, { context: 1000, output: 60 })
    assert.equal(anchor.partial.name, "from-project")
  } finally {
    cleanup()
  }
})

test("模板 env 替换:已设替换、未设删键、默认值兜底", () => {
  process.env.PMU_TEST_SET = "hello"
  delete process.env.PMU_TEST_UNSET
  const { root, cleanup } = fixture({
    "global/extends.models.jsonc": JSON.stringify({
      t: {
        headers: { "X-A": "{env:PMU_TEST_SET}", "X-B": "{env:PMU_TEST_UNSET}", "X-C": "{env:PMU_TEST_UNSET2:-fallback}" },
      },
    }),
    "project/opencode.jsonc": JSON.stringify({
      providers: { p: { models: { m: { settings: { extends: "t" } } } } },
    }),
  })
  try {
    const { dataset, warnings } = run(root)
    assert.deepEqual(dataset.anchors[0]!.partial.headers, { "X-A": "hello", "X-C": "fallback" })
    assert.equal(warnings.some((w) => w.includes("PMU_TEST_UNSET")), true)
  } finally {
    cleanup()
  }
})

test("无 extends 的模型不进锚点;stale 检测文件变化", () => {
  const { root, cleanup } = fixture({
    "global/extends.models.jsonc": JSON.stringify({ t: { name: "tt" } }),
    "project/opencode.jsonc": JSON.stringify({
      providers: { p: { models: { plain: { name: "no-extends" } } } },
    }),
  })
  try {
    const { dataset } = run(root)
    assert.equal(dataset.anchors.length, 0)
    assert.equal(dataset.stale(), false)
    writeFileSync(path.join(root, "global", "extends.models.jsonc"), JSON.stringify({ t: { name: "changed" } }), "utf8")
    assert.equal(dataset.stale(), true)
  } finally {
    cleanup()
  }
})

test(".opencode 层优先于 direct 层(同目录)与 OpenCode 配置发现一致", () => {
  const { root, cleanup } = fixture({
    "project/opencode.jsonc": JSON.stringify({
      providers: { p: { models: { m: { settings: { extends: "from-direct" } } } } },
    }),
    "project/.opencode/opencode.jsonc": JSON.stringify({
      providers: { p: { models: { m: { settings: { extends: "from-dot" } } } } },
    }),
    "global/extends.models.jsonc": JSON.stringify({
      "from-direct": { name: "DIRECT" },
      "from-dot": { name: "DOT" },
    }),
  })
  try {
    const { dataset } = run(root)
    assert.equal(dataset.anchors[0]!.partial.name, "DOT")
  } finally {
    cleanup()
  }
})
