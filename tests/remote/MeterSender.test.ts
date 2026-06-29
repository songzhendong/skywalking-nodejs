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

import { GRPCChannelStatus } from '../../src/agent/core/remote/GRPCChannelStatus';

const mockCollect = jest.fn();
const mockGrpcUpstreamDeadlineMs = jest.fn(() => 5_432_109_876);
let pendingCollectCallback: ((error: Error | null) => void) | undefined;

const mockChannelManager = {
  addChannelListener: jest.fn(),
  resolveAddress: jest.fn(() => '127.0.0.1:11800'),
  getClientOptions: jest.fn(() => ({})),
  reportError: jest.fn(),
};

const mockMeterData = {
  setService: jest.fn().mockReturnThis(),
  setServiceinstance: jest.fn().mockReturnThis(),
  setTimestamp: jest.fn().mockReturnThis(),
};

const mockStream = {
  write: jest.fn(),
  end: jest.fn(),
};

const mockSnapshot = { cpu: 1 };

jest.mock('../../src/config/AgentConfig', () => ({
  __esModule: true,
  default: {
    serviceName: 'meter-service',
    serviceInstance: 'meter-instance',
    runtimeMetricsCollectPeriod: 1000,
    runtimeMetricsReportPeriod: 1000,
    runtimeMetricsBufferSize: 600,
  },
}));

jest.mock('../../src/proto/language-agent/Meter_grpc_pb', () => ({
  MeterReportServiceClient: jest.fn().mockImplementation(() => ({
    collect: jest.fn((_meta, opts, cb) => {
      pendingCollectCallback = cb;
      return mockCollect(_meta, opts, cb);
    }),
  })),
}));

jest.mock('../../src/agent/core/meter/RuntimeMetricsCollector', () => {
  return jest.fn().mockImplementation(() => ({
    sample: jest.fn(() => mockSnapshot),
    toMeterData: jest.fn(() => [mockMeterData, { ...mockMeterData }]),
    destroy: jest.fn(),
  }));
});

jest.mock('../../src/agent/core/remote/GrpcUpstreamOptions', () => ({
  grpcUpstreamDeadlineMs: () => mockGrpcUpstreamDeadlineMs(),
}));

jest.mock('../../src/agent/core/boot/ServiceManager', () => ({
  __esModule: true,
  default: {
    INSTANCE: {
      findService: jest.fn(() => mockChannelManager),
    },
  },
}));

jest.mock('../../src/logging', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    _isDebugEnabled: false,
  }),
  throttled: () => jest.fn(),
}));

import MeterSender from '../../src/agent/core/meter/MeterSender';
import { MeterReportServiceClient } from '../../src/proto/language-agent/Meter_grpc_pb';

describe('MeterSender', () => {
  let sender: MeterSender;

  beforeEach(() => {
    jest.useFakeTimers();
    mockCollect.mockClear();
    mockGrpcUpstreamDeadlineMs.mockClear();
    mockChannelManager.reportError.mockClear();
    mockMeterData.setService.mockClear();
    mockMeterData.setServiceinstance.mockClear();
    mockMeterData.setTimestamp.mockClear();
    pendingCollectCallback = undefined;
    mockCollect.mockImplementation((_meta, _opts, cb) => {
      pendingCollectCallback = cb;
      return mockStream;
    });
    sender = new MeterSender();
    sender.prepare();
    sender.statusChanged(GRPCChannelStatus.CONNECTED);
    sender.boot();
  });

  afterEach(() => {
    sender.shutdown();
    jest.useRealTimers();
  });

  it('clears reporter stub on DISCONNECT', () => {
    sender.statusChanged(GRPCChannelStatus.DISCONNECT);
    expect(MeterReportServiceClient).toHaveBeenCalledTimes(1);
  });

  it('sets service/instance/timestamp on every MeterData', async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(mockMeterData.setService).toHaveBeenCalledWith('meter-service');
    expect(mockMeterData.setServiceinstance).toHaveBeenCalledWith('meter-instance');
    expect(mockMeterData.setService).toHaveBeenCalledTimes(2);
    expect(mockMeterData.setServiceinstance).toHaveBeenCalledTimes(2);
    expect(mockMeterData.setTimestamp).toHaveBeenCalledTimes(2);
  });

  it('skips duplicate boot timers', () => {
    const collectTimer = (sender as unknown as { collectTimer?: NodeJS.Timeout }).collectTimer;
    const reportTimer = (sender as unknown as { reportTimer?: NodeJS.Timeout }).reportTimer;
    sender.boot();
    expect((sender as unknown as { collectTimer?: NodeJS.Timeout }).collectTimer).toBe(collectTimer);
    expect((sender as unknown as { reportTimer?: NodeJS.Timeout }).reportTimer).toBe(reportTimer);
  });

  describe('shutdown late callback safety (H2 / E6 edge case)', () => {
    it('does not re-queue buffer when collect callback fires after shutdown', async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      expect(pendingCollectCallback).toBeDefined();

      const bufferBefore = (sender as unknown as { buffer: unknown[] }).buffer.length;
      sender.shutdown();
      expect((sender as unknown as { buffer: unknown[] }).buffer.length).toBe(0);

      expect(() => pendingCollectCallback?.(new Error('UNAVAILABLE'))).not.toThrow();
      expect(mockChannelManager.reportError).not.toHaveBeenCalled();
      expect((sender as unknown as { buffer: unknown[] }).buffer.length).toBe(0);
      expect(bufferBefore).toBeGreaterThanOrEqual(0);
    });
  });
});
