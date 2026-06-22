const base = require('./electron-builder.config.js');
module.exports = {
  ...base,
  directories: {
    ...base.directories,
    output: "/Users/sto/Documents/project/robot/sto-claw/release/20260622002.test",
  },
  artifactName: base.artifactName.replace('-${os}-${arch}.', '-20260622.002.test-${os}-${arch}.'),
};
