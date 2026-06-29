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

import * as grpc from '@grpc/grpc-js';
import { ClientOptions } from '@grpc/grpc-js';
import config from '../../../config/AgentConfig';
import { createLogger } from '../../../logging';
import AgentIDDecorator from './AgentIDDecorator';
import AuthenticationDecorator from './AuthenticationDecorator';
import { expandBackendAddresses, parseStaticBackendAddresses } from './BackendAddressResolver';
import GRPCChannel from './GRPCChannel';
import { GRPCChannelListener } from './GRPCChannelListener';
import { GRPCChannelStatus } from './GRPCChannelStatus';
import BootService from '../boot/BootService';
import StandardChannelBuilder from './StandardChannelBuilder';
import TLSChannelBuilder from './TLSChannelBuilder';

const logger = createLogger(__filename);

function isGrpcNetworkError(error: unknown): boolean {
  const code = (error as grpc.ServiceError | undefined)?.code;
  return (
    code === grpc.status.UNAVAILABLE ||
    code === grpc.status.PERMISSION_DENIED ||
    code === grpc.status.UNAUTHENTICATED ||
    code === grpc.status.RESOURCE_EXHAUSTED ||
    code === grpc.status.UNKNOWN
  );
}

/** Shared gRPC channel manager aligned with Java GRPCChannelManager (v2 DNS re-resolve). */
export default class GRPCChannelManager implements BootService {
  private managedChannel: GRPCChannel | null = null;
  private readonly listeners: GRPCChannelListener[] = [];
  private lastStatus: GRPCChannelStatus | null = null;
  private closed = false;
  private reconnect = true;
  private grpcServers: string[] = [];
  private selectedIdx = -1;
  private reconnectCount = 0;
  private currentTarget: string | null = null;
  private checkTimer?: NodeJS.Timeout;
  private checkInFlight = false;
  private watcherGeneration = 0;

  resolveAddress(): string {
    if (this.currentTarget) {
      return this.currentTarget;
    }
    const first = parseStaticBackendAddresses(config.collectorAddress ?? '')[0];
    if (!first) {
      throw new Error('collectorAddress is not configured');
    }
    return first;
  }

  getChannel(): grpc.Channel {
    if (!this.managedChannel) {
      throw new Error('gRPC channel is not available');
    }
    return this.managedChannel.getChannel();
  }

  getClientOptions(): ClientOptions {
    if (!this.managedChannel) {
      throw new Error('gRPC channel is not available');
    }
    return this.managedChannel.getClientOptions();
  }

  isConnected(): boolean {
    return this.managedChannel?.isConnected(true) ?? false;
  }

  addChannelListener(listener: GRPCChannelListener): void {
    this.listeners.push(listener);
    if (this.lastStatus !== null) {
      listener.statusChanged(this.lastStatus);
    }
  }

  priority(): number {
    return Number.MAX_SAFE_INTEGER;
  }

  reportError(error: unknown): void {
    if (!isGrpcNetworkError(error)) {
      logger.debug('gRPC report error (ignored): %s', error);
      return;
    }
    if (this.closed) {
      return;
    }
    logger.debug('gRPC network error, schedule reconnect: %s', error);
    this.reconnect = true;
    this.notify(GRPCChannelStatus.DISCONNECT);
  }

  prepare(): void {}

  boot(): void {
    this.closed = false;
    this.grpcServers = parseStaticBackendAddresses(config.collectorAddress ?? '');
    if (this.grpcServers.length === 0) {
      logger.error('Collector server addresses are not set.');
      logger.error('Agent will not uplink any data.');
      return;
    }
    this.reconnect = true;
    const intervalMs = (config.grpcChannelCheckInterval ?? 30) * 1000;
    this.checkTimer = setInterval(() => {
      void this.runCheck();
    }, intervalMs);
    this.checkTimer.unref();
    void this.runCheck();
  }

  onComplete(): void {}

  shutdown(): void {
    this.closed = true;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    this.watcherGeneration += 1;
    const managed = this.managedChannel;
    this.managedChannel = null;
    managed?.shutdownNow();
    this.notify(GRPCChannelStatus.DISCONNECT);
    this.listeners.length = 0;
    this.grpcServers = [];
    this.selectedIdx = -1;
    this.currentTarget = null;
    this.reconnect = true;
  }

