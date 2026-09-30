import type { AppConfig } from '../../server/config';

export const testConfig: AppConfig = {
  port: 0,
  host: '127.0.0.1',
  databasePath: ':memory:',
  groqApiKey: null,
  groqModel: 'test-model',
  nodeEnv: 'test',
};
