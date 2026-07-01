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
let registeredServiceNames = new Set<string>();

export function resetRegisteredServiceNames(): void {
  registeredServiceNames = new Set<string>();
}

export function createServiceManagerMockModule() {
  return {
    __esModule: true,
    default: {
      INSTANCE: {
        boot: jest.fn(() => {
          registeredServiceNames.clear();
          registeredServiceNames.add('GRPCChannelManager');
          registeredServiceNames.add('TraceSegmentServiceClient');
          registeredServiceNames.add('ServiceManagementClient');
          const { default: agentConfig } = jest.requireActual('../../../src/config/AgentConfig') as {
            default: { runtimeMetricsReporterActive?: boolean };
          };
          if (agentConfig.runtimeMetricsReporterActive) {
            registeredServiceNames.add('MeterSender');
          }
        }),
        shutdown: jest.fn(() => {
          registeredServiceNames.clear();
        }),
        flush: jest.fn(),
        findService: jest.fn((serviceClass: { name: string }) =>
          registeredServiceNames.has(serviceClass.name) ? {} : undefined,
        ),
      },
    },
  };
}
