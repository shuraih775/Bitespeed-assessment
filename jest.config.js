export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  globalSetup: './tests/setup.ts',
  globalTeardown: './tests/teardown.ts'
}