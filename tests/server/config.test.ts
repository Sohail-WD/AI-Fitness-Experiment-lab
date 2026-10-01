import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseDatabaseUrl } from '../../server/config';

describe('loadConfig', () => {
  it('uses development defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      port: 3001,
      host: '127.0.0.1',
      databasePath: './data/fitness-lab.db',
      groqApiKey: null,
      groqModel: 'openai/gpt-oss-120b',
      nodeEnv: 'development',
      staticDir: null,
      corsOrigin: null,
      aiRateLimitPerMinute: 10,
    });
  });

  it('reads provided values and treats empty strings as unset', () => {
    const config = loadConfig({ PORT: '4000', DATABASE_URL: ':memory:', GROQ_API_KEY: '' });
    expect(config.port).toBe(4000);
    expect(config.databasePath).toBe(':memory:');
    expect(config.groqApiKey).toBeNull();
  });

  it('rejects an invalid port with a clear message', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'file:/var/data/app.db' }).databasePath).toBe('/var/data/app.db');
  });
});

describe('parseDatabaseUrl', () => {
  it('accepts file: URLs and :memory:', () => {
    expect(parseDatabaseUrl('file:./data/x.db')).toBe('./data/x.db');
    expect(parseDatabaseUrl(':memory:')).toBe(':memory:');
  });

  it('rejects other formats', () => {
    expect(() => parseDatabaseUrl('postgres://localhost/db')).toThrow(ConfigError);
    expect(() => parseDatabaseUrl('file:')).toThrow(ConfigError);
  });
});
