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

const installOrder: string[] = [];

jest.mock('../../src/logging', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../src/config/AgentConfig', () => ({
  __esModule: true,
  default: {
    reDisablePlugins: /^$/,
  },
}));

jest.mock('fs', () => ({
  readdirSync: jest.fn(() => ['ZPlugin.ts', 'APlugin.ts', 'MPlugin.ts']),
}));

jest.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/'),
  resolve: (...parts: string[]) => parts.join('/'),
}));

jest.mock('semver', () => ({
  satisfies: jest.fn(() => true),
}));

import * as fs from 'fs';
import PluginInstaller from '../../src/core/PluginInstaller';

describe('PluginInstaller', () => {
  beforeEach(() => {
    installOrder.length = 0;
  });

  it('installs bundled plugins in deterministic filename order', () => {
    const installer = new PluginInstaller() as unknown as {
      require: (name: string) => { default: { module: string; versions: string; install: () => void } };
      installNormal: () => void;
    };

    installer.require = jest.fn((pluginFile: string) => {
      installOrder.push(pluginFile);
      return {
        default: {
          module: pluginFile,
          versions: '*',
          install: jest.fn(),
        },
      };
    });

    installer.installNormal();

    expect(fs.readdirSync).toHaveBeenCalled();
    expect(installOrder).toEqual([
      expect.stringContaining('APlugin.ts'),
      expect.stringContaining('MPlugin.ts'),
      expect.stringContaining('ZPlugin.ts'),
    ]);
  });
});
