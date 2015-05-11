'use strict'

import includes from 'core-js/fn/array/includes'
import find from 'core-js/fn/array/find'
import repeat from 'core-js/fn/string/repeat'
import {clone, pick, merge, isString, slice} from 'lodash'

import {
  hasCallExpressionIdentifier,
  getMemberExpressionRootName,
  parseExpression,
  stringifySyntax,
  expandRefs,
  expandFunctions
} from './util'

const {isArray} = Array
const {isObject} = Object

const SPECIAL_KEYS = ['.functions', '.refs', '.parent']
const SNAPSHOT_IDENTIFIERS = {
  next: 'newData',
  prev: 'data',
  root: 'root'
}
const IGNORE_IDENTIFIERS = ['auth']

const REGISTERED_FUNCTIONS = {
  /**
   * Return an expression that requires snapshot
   * to equal one of the provided keys
   *
   * @param {array} keys
   * @param {string} [snapshot] - the snapshot to check equality against
   */
  oneOf: function (keys, snapshot='next') {
    if (!isArray(keys)) {
      keys = slice(arguments)
      snapshot = 'next'
    }
    if (!isArray(keys)) {
      throw new Error('oneOf() requires at least one argument')
    }
    return keys.map(key => {
      // Wrap string values in quotes
      if (isString(key)) key = `'${key}'`
      return `${snapshot} === ${key}`
    }).join('||')
  }
}

/**
 *
 */
export function registerFunction (name, fn) {
  REGISTERED_FUNCTIONS[name] = fn
}

/**
 * Get the options for a ruleset — they are recursively merged down.
 *
 * @param {object} rules - will be mutated to remove SPECIAL_KEYS
 * @param {object} [options] - options from the parent ruleset
 * @returns {object}
 */
export function getOptions (rules, options={}) {
  // Merge defaults, the previous options,
  // and the current options
  const prev = pick(options, SPECIAL_KEYS)
  const next = pick(rules, SPECIAL_KEYS)
  options = merge({}, {
    '.functions': {},
    '.refs': {}
  }, prev, next)
  const {
    '.functions': functions,
    '.refs': refs,
    '.parent': parent
  } = options
  // Remove the options from the rule set
  SPECIAL_KEYS.forEach(key => delete rules[key])
  // See if there is a parent ruleset
  if (parent) {
    // Check to see if any parent was a $wildcard
    Object.keys(parent).forEach((key) => {
      if (/^\$/.test(key)) {
        refs[key] = 'prev'
      }
    })
  }
  // Refs
  expandRefs(refs)
  // Functions
  expandFunctions(functions)
  // Misc
  options['.parent'] = rules
  return options
}

/**
 * Replace "^REF_NAME" with the necessary snapshot method
 * chains to reach the specified child
 *
 * "REF_NAME" will be replaced with the value of "REF_NAME"
 * in the first matched ".refs" object plus the required
 * numbet of .parent() calls
 *
 * Alternatley, "^REF_NAME(next|prev)" syntax can be used and
 * will override the value of .refs[REF_NAME]
 *
 * @param {string} value
 * @param {object} options
 * @returns {string}
 */
export function replaceRefs (value, options) {
  const {'.refs': refs} = options
  for (let [name, ref] of Object.entries(refs)) {
    name = RegExp.escape(name)
    const pattern = new RegExp(`\\^${name}(?:\\((next|prev)\\))?`, 'g')
    value = value.replace(pattern, (match, keyword) => {
      const snapshot = keyword || ref.value
      const parents = repeat('.parent()', ref.depth)
      return match.replace(match, `${snapshot}${parents}`)
    })
  }
  return value
}

/**
 * Replace function () calls inside a rule expression
 *
 * @param {string} value
 * @param {object} options
 * @returns {object}
 */
