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

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import * as grpc from '@grpc/grpc-js';
import { getAgentPackagePath } from '../../src/agent/core/boot/AgentPackagePath';
import config from '../../src/config/AgentConfig';
import TLSChannelBuilder from '../../src/agent/core/remote/TLSChannelBuilder';
import StandardChannelBuilder from '../../src/agent/core/remote/StandardChannelBuilder';
import { clearTlsMaterialCacheForTest, preloadTlsMaterials } from '../../src/agent/core/remote/TlsMaterialCache';

describe('TLSChannelBuilder (Java TLSChannelBuilder parity)', () => {
  const original = {
    secure: config.secure,
    forceTls: config.forceTls,
    sslTrustedCaPath: config.sslTrustedCaPath,
    sslCertChainPath: config.sslCertChainPath,
    sslKeyPath: config.sslKeyPath,
    collectorAddress: config.collectorAddress,
  };
  const baseContext = {
    credentials: grpc.credentials.createInsecure(),
    options: {},
  };

  beforeEach(() => {
    clearTlsMaterialCacheForTest();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    config.secure = original.secure;
    config.forceTls = original.forceTls;
    config.sslTrustedCaPath = original.sslTrustedCaPath;
    config.sslCertChainPath = original.sslCertChainPath;
    config.sslKeyPath = original.sslKeyPath;
    config.collectorAddress = original.collectorAddress;
    clearTlsMaterialCacheForTest();
    jest.restoreAllMocks();
  });

  async function mockCaFileAndPreload(caPath: string, ca: Buffer, extra?: Record<string, Buffer>): Promise<void> {
    jest.spyOn(fs, 'statSync').mockImplementation((target) => {
      const filePath = String(target);
      if (filePath === caPath || extra?.[filePath]) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('ENOENT');
    });
    jest.spyOn(fsPromises, 'stat').mockImplementation(async (target) => {
      const filePath = String(target);
      if (filePath === caPath || extra?.[filePath]) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('ENOENT');
    });
    jest.spyOn(fsPromises, 'readFile').mockImplementation(async (target) => {
      const filePath = String(target);
      if (filePath === caPath) {
        return ca;
      }
      if (extra?.[filePath]) {
        return extra[filePath];
      }
      throw new Error(`unexpected read ${filePath}`);
    });
    await preloadTlsMaterials();
  }

  it('keeps insecure when SW_AGENT_SECURE is true but CA file is missing', () => {
    config.secure = true;
    config.forceTls = false;
    config.sslTrustedCaPath = '';
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl');

    const result = new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).not.toHaveBeenCalled();
    expect(result.credentials).toStrictEqual(baseContext.credentials);
  });

  it('keeps insecure when SW_AGENT_FORCE_TLS is true but CA file is missing', () => {
    config.secure = false;
    config.forceTls = true;
    config.sslTrustedCaPath = 'ca/ca.crt';
    jest.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl');
    const insecure = grpc.credentials.createInsecure();

    const result = new TLSChannelBuilder().build({ credentials: insecure, options: {} });

    expect(createSslSpy).not.toHaveBeenCalled();
    expect(result.credentials).toStrictEqual(insecure);
  });

  it('loads trusted CA from relative ca/ca.crt under agent package (Java default layout)', async () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = 'ca/ca.crt';
    const ca = Buffer.from('TEST-CA');
    const caPath = path.join(getAgentPackagePath(), 'ca/ca.crt');
    await mockCaFileAndPreload(caPath, ca);
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, null, null);
  });

  it('loads trusted CA from absolute SW_AGENT_SSL_TRUSTED_CA_PATH', async () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = '/ca/ca.crt';
    const ca = Buffer.from('TEST-CA');
    await mockCaFileAndPreload('/ca/ca.crt', ca);
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, null, null);
  });

  it('loads private key via PrivateKeyUtil.loadDecryptionKey for mTLS', async () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.sslCertChainPath = '/ca/client.crt';
    config.sslKeyPath = '/ca/client.pem';
    const ca = Buffer.from('CA');
    const cert = Buffer.from('CERT');
    const key = Buffer.from('KEY-PEM');
    await mockCaFileAndPreload('/ca/ca.crt', ca, {
      '/ca/client.crt': cert,
      '/ca/client.pem': key,
    });
    const sslCredentials = {} as grpc.ChannelCredentials;
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue(sslCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, key, cert);
  });

  it('enables mTLS when cert chain and key files exist under agent package', async () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = 'ca/client.crt';
    config.sslKeyPath = 'ca/client.key';
    const ca = Buffer.from('CA');
    const cert = Buffer.from('CERT');
    const key = Buffer.from('KEY');
    const root = getAgentPackagePath();
    await mockCaFileAndPreload(path.join(root, 'ca/ca.crt'), ca, {
      [path.join(root, 'ca/client.crt')]: cert,
      [path.join(root, 'ca/client.key')]: key,
    });
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, key, cert);
  });

  it('keeps insecure credentials when TLS is not enabled and default ca file is absent', () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = 'ca/ca.crt';
    jest.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl');
    const insecure = grpc.credentials.createInsecure();

    const result = new TLSChannelBuilder().build({ credentials: insecure, options: {} });

    expect(createSslSpy).not.toHaveBeenCalled();
    expect(result.credentials).toBe(insecure);
  });

  it('sets grpc.ssl_target_name_override when connecting to resolved IP under TLS', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.collectorAddress = 'oap:11800';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));
    jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    const result = new TLSChannelBuilder().build({
      ...baseContext,
      connectHost: '10.0.0.1',
    });

    expect(result.options['grpc.ssl_target_name_override']).toBe('oap');
  });

  it('does not set grpc.ssl_target_name_override when connect host is hostname', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.collectorAddress = 'oap:11800';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));
    jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    const result = new TLSChannelBuilder().build({
      ...baseContext,
      connectHost: 'oap',
    });

    expect(result.options['grpc.ssl_target_name_override']).toBeUndefined();
  });

  it('throws when CA file exists but preload returned no CA material (refuses insecure fallback)', () => {
    config.sslTrustedCaPath = '/ca/ca.crt';
    jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as fs.Stats);
    clearTlsMaterialCacheForTest();

    expect(() => new TLSChannelBuilder().build({ ...baseContext })).toThrow('TLS material unavailable');
  });

  it('StandardChannelBuilder preserves connectHost for TLS SNI override chain', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.collectorAddress = 'oap:11800';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));
    jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    const result = new TLSChannelBuilder().build(
      new StandardChannelBuilder().build({
        ...baseContext,
        connectHost: '10.0.0.1',
      }),
    );

    expect(result.options['grpc.ssl_target_name_override']).toBe('oap');
  });
});