  /** Java GRPCChannelManager.run() — exposed for unit tests. */
  async runCheck(): Promise<void> {
    if (this.closed || this.checkInFlight) {
      return;
    }
    this.checkInFlight = true;
    try {
      logger.debug('gRPC channel check running, reconnect: %s', this.reconnect);

      if (config.isResolveDnsPeriodically && this.reconnect) {
        const staticEntries = parseStaticBackendAddresses(config.collectorAddress ?? '');
        this.grpcServers = await expandBackendAddresses(staticEntries, true);
      } else if (this.grpcServers.length === 0) {
        this.grpcServers = parseStaticBackendAddresses(config.collectorAddress ?? '');
      }

      if (!this.reconnect) {
        return;
      }

      if (this.grpcServers.length === 0) {
        logger.debug('No collector backend available. Wait %s seconds to retry', config.grpcChannelCheckInterval ?? 30);
        return;
      }

      const index = Math.abs(Math.floor(Math.random() * this.grpcServers.length));
      if (index !== this.selectedIdx) {
        await this.switchToServer(this.grpcServers[index], index);
        return;
      }

      const forceReconnect = ++this.reconnectCount > (config.forceReconnectionPeriod ?? 1);
      if (this.managedChannel?.isConnected(forceReconnect)) {
        this.reconnectCount = 0;
        this.reconnect = false;
        this.notifyCurrentConnectivityState(true);
      }
    } catch (error) {
      logger.error('gRPC channel check failed: %s', error);
    } finally {
      this.checkInFlight = false;
    }
  }

  /** @internal test hook */
  getReconnectStateForTest(): boolean {
    return this.reconnect;
  }

  /** @internal test hook */
  getGrpcServersForTest(): string[] {
    return [...this.grpcServers];
  }

  /** @internal test hook */
  getSelectedIdxForTest(): number {
    return this.selectedIdx;
  }

  /** @internal test hook */
  getReconnectCountForTest(): number {
    return this.reconnectCount;
  }

  /** @internal test hook */
  getLastStatusForTest(): GRPCChannelStatus | null {
    return this.lastStatus;
  }

  /** @internal test hook */
  hasCheckTimerForTest(): boolean {
    return this.checkTimer !== undefined;
  }

  private async switchToServer(target: string, index: number): Promise<void> {
    const { host, port: portText } = splitTarget(target);
    const port = Number.parseInt(portText, 10);
    if (!host || Number.isNaN(port)) {
      throw new Error(`Invalid collector address: ${target}`);
    }

    this.watcherGeneration += 1;
    const previous = this.managedChannel;
    this.managedChannel = null;
    previous?.shutdownNow();

    this.managedChannel = GRPCChannel.newBuilder(host, port)
      .addManagedChannelBuilder(new StandardChannelBuilder())
      .addManagedChannelBuilder(new TLSChannelBuilder())
      .addChannelDecorator(new AgentIDDecorator())
      .addChannelDecorator(new AuthenticationDecorator())
      .build();

    this.selectedIdx = index;
    this.currentTarget = target;
    this.reconnectCount = 0;
    this.reconnect = false;
    this.watchConnectivityState();
    this.notifyCurrentConnectivityState(true);
  }

  private watchConnectivityState(): void {
    const managed = this.managedChannel;
    if (this.closed || !managed) {
      return;
    }
    const generation = this.watcherGeneration;
    const channel = managed.getChannel();
    const currentState = channel.getConnectivityState(true);
    channel.watchConnectivityState(currentState, Infinity, (error) => {
      if (this.closed || this.managedChannel !== managed || this.watcherGeneration !== generation) {
        return;
      }
      if (error) {
        logger.debug('Channel connectivity watch stopped: %s', error.message);
        return;
      }
      this.notifyCurrentConnectivityState(false);
      this.watchConnectivityState();
    });
  }

  private notifyCurrentConnectivityState(requestConnection: boolean): void {
    const managed = this.managedChannel;
    if (this.closed || !managed) {
      return;
    }
    const channel = managed.getChannel();
    const ready = channel.getConnectivityState(requestConnection) === grpc.connectivityState.READY;
    this.notify(ready ? GRPCChannelStatus.CONNECTED : GRPCChannelStatus.DISCONNECT);
  }

  private notify(status: GRPCChannelStatus): void {
    if (this.lastStatus === status) {
      return;
    }
    this.lastStatus = status;
    for (const listener of this.listeners) {
      try {
        listener.statusChanged(status);
      } catch (err) {
        logger.error('GRPCChannelListener failed: %s', err);
      }
    }
  }
}

function splitTarget(target: string): { host: string; port: string } {
  const parts = target.split(':');
  const port = parts[parts.length - 1];
  const host = parts.slice(0, -1).join(':');
  return { host, port };
}
