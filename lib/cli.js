const [input, output] = require('minimist')(process.argv.slice(2))._;

const {
  convert
} = require('./index');

convert(input, output);
