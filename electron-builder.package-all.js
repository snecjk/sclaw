const base = require('./electron-builder.config.js');
module.exports = {
  ...base,
  directories: {
    ...base.directories,
    output: "/Users/sto/Documents/project/robot/sto-claw/release/20260528002",
  },
  artifactName: base.artifactName.replace('-${os}-${arch}.', '-20260528.002-${os}-${arch}.'),
};
