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

import { promises as fs } from 'fs';
import config from '../../../config/AgentConfig';
import { resolveAgentPath } from '../boot/AgentPackagePath';
import { loadDecryptionKeyAsync } from '../util/PrivateKeyUtil';
import { createLogger } from '../../../logging';

const logger = createLogger(__filename);

/** Maximum TLS PEM/DER file size (256 KiB) to prevent hostile reads from exhausting memory. */
export const MAX_TLS_FILE_BYTES = 256 * 1024;

export type TlsMaterialSnapshot = {
  rootCerts: Buffer | null;
  privateKey: Buffer | null;
  certChain: Buffer | null;
};

/** Last preload result consumed by {@code TLSChannelBuilder.build()} in the same rebuild. */
let cachedSnapshot: TlsMaterialSnapshot | null = null;

function resolveConfiguredPath(configuredPath: string | undefined): string | undefined {
  if (!configuredPath) {
    return undefined;
  }
  try {
    return resolveAgentPath(configuredPath);
  } catch (error) {
    logger.error('Invalid TLS path [%s]: %s', configuredPath, error);
    return undefined;
  }
}

function isFileSizeAllowed(filePath: string, size: number): boolean {
  if (size > MAX_TLS_FILE_BYTES) {
    logger.error('TLS file too large [%s]: %d bytes (max %d)', filePath, size, MAX_TLS_FILE_BYTES);
    return false;
  }
  return true;
}

async function readFileIfExists(configuredPath: string | undefined): Promise<Buffer | null> {
  const filePath = resolveConfiguredPath(configuredPath);
  if (!filePath) {
    return null;
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || !isFileSizeAllowed(filePath, stat.size)) {
      return null;
    }
    return fs.readFile(filePath);
  } catch {
    return null;
  }
}

async function readPrivateKeyIfExists(configuredPath: string | undefined): Promise<Buffer | null> {
  const filePath = resolveConfiguredPath(configuredPath);
  if (!filePath) {
    return null;
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || !isFileSizeAllowed(filePath, stat.size)) {
      return null;
    }
    return await loadDecryptionKeyAsync(filePath);
  } catch {
    return null;
  }
}

/**
 * Async-load TLS files before channel rebuild (Java {@code TLSChannelBuilder} reads on every build).
 * Reloads from disk on each call so rotated certificates are picked up after failover/reconnect.
 */
export async function preloadTlsMaterials(): Promise<TlsMaterialSnapshot> {
  const rootCerts = await readFileIfExists(config.sslTrustedCaPath);
  let privateKey = await readPrivateKeyIfExists(config.sslKeyPath);
  let certChain = await readFileIfExists(config.sslCertChainPath);

  const certPathSet = Boolean(config.sslCertChainPath);
  const keyPathSet = Boolean(config.sslKeyPath);
  if (certPathSet && keyPathSet && (!privateKey || !certChain)) {
    privateKey = null;
    certChain = null;
  } else if (certPathSet !== keyPathSet) {
    privateKey = null;
    certChain = null;
  }

  cachedSnapshot = { rootCerts, privateKey, certChain };
  return cachedSnapshot;
}

export function getTlsMaterials(): TlsMaterialSnapshot | null {
  return cachedSnapshot;
}

/** @internal test hook */
export function clearTlsMaterialCacheForTest(): void {
  cachedSnapshot = null;
}
