'use strict'

import {convert} from './'
import minimist from 'minimist'
const [input, output] = minimist(process.argv.slice(2))._

convert(input, output)
