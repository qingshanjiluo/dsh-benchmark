import { describe, expect, it } from 'vitest'
import { apply, Config, inject, name } from '../src/index.ts'

interface RegisteredTool {
  name: string
  execute(args: never, exec: never): Promise<unknown>
}

function mountPlugin(overrides: Partial<{ precision: number; reportHeading: string }> = {}): RegisteredTool[] {
  const config = { precision: 4, reportHeading: 'Benchmark Report', ...overrides }
  const registered: RegisteredTool[] = []
  const ctx = { tools: { register: (def: RegisteredTool) => registered.push(def) } }
  // The plugin only reads ctx.tools; a partial stub is the real registrant surface it touches.
  apply(ctx as never, config as never)
  return registered
}

const tool = (index: number, overrides?: Parameters<typeof mountPlugin>[0]) => mountPlugin(overrides)[index]!

describe('dsh-benchmark plugin contract', () => {
  it('exports the loader plugin face', () => {
    expect(name).toBe('dsh-benchmark')
    expect(inject).toEqual(['tools'])
    expect(typeof apply).toBe('function')
    expect(Config).toBeInstanceOf(Object)
  })

  it('registers the three documented tools', () => {
    const tools = mountPlugin()
    expect(tools.map(t => t.name)).toEqual(['bench_stats', 'bench_compare', 'bench_report'])
  })
})

describe('bench_stats', () => {
  it('summarizes a four-sample run deterministically', async () => {
    const result = await tool(0).execute({ name: 'parse', samples: [1, 2, 3, 4] } as never, {} as never)
    expect(result).toEqual({ n: 4, mean: 2.5, median: 2.5, p95: 4, min: 1, max: 4, stdev: 1.118 })
  })

  it('handles a single sample (edge)', async () => {
    const result = await tool(0).execute({ name: 'solo', samples: [5] } as never, {} as never)
    expect(result).toEqual({ n: 1, mean: 5, median: 5, p95: 5, min: 5, max: 5, stdev: 0 })
  })

  it('rejects an empty sample list (edge)', async () => {
    await expect(tool(0).execute({ name: 'empty', samples: [] } as never, {} as never))
      .rejects.toThrow(/at least one sample/)
  })

  it('rejects non-finite samples (edge, caught by defineTool arg validation)', async () => {
    await expect(tool(0).execute({ name: 'bad', samples: [1, Number.NaN] } as never, {} as never))
      .rejects.toThrow(/must be a finite JSON number/)
  })

  it('rounds to the configured precision', async () => {
    const wide = await tool(0).execute({ name: 'x', samples: [1, 1, 2] } as never, {} as never)
    expect(wide).toMatchObject({ mean: 1.3333 })
    const coarse = await tool(0, { precision: 2 }).execute({ name: 'x', samples: [1, 1, 2] } as never, {} as never)
    expect(coarse).toMatchObject({ mean: 1.33 })
  })
})

describe('bench_compare', () => {
  it('reports a regression of b against baseline a', async () => {
    const result = await tool(1).execute({ name: 'render', aSamples: [2, 4], bSamples: [3, 6] } as never, {} as never)
    expect(result).toEqual({ delta: 1.5, deltaPct: 50, winner: 'a' })
  })

  it('reports a win for b with a negative delta', async () => {
    const result = await tool(1).execute({ name: 'render', aSamples: [10, 20], bSamples: [1, 2, 3] } as never, {} as never)
    expect(result).toMatchObject({ delta: -13, winner: 'b' })
    expect(result).toMatchObject({ deltaPct: -86.6667 })
  })

  it('calls equal means a tie (edge)', async () => {
    const result = await tool(1).execute({ name: 'same', aSamples: [3, 3], bSamples: [2, 4] } as never, {} as never)
    expect(result).toEqual({ delta: 0, deltaPct: 0, winner: 'tie' })
  })

  it('rejects a zero baseline mean (edge)', async () => {
    await expect(tool(1).execute({ name: 'zero', aSamples: [0, 0], bSamples: [1, 2] } as never, {} as never))
      .rejects.toThrow(/baseline mean .* is 0/)
  })
})

describe('bench_report', () => {
  const runs = [
    { name: 'slow', samples: [3, 4] },
    { name: 'fast', samples: [1, 2] },
  ]

  it('renders a ranked Markdown table from structured runs', async () => {
    const result = await tool(2).execute({ runs } as never, {} as never) as { runCount: number; markdown: string }
    expect(result.runCount).toBe(2)
    expect(result.markdown).toContain('# Benchmark Report')
    expect(result.markdown).toContain('| Rank | Name | n | mean | median | p95 | min | max | stdev |')
    expect(result.markdown.indexOf('| 1 | fast |')).toBeLessThan(result.markdown.indexOf('| 2 | slow |'))
    expect(result.markdown).toContain('- Total runs: 2')
    expect(result.markdown).toContain('- Total samples: 4')
    expect(result.markdown).toContain('- Best mean: `fast` (1.5)')
  })

  it('accepts a JSON string of the same runs and renders identically', async () => {
    const structured = await tool(2).execute({ runs } as never, {} as never) as { markdown: string }
    const textual = await tool(2).execute({ runs: JSON.stringify(runs) } as never, {} as never) as { markdown: string; runCount: number }
    expect(textual.runCount).toBe(2)
    expect(textual.markdown).toBe(structured.markdown)
  })

  it('honors the configured report heading', async () => {
    const result = await tool(2, { reportHeading: 'My Report' }).execute({ runs } as never, {} as never) as { markdown: string }
    expect(result.markdown.startsWith('# My Report')).toBe(true)
  })

  it('reports an empty run list (edge)', async () => {
    const result = await tool(2).execute({ runs: [] } as never, {} as never) as { runCount: number; markdown: string }
    expect(result.runCount).toBe(0)
    expect(result.markdown).toContain('No benchmark runs supplied.')
  })

  it('rejects a malformed JSON string (edge)', async () => {
    await expect(tool(2).execute({ runs: 'not json' } as never, {} as never)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects a run without a samples array (edge)', async () => {
    await expect(tool(2).execute({ runs: [{ name: 'x' }] } as never, {} as never)).rejects.toThrow(/needs a samples array/)
  })
})
