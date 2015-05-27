'use strict'

import {convertFile} from './'
import minimist from 'minimist'

const argv = minimist(process.argv.slice(2))
const [input, output] = argv._

const rules = convertFile(input, output)

// Print the rules if no output was specified
if (!output) {
  console.log(JSON.stringify(rules, null, 2))
}
