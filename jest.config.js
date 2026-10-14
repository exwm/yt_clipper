/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', diagnostics: false }],
  },
  testMatch: ['**/*.test.ts'],
  // Only where the tests live: the repo root would also crawl .venv, dist, and sandbox.
  roots: ['<rootDir>/src', '<rootDir>/eslint-rules'],
  // Each worker loads the modules its tests import from scratch, so for many small test files a few
  // workers beat one per core (measured: 4 workers 3.3s, 8 3.5s, 19 4.1s), and bundle-prod runs
  // tsc, eslint, and parcel alongside.
  maxWorkers: 4,
  // Collected only with --coverage (just test-ts). Most of the userscript is UI code that the
  // Playwright tests cover, so these unit-test floors are low: raise them as coverage grows.
  collectCoverageFrom: [
    'src/markup/**/*.ts',
    '!src/markup/**/*.test.ts',
    '!src/markup/**/*.d.ts',
    '!src/markup/**/*.fixtures.ts',
    '!src/markup/__mocks__/**',
  ],
  coverageDirectory: 'coverage/markup',
  coverageReporters: ['text-summary', 'html', 'cobertura'],
  coverageThreshold: { global: { lines: 24, statements: 24, functions: 14, branches: 10 } },
  moduleNameMapper: {
    '^chart\\.js$': '<rootDir>/src/markup/__mocks__/chart.js.js',
    '^jszip$': '<rootDir>/src/markup/__mocks__/jszip.js',
    '^lit-html$': '<rootDir>/src/markup/__mocks__/lit-html.js',
    '^lit-html/directives/ref\\.js$': '<rootDir>/src/markup/__mocks__/lit-html-directives-ref.js',
    '^lit-html/directives/style-map\\.js$':
      '<rootDir>/src/markup/__mocks__/lit-html-directives-style-map.js',
  },
};
