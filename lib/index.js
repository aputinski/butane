'use strict'

import {existsSync, readFileSync, writeFileSync} from 'fs'
import {dirname} from 'path'
import yaml from 'js-yaml'
import {parse} from './rules'

/**
 * Convert a YML files to JSON
 *
 * @param {string} input - path of the input.yml file
 * @param {string} output - path of output.json file
 */
export function convert (input, output) {
  if (!existsSync(input)) {
    throw new Error(`Input "${input}" not found`)
  }
  if (!existsSync(dirname(output))) {
    throw new Error(`Output directory "${output}" not found`)
  }
  const rules = readFileSync(input).toString()
  const rulesJSON = yaml.safeLoad(rules)
  parse(rulesJSON)
  writeFileSync(output, JSON.stringify(rulesJSON, null, 2))
}
