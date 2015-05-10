const [input, output] = require('minimist')(process.argv.slice(2))._;
const fireRules = require('../');

fireRules.convert(input, output);
