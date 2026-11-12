/**
 * Two projects: backend suites run in Node against a throwaway SQLite file;
 * client suites run in jsdom against the real files served from public/.
 */
module.exports = {
  projects: [
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/tests/api/**/*.test.js',
        '<rootDir>/tests/pages/**/*.test.js'
      ]
    },
    {
      displayName: 'client',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/client/**/*.test.js']
    }
  ],
  // sqlite3 handles can linger briefly after a suite closes its database.
  forceExit: true
};
