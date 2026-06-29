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

import * as path from 'path';
import { execSync } from 'child_process';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import axios from 'axios';
import waitForExpect from 'wait-for-expect';

const rootDir = path.resolve(__dirname);
const SERVER_PORT = 5020;
const COLLECTOR_A_HTTP_PORT = 12820;
const COLLECTOR_B_HTTP_PORT = 12821;
const WARMUP_WAIT_MS = 60000;
const WARMUP_POLL_MS = 2000;
const FAILOVER_WAIT_MS = 90000;
const FAILOVER_POLL_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';

async function pingServer(): Promise<void> {
  const response = await axios.get(`http://localhost:${SERVER_PORT}/ping`);
  expect(response.status).toBe(200);
}

async function flushServer(): Promise<void> {
  const response = await axios.get(`http://localhost:${SERVER_PORT}/flush`);
  expect(response.status).toBe(200);
}

async function assertCollectorReceivedPing(port: number): Promise<void> {
  const response = await axios.get(`http://localhost:${port}/receiveData`, { timeout: 10000 });
  const data = String(response.data);
  expect(data).toContain('serviceName: server');
  expect(data).toContain('operationName: GET:/ping');
  expect(data).toContain("http.status_code, value: '200'");
}

function serverContainerId(): string {
  return execSync('docker ps --filter "name=server-1" -q | head -1', { encoding: 'utf8' }).trim();
}

function hostIpInServer(host: string): string {
  const sid = serverContainerId();
  return execSync(`docker exec ${sid} getent hosts ${host} | awk '{print $1; exit}'`, { encoding: 'utf8' }).trim();
}

function assertOapPointsToCollector(name: 'collector-a' | 'collector-b'): void {
  const oapIp = hostIpInServer('oap.test');
  const collectorIp = hostIpInServer(name);
  expect(oapIp).toBeTruthy();
  expect(collectorIp).toBeTruthy();
  expect(oapIp).toBe(collectorIp);
}

function repointOapToCollectorB(): void {
  const sid = serverContainerId();
  execSync(
    `docker exec ${sid} bash -c 'BIP=$(getent hosts collector-b | awk "{print \$1; exit}") && grep -v oap.test /etc/hosts > /tmp/h && echo "$BIP oap.test" >> /tmp/h && cat /tmp/h > /etc/hosts'`,
    { stdio: 'pipe' },
  );
  assertOapPointsToCollector('collector-b');
}

function stopComposeService(nameSuffix: string): void {
  execSync(`docker ps --filter "name=${nameSuffix}" --format "{{.ID}}" | head -1 | xargs -r docker stop`, {
    stdio: 'pipe',
  });
}

async function waitForWarmupOnCollectorA(): Promise<void> {
  assertOapPointsToCollector('collector-a');
  await waitForExpect(
    async () => {
      await pingServer();
      await flushServer();
      await assertCollectorReceivedPing(COLLECTOR_A_HTTP_PORT);
    },
    WARMUP_WAIT_MS,
    WARMUP_POLL_MS,
  );
}

async function waitForFailoverOnCollectorB(): Promise<void> {
  await waitForExpect(
    async () => {
      await pingServer();
      await flushServer();
      await assertCollectorReceivedPing(COLLECTOR_B_HTTP_PORT);
    },
    FAILOVER_WAIT_MS,
    FAILOVER_POLL_MS,
  );
}

async function triggerFailoverTraffic(rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await pingServer();
    await flushServer();
    await sleep(1500);
  }
}

describe('remote-e2e dns re-resolve (Phase B)', () => {
  let compose: StartedDockerComposeEnvironment | undefined;

  beforeAll(async () => {
    compose = await new DockerComposeEnvironment(rootDir, 'docker-compose.yml')
      .withWaitStrategy('collector-a', Wait.forHealthCheck())
      .withWaitStrategy('collector-b', Wait.forHealthCheck())
      .withWaitStrategy('server', Wait.forHealthCheck())
      .up();
  }, 300000);

  afterAll(async () => {
    if (compose) {
      await compose.down();
    }
  });

  it('re-resolves hostname and reports to new backend after primary stops', async () => {
    if (!compose) {
      throw new Error('Docker Compose environment failed to start');
    }

    await waitForExpect(async () => pingServer(), 30000, 2000);
    await waitForWarmupOnCollectorA();

    repointOapToCollectorB();
    stopComposeService('collector-a-1');
    await sleep(3000);

    await waitForFailoverOnCollectorB();
  }, 180000);
});
