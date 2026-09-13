/**
 * Deterministic benchmark analysis for DeepSeek Harness. The plugin runs
 * nothing and times nothing: `bench_stats` summarizes one supplied sample
 * list, `bench_compare` contrasts two supplied sample lists, and
 * `bench_report` renders a Markdown report over a supplied set of runs
 * (either structured JSON or a JSON string). All three tools are pure
 * functions of their arguments, so results are fully reproducible and the
 * test suite never touches the network, filesystem, or a subprocess.
 * @module @qingshanjiluo/dsh-benchmark
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-benchmark'
export const inject = ['tools']

/** Deployment presentation settings for the analysis tools. */
export interface Config {
  /**
   * Decimal places used when rounding computed statistics and rendered
   * report numbers. Values outside 0..12 are clamped.
   */
  precision: number
  /** Heading rendered at the top of the Markdown report. */
  reportHeading: string
}

/** Schemastery configuration for the benchmark analyzer. */
export const Config: z<Config> = z.object({
  precision: z.number().default(4),
  reportHeading: z.string().default('Benchmark Report'),
})

/** One labeled measurement list, as supplied to {@link summarize}. */
interface BenchRun {
  name: string
  samples: number[]
}

/** Summary statistics for one sample list. */
interface Stats {
  n: number
  mean: number
  median: number
  p95: number
  min: number
  max: number
  stdev: number
}

/**
 * Clamp the configured precision into a safe digit budget.
 * @param precision - raw configured value.
 * @returns Integer digits in 0..12; falls back to 4 when not finite.
 */
function clampDigits(precision: number): number {
  if (!Number.isFinite(precision)) return 4
  return Math.min(Math.max(Math.trunc(precision), 0), 12)
}

/**
 * Round to the configured digit budget.
 * @param value - number to round.
 * @param digits - clamp()ed digit budget.
 * @returns Rounded number.
 */
function roundTo(value: number, digits: number): number {
  const factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
}

/**
 * Validate and sort a caller-supplied sample list ascending.
 * @param label - identifier to name in error messages.
 * @param samples - raw samples.
 * @returns A sorted copy of the samples.
 */
function sortedSamples(label: string, samples: readonly number[]): number[] {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`bench: "${label}" requires at least one sample`)
  }
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`bench: "${label}" sample ${i} is not a finite number`)
    }
  }
  return [...samples].sort((a, b) => a - b)
}

/**
 * Summarize one sample list with deterministic statistics: mean, median
 * (average of the two middles for even counts), nearest-rank p95 on the
 * ascending sort, min, max, and population standard deviation.
 * @param label - benchmark name for error messages.
 * @param samples - raw samples (typically durations in ms).
 * @param digits - rounding budget for computed fields.
 * @returns Summary statistics with `n` equal to the sample count.
 */
function summarize(label: string, samples: readonly number[], digits: number): Stats {
  const sorted = sortedSamples(label, samples)
  const n = sorted.length
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const mean = sum / n
  const mid = Math.floor(n / 2)
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const p95 = sorted[Math.max(0, Math.ceil(0.95 * n) - 1)]
  const variance = sorted.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / n
  return {
    n,
    mean: roundTo(mean, digits),
    median: roundTo(median, digits),
    p95: roundTo(p95, digits),
    min: sorted[0],
    max: sorted[n - 1],
    stdev: roundTo(Math.sqrt(variance), digits),
  }
}

/**
 * Coerce the report input — a structured array or a JSON string — into a
 * list of runs and validate every entry.
 * @param input - caller-supplied runs value.
 * @returns Validated runs in supplied order.
 */
function parseRuns(input: unknown): BenchRun[] {
  let value: unknown = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch (cause) {
      throw new Error(`bench_report: runs string is not valid JSON: ${(cause as Error).message}`)
    }
  }
  if (!Array.isArray(value)) {
    throw new Error('bench_report: runs must be an array of {name, samples} or a JSON string encoding one')
  }
  return value.map((entry: unknown, index: number) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`bench_report: run ${index} must be an object with name and samples`)
    }
    const record = entry as Record<string, unknown>
    if (typeof record.name !== 'string' || record.name.trim().length === 0) {
      throw new Error(`bench_report: run ${index} needs a non-empty string name`)
    }
    if (!Array.isArray(record.samples)) {
      throw new Error(`bench_report: run "${record.name}" needs a samples array`)
    }
    return { name: record.name, samples: record.samples as number[] }
  })
}

/**
 * Render the Markdown report: a rank-ordered statistics table plus totals.
 * Ranking is by mean ascending, ties broken by name for determinism.
 * @param runs - validated runs.
 * @param digits - rounding budget.
 * @param heading - configured report title.
 * @returns Markdown text and the run count.
 */
