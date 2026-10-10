/** Two projects: fast unit tests (no I/O) and e2e tests that boot the real app against a real Postgres. */
const swc = ['@swc/jest', { jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' }, module: { type: 'commonjs' } }];
const common = {
  testEnvironment: 'node',
  transform: { '^.+\\.(t|m?j)s$': swc },
  // Nest 12 / Kysely 0.29 / jose ship ESM only; transpile them for Jest's CommonJS runtime.
  transformIgnorePatterns: ['/node_modules/(?!(@nestjs|kysely|jose|@amora)/)'],
};
module.exports = {
  testTimeout: 30000,
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    { ...common, displayName: 'e2e', testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'], globalSetup: '<rootDir>/test/global-setup.ts' },
  ],
};
