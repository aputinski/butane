const [input, output] = require('minimist')(process.argv.slice(2))._;

const {
  convert
} = require('./rules');

convert(input, output);
