'use strict'

import {existsSync, readFileSync, writeFileSync} from 'fs'
import {dirname} from 'path'
import yaml from 'js-yaml'
import {parse, registerFunction} from './rules'
import {isString} from 'lodash'

export {
  registerFunction
}

/**
 * Convert a YAML string to JSON string and transform all Butane
 * specific items
 *
 * @param {string} input - yaml string
 * @returns {string}
 */
export function convert (input) {
  if (!isString(input)) {
    throw new Error(`"input" must be a string`)
  }
  return JSON.stringify(parse(yaml.safeLoad(input)), null, 2)
}

/**
 * Convert a YAML file to JSON and transform all Butane
 * specific items
 *
 * @param {string} input - path of the input.yaml file
 * @param {string} [output] - path of output.json file
 * @returns {object}
 */
export function convertFile (input, output) {
  if (!existsSync(input)) {
    throw new Error(`Input "${input}" not found`)
  }
  const rules = readFileSync(input).toString()
  const rulesJSON = yaml.safeLoad(rules)
  parse(rulesJSON)
  if (!output) {
    return rulesJSON
  } else {
    if (!existsSync(dirname(output))) {
      throw new Error(`Output directory "${output}" not found`)
    }
    writeFileSync(output, JSON.stringify(rulesJSON, null, 2))
    return rulesJSON
  }
}
