#!/usr/bin/env node

var argv  = require('minimist')(process.argv.slice(2));
var fireRules = require('../dist/');

var input = argv._[0];
var output = argv._[1];

fireRules.convert(input, output);
