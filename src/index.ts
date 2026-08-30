/**
 * dsh-benchmark — 性能基准测试
 *
 * 功能：
 * 1. 运行性能基准测试
 * 2. 对比历史数据
 * 3. 多次运行取平均
 * 4. 生成性能报告
 * 5. 性能回归检测
 *
 * 工具：bench_run, bench_compare, bench_history, bench_report
 * 命令：/bench
 * 配置：enabled, iterations, warmup, outputFile
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export const name = 'dsh-benchmark';
export const inject = ['settings', 'tools', 'commands'];

const configSchema = z.object({
  enabled: z.boolean().default(true),
  iterations: z.number().int().min(1).max(1000).default(100),
  warmup: z.number().int().min(0).max(100).default(10),
  outputFile: z.string().default('.bench-history.json'),
  regressionThreshold: z.number().default(10),
});

type Config = z.infer<typeof configSchema>;

interface BenchResult {
  name: string;
  ops: number;
  mean: number;
  min: number;
  max: number;
  p75: number;
  p99: number;
  samples: number;
  timestamp: string;
}

interface BenchHistory {
  name: string;
  results: BenchResult[];
}

function loadHistory(filePath: string): BenchHistory[] {
  if (!existsSync(filePath)) return [];
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return []; }
}

function saveHistory(filePath: string, data: BenchHistory[]) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function formatOps(ops: number): string {
  if (ops >= 1e9) return `${(ops / 1e9).toFixed(2)} Gops/s`;
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(2)} Mops/s`;
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(2)} Kops/s`;
  return `${ops.toFixed(2)} ops/s`;
}

function runMicroBench(fn: string, iterations: number, warmup: number): BenchResult {
  const samples: number[] = [];
  for (let i = 0; i < warmup; i++) { try { eval(fn); } catch {} }
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try { eval(fn); } catch {}
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    name: fn.substring(0, 50),
    ops: Math.round(1000 / mean),
    mean: Math.round(mean * 1000) / 1000,
    min: Math.round(samples[0] * 1000) / 1000,
    max: Math.round(samples[samples.length - 1] * 1000) / 1000,
    p75: Math.round(samples[Math.floor(samples.length * 0.75)] * 1000) / 1000,
    p99: Math.round(samples[Math.floor(samples.length * 0.99)] * 1000) / 1000,
    samples: samples.length,
    timestamp: new Date().toISOString(),
  };
}

function detectBenchmarkCommand(): string | null {
  const pkgPath = 'package.json';
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.scripts?.bench) return 'npm run bench';
    if (pkg.scripts?.benchmark) return 'npm run benchmark';
  }
  if (existsSync('Cargo.toml')) return 'cargo bench';
  if (existsSync('go.mod')) return 'go test -bench=. -benchmem';
  return null;
}

export function apply(ctx: any, config: Config) {
  if (!config.enabled) return;

  ctx.tools.register({
    name: 'bench_run',
    description: '运行性能基准测试',
    parameters: z.object({
      command: z.string().optional().describe('基准测试命令'),
      fn: z.string().optional().describe('内联基准函数'),
      iterations: z.number().optional(),
    }),
    async execute({ command, fn, iterations }: any) {
      const iters = iterations || config.iterations;

      if (fn) {
        const result = runMicroBench(fn, iters, config.warmup);
        const history = loadHistory(resolve(config.outputFile));
        const existing = history.find(h => h.name === result.name);
        if (existing) existing.results.push(result);
        else history.push({ name: result.name, results: [result] });
        saveHistory(resolve(config.outputFile), history);
        return result;
      }

      const cmd = command || detectBenchmarkCommand();
      if (!cmd) return { error: '未找到基准测试命令，请提供 command 参数' };

      try {
        const output = execSync(cmd, { encoding: 'utf-8', timeout: 300000, stdio: 'pipe' });
        return { command: cmd, output: output.substring(0, 2000), success: true };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  });

  ctx.tools.register({
    name: 'bench_compare',
    description: '对比两次基准测试结果',
    parameters: z.object({
      name: z.string().describe('基准名称'),
      limit: z.number().default(2),
    }),
    async execute({ name, limit }: any) {
      const history = loadHistory(resolve(config.outputFile));
      const bench = history.find(h => h.name === name || h.name.includes(name));
      if (!bench || bench.results.length < 2) return { error: `未找到足够的历史数据: ${name}` };

      const recent = bench.results.slice(-limit);
      const baseline = recent[0];
      const current = recent[recent.length - 1];
      const change = ((current.mean - baseline.mean) / baseline.mean * 100);

      return {
        name,
        baseline: { ops: formatOps(baseline.ops), mean: `${baseline.mean}ms`, timestamp: baseline.timestamp },
        current: { ops: formatOps(current.ops), mean: `${current.mean}ms`, timestamp: current.timestamp },
        change: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
        regression: change > config.regressionThreshold,
      };
    },
  });

  ctx.tools.register({
    name: 'bench_history',
    description: '查看基准测试历史',
    parameters: z.object({
      name: z.string().optional(),
      limit: z.number().default(10),
    }),
    async execute({ name, limit }: any) {
      const history = loadHistory(resolve(config.outputFile));
      if (name) {
        const bench = history.find(h => h.name.includes(name));
        if (!bench) return { error: `未找到: ${name}` };
        return { name: bench.name, results: bench.results.slice(-limit) };
      }
      return { benchmarks: history.map(h => ({ name: h.name, runs: h.results.length, latest: h.results[h.results.length - 1] })) };
    },
  });

  ctx.tools.register({
    name: 'bench_report',
    description: '生成性能报告',
    parameters: z.object({}),
    async execute() {
      const history = loadHistory(resolve(config.outputFile));
      if (history.length === 0) return { message: '暂无基准数据' };

      const report = history.map(h => {
        const latest = h.results[h.results.length - 1];
        return { name: h.name, ops: formatOps(latest.ops), mean: `${latest.mean}ms`, runs: h.results.length };
      });

      return { report, total: history.length };
    },
  });

  ctx.commands.register({
    name: 'bench',
    description: '性能基准测试',
    async execute(args: string) {
      const parts = args.trim().split(/\s+/);
      const action = parts[0] || 'run';
      const param = parts.slice(1).join(' ');

      if (action === 'run') {
        const result = await ctx.tools.execute('bench_run', { command: param || undefined });
        return { content: result.error || `基准测试完成: ${JSON.stringify(result)}` };
      }
      if (action === 'compare') {
        const result = await ctx.tools.execute('bench_compare', { name: param });
        return { content: JSON.stringify(result, null, 2) };
      }
      if (action === 'history') {
        const result = await ctx.tools.execute('bench_history', { name: param || undefined });
        return { content: JSON.stringify(result, null, 2) };
      }
      if (action === 'report') {
        const result = await ctx.tools.execute('bench_report', {});
        return { content: JSON.stringify(result, null, 2) };
      }
      return { content: '用法: /bench [run|compare|history|report] [参数]' };
    },
  });

  ctx.settings.register({
    title: 'benchmark',
    description: '性能基准测试',
    config: configSchema,
  });
}
