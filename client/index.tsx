import React from 'react';
import { createSettingsCard } from '@deepseek-ai/dsh-settings';

export default createSettingsCard({
  title: 'benchmark',
  description: '性能基准测试',
  config: [
    { key: 'enabled', type: 'boolean', label: '启用插件', default: true },
    { key: 'iterations', type: 'number', label: '迭代次数', default: 100 },
    { key: 'warmup', type: 'number', label: '预热次数', default: 10 },
    { key: 'regressionThreshold', type: 'number', label: '回归阈值(%)', default: 10 },
  ],
});
