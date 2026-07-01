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

import * as grpc from '@grpc/grpc-js';
import StandardChannelBuilder from '../../src/agent/core/remote/StandardChannelBuilder';
import { GRPC_KEEPALIVE_OPTIONS } from '../../src/agent/core/remote/GrpcKeepaliveOptions';

describe('StandardChannelBuilder', () => {
  it('enables gRPC HTTP/2 keepalive options', () => {
    const builder = new StandardChannelBuilder();
    const context = builder.build({
      credentials: grpc.credentials.createInsecure(),
      options: {},
    });

    expect(context.options['grpc.keepalive_time_ms']).toBe(GRPC_KEEPALIVE_OPTIONS['grpc.keepalive_time_ms']);
    expect(context.options['grpc.keepalive_timeout_ms']).toBe(GRPC_KEEPALIVE_OPTIONS['grpc.keepalive_timeout_ms']);
    expect(context.options['grpc.keepalive_permit_without_calls']).toBe(1);
  });
});
