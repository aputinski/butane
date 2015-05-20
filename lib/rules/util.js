import esprima from 'esprima'
import escodegen from 'escodegen'
import {isString, isNumber} from 'lodash'

const {isArray} = Array
const {isObject} = Object

/**
 * Return true if a node contains a CallExpression identifier
 *
 * @param {object} node
 * @param {string} name
 * @returns {boolean}
 */
export function hasCallExpressionIdentifier (rootNode, name) {
  let found = false
  function walk (node) {
    if (node.type === 'CallExpression' && node.callee.property.name === name) {
      found = true
    } else {
      Object.values(node).filter(isObject).forEach(walk)
    }
  }
  walk(rootNode)
  return found
}

/**
 * Return the root object name from a MemberExpresion
 *
 * @param {object} node
 * @returns {object}
 */
export function getMemberExpressionRootName (memberNode) {
  let name = null
  function walk (node) {
    if (node.type === 'Identifier') {
      name = node.name
    } else {
      for (let [key, child] of Object.entries(node)) {
        if (isObject(child) && !isArray(child) && key !== 'property') {
          walk(child)
        }
      }
    }
  }
  walk(memberNode)
  return name
}

/**
 * Collect the computed properties of a MemberExpression
 *
 * @param {object} node
 * @returns {arrauy}
 */
export function collectComputedProperties (node) {
  const props = []
  function walk (node) {
    if (node.type === 'MemberExpression' && node.computed) {
      props.push(node.property)
    }
    for (let child of Object.values(node)) {
      if (isObject(child)) {
        walk(child)
      }
    }
  }
  walk(node)
  return props
}

/**
 * Collect the computed properties of a MemberExpression
 *
 * @param {object} node
 * @returns {arrauy}
 */
export function collectArguments (node) {
  let args = []
  function walk (node) {
    if (node.type === 'CallExpression') {
      args = args.concat(node.arguments)
    }
    for (let child of Object.values(node)) {
      if (isObject(child)) {
        walk(child)
      }
    }
  }
  walk(node)
  return args
}

/**
 * Return an esprima syntax tree for a rule expression
 *
 * @param {string} expression
 * @returns {object}
 */
export function parseExpression (expression) {
  return esprima.parse(expression).body[0]
}

/**
 * Return an escodegen string from an esprima syntax object
 * and remove the trailing ";"
 *
 * @param {object} syntax
 * @returns {string}
 */
export function stringifySyntax (syntax) {
  return escodegen.generate(syntax).replace(/;$/, '')
}

/**
 * Expand a ".refs" map of strings to objects
 *
 * @param {object} refs
 */
export function expandRefs (refs) {
  for (let [key, ref] of Object.entries(refs)) {
    if (isString(ref)) {
      ref = refs[key] = {value: ref}
    }
    ref.depth = isNumber(ref.depth) ? ++ref.depth : 0
  }
}

/**
 * Expand a ".functions" map of strings to objects
 *
 * @param {object} functions
 */
export function expandFunctions (functions) {
  for (let [fnName, fn] of Object.entries(functions)) {
    let syntax
    try {
      syntax = parseExpression(fnName)
    } catch(e) {
      throw new Error(`Invalid .function declaration: ${fnName}`)
    }
    if (syntax.type !== 'ExpressionStatement' ||
        syntax.expression.type !== 'CallExpression') {
      throw new Error(`Invalid .function declaration: ${fnName}`)
    }
    syntax.expression.arguments.forEach(arg => {
      if (arg.type !== 'Identifier') {
        throw new Error(`Invalid .function declaration: ${fnName}`)
      }
    })
    if (isString(fn)) {
      fn = functions[fnName] = {
        body: fn,
        name: syntax.expression.callee.name,
        args: syntax.expression.arguments.map(arg => arg.name)
      }
    }
  }
}
