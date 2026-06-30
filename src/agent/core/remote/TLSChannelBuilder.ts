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

import fs from 'fs';
import * as grpc from '@grpc/grpc-js';
import { resolveAgentPath } from '../boot/AgentPackagePath';
import { loadDecryptionKey } from '../util/PrivateKeyUtil';
import config from '../../../config/AgentConfig';
import { createLogger } from '../../../logging';
import ChannelBuilder, { ChannelBuildContext } from './ChannelBuilder';
import { deriveTlsServerNameForConnectHost } from './BackendAddressResolver';

const logger = createLogger(__filename);

function readTlsFile(configuredPath: string | undefined): Buffer | null {
  const filePath = resolveAgentPath(configuredPath);
  if (!filePath) {
    return null;
  }
  try {
    if (fs.statSync(filePath).isFile()) {
      return fs.readFileSync(filePath);
    }
  } catch {
    // missing or unreadable — treated as absent
  }
  return null;
}

function readPrivateKey(configuredPath: string | undefined): Buffer | null {
  const filePath = resolveAgentPath(configuredPath);
  if (!filePath) {
    return null;
  }
  try {
    if (fs.statSync(filePath).isFile()) {
      return loadDecryptionKey(filePath);
    }
  } catch (error) {
    logger.error('Failed to load private key from %s: %s', filePath, error);
  }
  return null;
}

function isCaFileAvailable(): boolean {
  const filePath = resolveAgentPath(config.sslTrustedCaPath);
  if (!filePath) {
    return false;
  }
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Java: FORCE_TLS || ca.crt exists; Node also accepts legacy SW_AGENT_SECURE. */
function shouldUseTls(): boolean {
  return Boolean(config.secure || config.forceTls || isCaFileAvailable());
}

/**
 * If only ca.crt exists, start TLS. If cert, key and ca files exist, enable mTLS.
 * Aligned with Java {@code TLSChannelBuilder}.
 */
export default class TLSChannelBuilder implements ChannelBuilder {
  build(context: ChannelBuildContext): ChannelBuildContext {
    if (!shouldUseTls()) {
      return context;
    }

    const rootCerts = readTlsFile(config.sslTrustedCaPath);
    let privateKey = readPrivateKey(config.sslKeyPath);
    let certChain = readTlsFile(config.sslCertChainPath);

    const certPathSet = Boolean(config.sslCertChainPath);
    const keyPathSet = Boolean(config.sslKeyPath);
    if (certPathSet && keyPathSet && (!privateKey || !certChain)) {
      logger.warn('Failed to enable mTLS caused by cert or key cannot be found.');
      privateKey = null;
      certChain = null;
    } else if (certPathSet !== keyPathSet) {
      privateKey = null;
      certChain = null;
    }

    const credentials = grpc.credentials.createSsl(rootCerts, privateKey, certChain);
    const options: grpc.ChannelOptions = { ...context.options };
    const tlsServerName = context.connectHost
      ? deriveTlsServerNameForConnectHost(context.connectHost, config.collectorAddress ?? '')
      : undefined;
    if (tlsServerName) {
      options['grpc.ssl_target_name_override'] = tlsServerName;
    }

    return {
      ...context,
      credentials,
      options,
    };
  }
}
