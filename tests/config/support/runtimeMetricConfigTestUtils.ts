/*!
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

/* eslint-env jest */

import { AgentConfig } from '../../../src/config/AgentConfig';
import { config } from '../../../src/index';

export function resetRuntimeMetricConfig(): void {
  const mutableConfig = config as AgentConfig;
  mutableConfig.runtimeMetricsReporterActive = true;
  mutableConfig.runtimeMetricsCollectPeriod = 1000;
  mutableConfig.runtimeMetricsReportPeriod = 1000;
  mutableConfig.runtimeMetricsBufferSize = 600;
  delete mutableConfig.nvmMetricsReporterActive;
  delete mutableConfig.nvmJvmReporterActive;
  delete mutableConfig.nvmMetricsCollectPeriod;
  delete mutableConfig.nvmJvmMetricsCollectPeriod;
  delete mutableConfig.nvmMetricsReportPeriod;
  delete mutableConfig.nvmJvmMetricsReportPeriod;
  delete mutableConfig.nvmMetricsBufferSize;
  delete mutableConfig.nvmJvmMetricsBufferSize;
}
