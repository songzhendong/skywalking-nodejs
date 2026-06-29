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

import { promises as dnsPromises } from 'dns';
import net from 'net';
import { createLogger } from '../../../logging';

const logger = createLogger(__filename);

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim?: boolean },
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: DnsLookupFn = (hostname, options) =>
  dnsPromises.lookup(hostname, options) as ReturnType<DnsLookupFn>;

/** Parse comma-separated backend entries (Java BACKEND_SERVICE split). */
export function parseStaticBackendAddresses(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter(isValidHostPortEntry);
}

function isValidHostPortEntry(entry: string): boolean {
  const parts = entry.split(':');
  if (parts.length < 2) {
    logger.debug('Service address [%s] format error. Expected host:port', entry);
    return false;
  }
  const portText = parts[parts.length - 1];
  const host = parts.slice(0, -1).join(':');
  const port = Number.parseInt(portText, 10);
  if (!host || Number.isNaN(port) || port <= 0) {
    logger.debug('Service address [%s] format error. Expected host:port', entry);
    return false;
  }
  return true;
}

export function splitHostPort(entry: string): { host: string; port: string } {
  const parts = entry.split(':');
  const port = parts[parts.length - 1];
  const host = parts.slice(0, -1).join(':');
  return { host, port };
}

export function isLiteralIp(host: string): boolean {
  return net.isIP(host) !== 0;
}

/**
 * Expand backend entries to ip:port list (Java InetAddress.getAllByName).
 * When resolveDns=false, returns static entries only.
 */
export async function expandBackendAddresses(
  entries: string[],
  resolveDns: boolean,
  lookup: DnsLookupFn = defaultLookup,
): Promise<string[]> {
  const resolved: string[] = [];

  for (const entry of entries) {
    if (!isValidHostPortEntry(entry)) {
      continue;
    }
    const { host, port } = splitHostPort(entry);

    if (!resolveDns || isLiteralIp(host)) {
      resolved.push(`${host}:${port}`);
      continue;
    }

    try {
      const records = await lookup(host, { all: true, verbatim: true });
      for (const record of records) {
        resolved.push(`${record.address}:${port}`);
      }
    } catch (error) {
      logger.error('Failed to resolve %s of backend service: %s', host, error);
    }
  }

  return Array.from(new Set(resolved));
}
