const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const baseConfig = yaml.load(fs.readFileSync(path.join(__dirname, 'electron-builder.yml'), 'utf8'));

const env = process.env.BUILD_ENV || 'production';
const suffix = env === 'production' ? '' : `-${env}`;

module.exports = {
  ...baseConfig,
  artifactName: `\${productName}-\${version}${suffix}-\${os}-\${arch}.\${ext}`,
};
