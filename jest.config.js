/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', diagnostics: false }],
  },
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^chart\\.js$': '<rootDir>/src/markup/__mocks__/chart.js.js',
    '^jszip$': '<rootDir>/src/markup/__mocks__/jszip.js',
    '^lit-html$': '<rootDir>/src/markup/__mocks__/lit-html.js',
    '^lit-html/directives/ref\\.js$': '<rootDir>/src/markup/__mocks__/lit-html-directives-ref.js',
    '^lit-html/directives/style-map\\.js$':
      '<rootDir>/src/markup/__mocks__/lit-html-directives-style-map.js',
  },
};