export function replaceFunctions (value, options) {
  const {'.functions': fns} = options
  // Get a list of available fn names
  const fnNames = Object.values(fns).map(fn => fn.name)
  // Parse the rule expression
  const valueSyntax = parseExpression(value)
  /**
   * Walk the function body and replace argument
   * identifiers with the specified value
   *
   * @param {object} node
   * @param {string} key
   * @param {object} parentNode
   * @param {object} fn - a function definition from the .functions map
   * @param {array} args - an array of esprima nodes that were passed
   *  passed into the function call
   */
  function walkFn (node, key, parentNode, fn, args) {
    // We found an identifier — see if it is one of the fn args
    if (node.type === 'Identifier' && includes(fn.args, node.name)) {
      // Get the argument
      const arg = args[fn.args.indexOf(node.name)]
      // If a matching argument was passed in, replace the identifier
      // with the supplied argument node
      if (arg) parentNode[key] = arg
    } else {
      // Keep walking
      for (let [childKey, child] of Object.entries(node)) {
        // Only objects that arent "property"
        if (Object.isObject(child)) {
          if (childKey === 'property' && node.computed === false) continue
          walkFn(child, childKey, node, fn, args)
        }
      }
    }
  }
  /**
   * Walk the rule expression for CallExpression nodes that are included
   * in "fnNames" and then replace them with the fn.body
   *
   * @param {object} node
   * @param {string} key
   * @param {object} parentNode
   */
  function walkValue (node, key, parentNode) {
    const isCallExpression = node.type === 'CallExpression'
    // A CallExpression that matches one of the fnNames to be replaced
    if (isCallExpression && includes(fnNames, node.callee.name)) {
      // Get the fn definition by name
      const fn = find(Object.values(fns), ({name}) => name === node.callee.name)
      // Replace functions uses as arguments
      node.arguments = node.arguments.map(arg => {
        return replaceFunctions(stringifySyntax(arg), options).syntax.expression
      })
      // Replace function calls inside the fn body
      const fnSyntax = parseExpression(replaceFunctions(fn.body, options).code)
      // Walk the definition and replace the argument identifiers with the
      // provided arguments
      walkFn(fnSyntax, key, parentNode, fn, node.arguments)
      // Replace the CallExpression with a node that represents the fn.body
      parentNode[key] = fnSyntax.expression
    } else if (isCallExpression && REGISTERED_FUNCTIONS[node.callee.name]) {
      const fn = REGISTERED_FUNCTIONS[node.callee.name]
      // Create a array of evaluated JS arguments
      const args = node.arguments.map(arg => {
        return eval(stringifySyntax(arg)) // eslint-disable-line no-eval
      })
      parentNode[key] = parseExpression(fn(...args)).expression
    } else {
      // Keep walking
      for (let [childKey, childNode] of Object.entries(node)) {
        if (isObject(childNode)) {
          walkValue(childNode, childKey, node)
        }
      }
    }
  }
  walkValue(valueSyntax)
  return {
    syntax: valueSyntax,
    code: stringifySyntax(valueSyntax)
  }
}

/**
 * Append .val() if an expression is next to an operator
 * or in an array like child selector
 *
 * @param {string} value
 * @returns {object}
 */
export function coerceVal (value) {
  const syntax = parseExpression(value)
  /**
   * Walk the rule expression and append .val() to MemberExpressions
   *
   * @param {object} node
   * @param {string} key
   * @param {object} parentNode
   * @param {string} parentKey
   */
  function walk (node) {
    if (node.type === 'MemberExpression' || node.type === 'Identifier') {
      const name = getMemberExpressionRootName(node)
      // Only append .val() to MemberExpression that start
      // with a Firebase identifier
      if (!SNAPSHOT_IDENTIFIERS.hasOwnProperty(name)) {
        return
      }
      // Don't append .val() if it already exists
      if (hasCallExpressionIdentifier(node, 'val')) {
        return
      }
      const newNode = clone(node)
      node.type = 'CallExpression'
      node.callee = {
        type: 'MemberExpression',
        computed: false,
        object: newNode,
        property: {
          type: 'Identifier',
          name: 'val'
        }
      }
      node.arguments = []
      delete node.object
      delete node.property
    } else {
      for (let [childKey, child] of Object.entries(node)) {
        if (isObject(child)) {
          if (node.type === 'CallExpression' && childKey === 'callee') continue
          walk(child, childKey, node)
        }
      }
    }
  }
  walk(syntax)
  return {
    syntax,
    code: stringifySyntax(syntax)
  }
}

/**
 * Replace dot/bracket syntax with the necessary
 * snapshot.child() calls
 *
 * @param {string} value
 * @returns {object}
 */
