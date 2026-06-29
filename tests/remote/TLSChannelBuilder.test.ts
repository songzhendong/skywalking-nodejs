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
import path from 'path';
import * as grpc from '@grpc/grpc-js';
import { getAgentPackagePath } from '../../src/agent/core/boot/AgentPackagePath';
import config from '../../src/config/AgentConfig';
import TLSChannelBuilder from '../../src/agent/core/remote/TLSChannelBuilder';

describe('TLSChannelBuilder (Java TLSChannelBuilder parity)', () => {
  const original = {
    secure: config.secure,
    forceTls: config.forceTls,
    sslTrustedCaPath: config.sslTrustedCaPath,
    sslCertChainPath: config.sslCertChainPath,
    sslKeyPath: config.sslKeyPath,
    sslTargetNameOverride: config.sslTargetNameOverride,
  };
  const baseContext = {
    credentials: grpc.credentials.createInsecure(),
    options: {},
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    config.secure = original.secure;
    config.forceTls = original.forceTls;
    config.sslTrustedCaPath = original.sslTrustedCaPath;
    config.sslCertChainPath = original.sslCertChainPath;
    config.sslKeyPath = original.sslKeyPath;
    config.sslTargetNameOverride = original.sslTargetNameOverride;
    jest.restoreAllMocks();
  });

  it('upgrades to createSsl when SW_AGENT_SECURE is true', () => {
    config.secure = true;
    config.forceTls = false;
    config.sslTrustedCaPath = '';
    const sslCredentials = {} as grpc.ChannelCredentials;
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue(sslCredentials);

    const result = new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(null, null, null);
    expect(result.credentials).toBe(sslCredentials);
  });

  it('loads trusted CA from relative ca/ca.crt under agent package (Java default layout)', () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = 'ca/ca.crt';
    const ca = Buffer.from('TEST-CA');
    const caPath = path.join(getAgentPackagePath(), 'ca/ca.crt');
    jest.spyOn(fs, 'statSync').mockImplementation((p) => {
      if (String(p) === caPath) {
        return { isFile: () => true } as fs.Stats;
      }
      throw new Error('ENOENT');
    });
    jest.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (String(p) === caPath) {
        return ca;
      }
      return Buffer.alloc(0);
    });
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, null, null);
  });

  it('loads trusted CA from absolute SW_AGENT_SSL_TRUSTED_CA_PATH', () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = '/ca/ca.crt';
    const ca = Buffer.from('TEST-CA');
    jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as fs.Stats);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(ca);
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, null, null);
  });

  it('enables mTLS when cert chain and key files exist under agent package', () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = 'ca/client.crt';
    config.sslKeyPath = 'ca/client.key';
    const ca = Buffer.from('CA');
    const cert = Buffer.from('CERT');
    const key = Buffer.from('KEY');
    const root = getAgentPackagePath();
    jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as fs.Stats);
    jest.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      const filePath = String(p);
      if (filePath === path.join(root, 'ca/ca.crt')) return ca;
      if (filePath === path.join(root, 'ca/client.crt')) return cert;
      if (filePath === path.join(root, 'ca/client.key')) return key;
      return Buffer.alloc(0);
    });
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, key, cert);
  });

  it('sets grpc.ssl_target_name_override when configured', () => {
    config.secure = true;
    config.sslTargetNameOverride = 'oap';
    jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    const result = new TLSChannelBuilder().build({ ...baseContext });

    expect(result.options['grpc.ssl_target_name_override']).toBe('oap');
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
});
