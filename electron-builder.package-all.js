const base = require('./electron-builder.config.js');
module.exports = {
  ...base,
  directories: {
    ...base.directories,
    output: "/Users/sto/Documents/copyProject/sto-claw/release/20260615003",
  },
  artifactName: base.artifactName.replace('-${os}-${arch}.', '-20260615.003-${os}-${arch}.'),
};
