# dsh-benchmark

DeepSeek Harness 主机工具插件：对**调用方提供的**基准测试样本做确定性统计分析。
插件本身不运行任何命令、不读取时钟、不联网——所有工具都是输入样本的纯函数，
因此结果完全可复现，测试完全离线。

## 工具

| 工具 | 参数 | 返回 |
|------|------|------|
| `bench_stats` | `name`（标签）、`samples`（number 数组） | `{ n, mean, median, p95, min, max, stdev }`（p95 为升序最近秩，stdev 为总体标准差） |
| `bench_compare` | `name`、`aSamples`（基线）、`bSamples`（当前） | `{ delta, deltaPct, winner }`（delta = mean(b) − mean(a)；均值低者胜，样本视为耗时） |
| `bench_report` | `runs`：`[{name, samples}]` 数组或其 JSON 字符串 | `{ runCount, markdown }`（按 mean 升序排名、并列时按名称排序的 Markdown 报告） |

空样本列表、非有限数字、JSON 字符串解析失败、基线均值为 0 时工具直接报错，
不会产生 NaN/Infinity 输出。

## 配置

| 键 | 类型 | 默认值 | 描述 |
|-----|------|---------|------|
| `precision` | number | `4` | 统计量四舍五入的小数位（0–12 夹取） |
| `reportHeading` | string | `Benchmark Report` | Markdown 报告标题 |

## 安装

```bash
npx -y @deepseek-ai/dsh plugin --profile web add @qingshanjiluo/dsh-benchmark
```

本插件为纯分析插件，运行期无需任何外部工具、服务器或网络。

## 开发

```bash
npm install --no-audit --no-fund
npm run typecheck   # tsc --noEmit
npm run build       # tsc + tsdown -> lib/
npx vitest run      # 行为测试（纯内存，无网络 / 无子进程）
node scripts/load-smoke.mjs   # 校验构建产物可加载并注册 3 个工具
```

## License

MIT
