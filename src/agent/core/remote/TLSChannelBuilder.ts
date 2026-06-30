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
import config from '../../../config/AgentConfig';
import { createLogger } from '../../../logging';
import ChannelBuilder, { ChannelBuildContext } from './ChannelBuilder';
import { deriveTlsServerNameForConnectHost } from './BackendAddressResolver';
import { getTlsMaterials } from './TlsMaterialCache';

const logger = createLogger(__filename);

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

/**
 * TLS is enabled only when a trusted CA file is present.
 * {@code SW_AGENT_SECURE}/{@code SW_AGENT_FORCE_TLS} without CA are rejected to avoid
 * {@code createSsl(null,...)} against unintended system trust stores.
 */
function shouldUseTls(): boolean {
  if (isCaFileAvailable()) {
    return true;
  }
  if (config.forceTls) {
    logger.error('SW_AGENT_FORCE_TLS=true but trusted CA file is missing; TLS disabled.');
  } else if (config.secure) {
    logger.error('SW_AGENT_SECURE=true but trusted CA file is missing; TLS disabled.');
  }
  return false;
}

export function isTlsEnabled(): boolean {
  return shouldUseTls();
}

/**
 * If only ca.crt exists, start TLS. If cert, key and ca files exist, enable mTLS.
 * Aligned with Java {@code TLSChannelBuilder}. TLS files must be preloaded via
 * {@link preloadTlsMaterials} before channel build.
 */
export default class TLSChannelBuilder implements ChannelBuilder {
  build(context: ChannelBuildContext): ChannelBuildContext {
    if (!shouldUseTls()) {
      return context;
    }

    const materials = getTlsMaterials();
    if (!materials?.rootCerts) {
      logger.error('TLS required but trusted CA material is unavailable; refusing insecure channel.');
      throw new Error('TLS material unavailable');
    }

    const { rootCerts, privateKey, certChain } = materials;
    if (Boolean(config.sslCertChainPath) && Boolean(config.sslKeyPath) && (!privateKey || !certChain)) {
      logger.warn('Failed to enable mTLS caused by cert or key cannot be found.');
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

export { preloadTlsMaterials } from './TlsMaterialCache';
