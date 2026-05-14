module.exports = {
  sourceDir: 'dist',
  artifactsDir: 'web-ext-artifacts',
  run: {
    firefox: 'firefox',
    startUrl: ['https://www.telenor.no'],
    browserConsole: true,
  },
  build: {
    overwriteDest: true,
  },
  ignoreFiles: ['*.map'],
};