export function replaceChildSyntax (value) {
  // Parse the rule expression
  const syntax = parseExpression(value)
  /**
   * Check a MemberExpression to see if the root
   * is a Firebase identifier — if it is, return the node,
   * otherwise replaceChildSyntax()
   *
   * @param {object} node
   * @returns {object}
   */
  function filterMemeberExpression (node) {
    const name = getMemberExpressionRootName(node)
    if (includes(IGNORE_IDENTIFIERS, name)) {
      return node
    } else {
      return replaceChildSyntax(stringifySyntax(node)).syntax.expression
    }
  }
  /**
   * Walk the rule expression for Identifier nodes and convert parentNode
   * to a CallExpression: .child(Identifier)
   *
   * @param {object} node
   * @param {string} key
   * @param {object} parentNode
   * @param {string} parentKey
   */
  function walkValue (node, key, parentNode, parentKey) {
    const isCallIdentifier = node.type === 'Identifier' && parentKey === 'callee'
    const isParentComputed = parentNode && parentNode.computed === true
    // Only look at Identifiers that are properties
    // and not part of a CallExpression
    if (key === 'property' && (!isCallIdentifier || isParentComputed)) {
      const isIdentifier = parentNode.property.type === 'Identifier'
      parentNode.computed = false
      let newNode = clone(parentNode)
      let proposedArgument = newNode.property
      let argument
      // MemberExprssions
      if (proposedArgument.type === 'MemberExpression') {
        argument = filterMemeberExpression(proposedArgument)
      } else {
        // Identifier / Literal
        // If the node was computed, make sure the CallExpression
        // argument is an Identifier and not a Literal
        let argumentValue = isIdentifier
          ? proposedArgument.name
          : proposedArgument.value
        argument = isParentComputed && isIdentifier
          ? { type: 'Identifier', name: argumentValue }
          : { type: 'Literal', value: argumentValue }
      }
      // Convert the parent to a CallExpression
      parentNode.type = 'CallExpression'
      parentNode.callee = newNode
      parentNode.arguments = [argument]
      delete parentNode.object
      delete parentNode.property
      proposedArgument.name = 'child'
    } else {
      // Keep walking
      if (node.type === 'CallExpression') {
        node.arguments = node.arguments.map(argument => {
          if (argument.type === 'MemberExpression' ||
              node.type === 'CallExpression') {
            return filterMemeberExpression(argument)
          }
          return argument
        })
      }
      for (let [childKey, child] of Object.entries(node)) {
        if (isObject(child) && !isArray(child)) {
          // Ignore some identifiers
          if (node.type === 'MemberExpression') {
            const name = getMemberExpressionRootName(node)
            if (includes(IGNORE_IDENTIFIERS, name)) continue
          }
          walkValue(child, childKey, node, key)
        }
      }
    }
  }
  walkValue(syntax)
  return {
    syntax,
    code: stringifySyntax(syntax)
  }
}

/**
 * Replace items in the SNAPSHOT_IDENTIFIERS map
 *
 * @param {string} value
 * @returns {object}
 */
export function replaceFirebaseIdentifiers (value) {
  const syntax = parseExpression(value)
  /**
   * Walk the rule expression and rename Identifier nodes that are the root of
   * an expresston and match identifers in SNAPSHOT_IDENTIFIERS
   *
   * @param {object} node
   * @param {string} key
   * @param {object} parentNode
   * @param {string} parentKey
   */
  function walk (node, key) {
    if (node.type === 'Identifier' && key !== 'property') {
      const name = getMemberExpressionRootName(node)
      if (SNAPSHOT_IDENTIFIERS.hasOwnProperty(name)) {
        node.name = SNAPSHOT_IDENTIFIERS[name]
      }
    } else {
      for (let [childKey, child] of Object.entries(node)) {
        if (isObject(child)) {
          walk(child, childKey)
        }
      }
    }
  }
  walk(syntax)
  return {
    syntax,
    code: stringifySyntax(syntax)
  }
}

/**
 * Parse a collection of rulesets and replace all Butane syntax
 *
 * @param {object} rules
 * @param {object} [options]
 * @returns {object}
 */
export function parse (rules, options={}) {
  options = getOptions(rules, options)
  for (let [key, rule] of Object.entries(rules)) {
    switch (typeof rule) {
      case 'object':
        parse(rule, options)
        break
      case 'string':
        rule = replaceRefs(rule, options)
        rule = replaceFunctions(rule, options).code
        rule = coerceVal(rule).code
        rule = replaceChildSyntax(rule).code
        rule = replaceFirebaseIdentifiers(rule).code
        rules[key] = rule
        break
    }
  }
  return rules
}
