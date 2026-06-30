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
const SERVER_PORT = 5010;
const COLLECTOR_B_HTTP_PORT = 12811;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const repoRoot = path.resolve(__dirname, '../../..');

function ensureE2eAgentImage(): void {
  const nodeVersion = process.env.SW_NODE_VERSION || '22';
  const tag = `skywalking-nodejs-e2e-agent:${nodeVersion}`;
  try {
    execSync(`docker image inspect ${tag}`, { stdio: 'pipe' });
    return;
  } catch {
    // cold start — build once
  }
  const npmRegistry = process.env.E2E_NPM_REGISTRY || 'https://registry.npmmirror.com';
  execSync(
    [
      'docker build -f tests/plugins/common/Dockerfile.agent',
      `--build-arg SW_NODE_VERSION=${nodeVersion}`,
      `--build-arg NPM_REGISTRY=${npmRegistry}`,
      `-t ${tag}`,
      '.',
    ].join(' '),
    { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, DOCKER_BUILDKIT: '1' } },
  );
}

function cleanupTestcontainers(): void {
  try {
    execSync('docker ps -aq --filter name=testcontainers | xargs -r docker rm -f', { stdio: 'pipe' });
  } catch {
    // best effort
  }
}

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
  const data = String((await axios.get(`http://localhost:${port}/receiveData`)).data);
  expect(data).toContain('serviceName: server');
  expect(data).toContain('operationName: GET:/ping');
  expect(data).toContain("http.status_code, value: '200'");
}

function stopComposeService(serviceName: string): void {
  execSync(`docker ps --filter "name=${serviceName}" --format "{{.ID}}" | head -1 | xargs -r docker stop`, {
    stdio: 'pipe',
  });
}

describe('remote-e2e static failover (Phase A)', () => {
  let compose: StartedDockerComposeEnvironment | undefined;

  beforeAll(async () => {
    cleanupTestcontainers();
    ensureE2eAgentImage();
    compose = await new DockerComposeEnvironment(rootDir, 'docker-compose.yml')
      .withWaitStrategy('collector-a', Wait.forHealthCheck())
      .withWaitStrategy('collector-b', Wait.forHealthCheck())
      .withWaitStrategy('server', Wait.forHealthCheck())
      .up();
  });

  afterAll(async () => {
    if (compose) {
      await compose.down();
    }
  });

  it('reports to secondary collector after primary stops', async () => {
    if (!compose) {
      throw new Error('Docker Compose environment failed to start');
    }
    await waitForExpect(async () => pingServer());
    await sleep(6000);

    await stopComposeService('collector-a');
    await sleep(8000);

    await waitForExpect(async () => pingServer());

    await waitForExpect(async () => assertCollectorReceivedPing(COLLECTOR_B_HTTP_PORT));
  });
});
