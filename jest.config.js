export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.spec.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: false,
  silent: true,
  reporters: ['<rootDir>/tests/jest-simple-reporter.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(chalk|@modelcontextprotocol|af-.*)/)'],
  extensionsToTreatAsEsm: ['.ts'],
  forceExit: true,
  detectOpenHandles: true,
  testTimeout: 10000,
};
