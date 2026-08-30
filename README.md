# dsh-benchmark

DSH plugin for running performance benchmarks and tracking historical results.

## 功能特性

- **基准测试运行**: 支持内联代码微基准测试和项目级测试命令自动检测
- **历史数据对比**: 对比两次基准测试结果，检测性能回归
- **多次运行取平均**: 配置迭代次数和预热次数，获取稳定结果
- **性能报告生成**: 生成包含 ops/s、mean、p75、p99 等指标的报告
- **回归检测**: 自动检测性能变化是否超过配置的阈值

## 安装

```bash
# Via DSH CLI
dsh install dsh-benchmark

# Or manually
git clone https://github.com/qingshanjiluo/dsh-benchmark.git
cd dsh-benchmark
npm install
npm run build
```

## 工具

| 工具 | 描述 |
|------|------|
| `bench_run` | 运行性能基准测试 |
| `bench_compare` | 对比两次基准测试结果 |
| `bench_history` | 查看基准测试历史 |
| `bench_report` | 生成性能报告 |

## 命令

| 命令 | 描述 |
|------|------|
| `/bench run [command]` | 运行基准测试 |
| `/bench compare <name>` | 对比基准测试结果 |
| `/bench history [name]` | 查看基准测试历史 |
| `/bench report` | 生成性能报告 |

## 配置

| 键 | 类型 | 默认值 | 描述 |
|-----|------|---------|------|
| `enabled` | boolean | `true` | 启用/禁用插件 |
| `iterations` | number | `100` | 基准测试迭代次数 |
| `warmup` | number | `10` | 预热次数 |
| `outputFile` | string | `.bench-history.json` | 历史数据存储路径 |
| `regressionThreshold` | number | `10` | 性能回归检测阈值(%) |

## 使用

1. 使用 `/bench run` 运行基准测试
2. 使用 `/bench compare` 对比历史结果
3. 使用 `/bench history` 查看历史趋势
4. 使用 `/bench report` 生成完整报告
5. 插件自动检测项目中的测试命令（npm run bench、cargo bench、go test -bench）

## License

MIT