function buildReport(runs: readonly BenchRun[], digits: number, heading: string): { markdown: string; runCount: number } {
  const title = heading.replace(/\r?\n/g, ' ').trim() || 'Benchmark Report'
  const lines: string[] = [`# ${title}`, '']
  if (runs.length === 0) {
    lines.push('No benchmark runs supplied.')
    return { markdown: lines.join('\n'), runCount: 0 }
  }
  const rows = runs.map(run => ({ run, stats: summarize(run.name, run.samples, digits) }))
  rows.sort((a, b) =>
    a.stats.mean - b.stats.mean ||
    (a.run.name < b.run.name ? -1 : a.run.name > b.run.name ? 1 : 0),
  )
  lines.push('| Rank | Name | n | mean | median | p95 | min | max | stdev |')
  lines.push('|-----:|------|--:|-----:|-------:|----:|----:|----:|------:|')
  rows.forEach((row, index) => {
    const s = row.stats
    lines.push(
      `| ${index + 1} | ${row.run.name} | ${s.n} | ${s.mean} | ${s.median} | ${s.p95} | ${s.min} | ${s.max} | ${s.stdev} |`,
    )
  })
  const totalSamples = rows.reduce((acc, row) => acc + row.stats.n, 0)
  const best = rows[0]
  lines.push('')
  lines.push(`- Total runs: ${runs.length}`)
  lines.push(`- Total samples: ${totalSamples}`)
  lines.push(`- Best mean: \`${best.run.name}\` (${best.stats.mean})`)
  return { markdown: lines.join('\n'), runCount: runs.length }
}

/**
 * Register the benchmark analysis tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's explicit presentation settings.
 */
export function apply(ctx: Context, config: Config): void {
  const digits = clampDigits(config.precision)

  ctx.tools.register(defineTool({
    name: 'bench_stats',
    description:
      'Summarize one benchmark run from samples you supply (numbers, typically ' +
      'durations in ms). Returns mean, median, nearest-rank p95, min, max, ' +
      'population stdev, and the sample count n. Pure analysis: nothing is ' +
      'executed or timed, and the same samples always produce the same result.',
    parameters: {
      name: { type: 'string', required: true, description: 'Label for this benchmark run.' },
      samples: {
        type: 'array',
        required: true,
        description: 'Measured values, e.g. latencies in milliseconds. Must contain at least one finite number.',
        items: { type: 'number' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          n: { type: 'integer', required: true, description: 'Number of samples.' },
          mean: { type: 'number', required: true, description: 'Arithmetic mean, rounded to the configured precision.' },
          median: { type: 'number', required: true, description: 'Median (mean of the two middles for even n).' },
          p95: { type: 'number', required: true, description: 'Nearest-rank 95th percentile of the ascending sort.' },
          min: { type: 'number', required: true, description: 'Smallest sample.' },
          max: { type: 'number', required: true, description: 'Largest sample.' },
          stdev: { type: 'number', required: true, description: 'Population standard deviation.' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text:
          `${args.name}: n=${value.n} mean=${value.mean} median=${value.median} ` +
          `p95=${value.p95} min=${value.min} max=${value.max} stdev=${value.stdev}`,
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const { name: label, samples } = args
      const { n, mean, median, p95, min, max, stdev } = summarize(label, samples, digits)
      return Promise.resolve({ n, mean, median, p95, min, max, stdev })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bench_compare',
    description:
      'Compare two benchmark runs from supplied samples: a is the baseline, b is ' +
      'the current run. Returns delta (mean of b minus mean of a), deltaPct ' +
      '(delta as a percentage of the baseline mean), and winner — "a", "b", or ' +
      '"tie"; lower mean wins because samples are durations. Needs non-empty ' +
      'finite sample lists and a baseline mean greater than zero.',
    parameters: {
      name: { type: 'string', required: true, description: 'Label for what is being compared.' },
      aSamples: {
        type: 'array',
        required: true,
        description: 'Baseline samples (finite numbers).',
        items: { type: 'number' },
      },
      bSamples: {
        type: 'array',
        required: true,
        description: 'Current samples (finite numbers).',
        items: { type: 'number' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delta: { type: 'number', required: true, description: 'mean(b) - mean(a); positive means b is slower.' },
          deltaPct: { type: 'number', required: true, description: 'delta / mean(a) * 100.' },
          winner: { type: 'string', required: true, enum: ['a', 'b', 'tie'], description: 'Which side has the lower mean.' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text:
          `${args.name}: delta=${value.delta} (${value.deltaPct > 0 ? '+' : ''}${value.deltaPct}%), ` +
          `winner=${value.winner}` +
          (value.winner === 'a' ? ' (baseline a is faster)' : value.winner === 'b' ? ' (current b is faster)' : ' (means equal)'),
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const { name: label, aSamples, bSamples } = args
      const a = summarize(label + ' (a)', aSamples, digits)
      const b = summarize(label + ' (b)', bSamples, digits)
      if (a.mean === 0) {
        throw new Error(`bench_compare: baseline mean of "${label}" is 0; deltaPct is undefined`)
      }
      const delta = roundTo(b.mean - a.mean, digits)
      const deltaPct = roundTo(((b.mean - a.mean) / a.mean) * 100, digits)
      const winner: 'a' | 'b' | 'tie' = a.mean < b.mean ? 'a' : b.mean < a.mean ? 'b' : 'tie'
      return Promise.resolve({ delta, deltaPct, winner })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'bench_report',
    description:
      'Render a Markdown report over supplied benchmark runs. Pass runs either ' +
      'directly as a JSON array of {name, samples:[number]} objects or as a ' +
      'string containing that JSON. Each run is summarized (n, mean, median, ' +
      'p95, min, max, stdev), ranked by mean ascending, and printed as a table ' +
      'with totals. Pure text analysis: no commands are run and no clocks read.',
    parameters: {
      runs: {
        type: 'json',
        required: true,
        description: 'Array of {name, samples:[number]} runs, or a JSON string encoding that array.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runCount: { type: 'integer', required: true, description: 'Number of runs in the report.' },
          markdown: { type: 'string', required: true, description: 'Complete Markdown report text.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.markdown }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      return Promise.resolve(buildReport(parseRuns(args.runs), digits, config.reportHeading))
    },
  }))
}
