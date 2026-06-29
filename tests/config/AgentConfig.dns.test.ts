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

describe('AgentConfig DNS / channel settings (Java collector.* parity)', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    jest.resetModules();
  });

  it('reads SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY=true', () => {
    process.env.SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY = 'true';
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.isResolveDnsPeriodically).toBe(true);
  });

  it('defaults SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY to false', () => {
    delete process.env.SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY;
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.isResolveDnsPeriodically).toBe(false);
  });

  it('reads SW_AGENT_GRPC_CHANNEL_CHECK_INTERVAL', () => {
    process.env.SW_AGENT_GRPC_CHANNEL_CHECK_INTERVAL = '45';
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.grpcChannelCheckInterval).toBe(45);
  });

  it('defaults SW_AGENT_GRPC_CHANNEL_CHECK_INTERVAL to 30 seconds', () => {
    delete process.env.SW_AGENT_GRPC_CHANNEL_CHECK_INTERVAL;
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.grpcChannelCheckInterval).toBe(30);
  });

  it('reads SW_AGENT_FORCE_RECONNECTION_PERIOD', () => {
    process.env.SW_AGENT_FORCE_RECONNECTION_PERIOD = '3';
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.forceReconnectionPeriod).toBe(3);
  });

  it('defaults SW_AGENT_FORCE_RECONNECTION_PERIOD to 1', () => {
    delete process.env.SW_AGENT_FORCE_RECONNECTION_PERIOD;
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.forceReconnectionPeriod).toBe(1);
  });

  it('reads SW_AGENT_SECURE=true', () => {
    process.env.SW_AGENT_SECURE = 'true';
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.secure).toBe(true);
  });

  it('defaults SW_AGENT_SECURE to false', () => {
    delete process.env.SW_AGENT_SECURE;
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.secure).toBe(false);
  });
});
