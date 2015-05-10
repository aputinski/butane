'use strict'

import {
  default as _,
  isArray,
  forEach,
  map,
  includes
} from 'lodash'
import esprima from 'esprima'
import escodegen from 'escodegen'

export {
  getOptions,
  replaceRefs,
  replaceFunctions,
  coerceVal,
  replaceChildSyntax,
  replaceFirebaseIdentifiers,
  parse
}

const SPECIAL_KEYS = ['.functions', '.refs', '.parent']
const SNAPSHOT_IDENTIFIERS = {
  next: 'newData',
  prev: 'data',
  root: 'root'
}
const IGNORE_IDENTIFIERS = ['auth']

/**
 * Check if a node contains a CallExpression identifier
 *
 * @param {object} node
 * @param {string} name
 * @returns {boolean}
 */
function hasCallExpressionIdentifier (rootNode, name) {
  let found = false
  function walk (node) {
    if (node.type === 'CallExpression' && node.callee.property.name === name) {
      found = true
    } else {
      forEach(node, function (child) {
        if (Object.isObject(child)) {
          walk(...arguments)
        }
      })
    }
  }
  walk(rootNode)
  return found
}

/**
 * Get the root object from from a MemberExpresion
 *
 * @param {object} node
 * @returns {object}
 */
function getMemberExpressionRootName (memberNode) {
  let name = null
  function walk (node) {
    if (node.type === 'Identifier') {
      name = node.name
    } else {
      forEach(node, (child, key) => {
        if (Object.isObject(child) && !isArray(child) && key !== 'property') {
          walk(child)
        }
      })
    }
  }
  walk(memberNode)
  return name
}

/**
 * Return a escodegen string from an esprima syntax object
 * and remove the trailing ";"
 *
 * @param {object} syntax
 * @returns {string}
 */
function cleanSyntax (syntax) {
  return escodegen.generate(syntax).replace(/;$/, '')
}

/**
 * Expand a .refs map of strings to objects
 *
 * @param {object} refs
 */
function expandRefs (refs) {
  forEach(refs, (ref, key) => {
    if (typeof ref === 'string') {
      ref = refs[key] = { value: ref }
    }
    ref.depth = typeof ref.depth === 'number' ? ++ref.depth : 0
  })
}

/**
 * Expand a .functions map of strings to objects
 *
 * @param {object} functions
 */
function expandFunctions (functions) {
  forEach(functions, (fn, fnName) => {
    let syntax
    try {
      syntax = esprima.parse(fnName).body[0]
    } catch(e) {
      throw new Error(`Invalid .function declaration: ${fnName}`)
    }
    if (syntax.type !== 'ExpressionStatement' || syntax.expression.type !== 'CallExpression') {
      throw new Error(`Invalid .function declaration: ${fnName}`)
    }
    syntax.expression.arguments.forEach(arg => {
      if (arg.type !== 'Identifier') {
        throw new Error(`Invalid .function declaration: ${fnName}`)
      }
    })
    if (typeof fn === 'string') {
      fn = functions[fnName] = {
        body: fn,
        name: syntax.expression.callee.name,
        args: syntax.expression.arguments.map(arg => arg.name)
      }
    }
  })
}

/**
 * Get the options for a ruleset.
 * They are recursively merged down.
 *
 * @param {object} rules - will be mutated to remove SPECIAL_KEYS
 * @param {object} [options] - options from the parent ruleset
 * @returns {object}
 */
function getOptions (rules, options={}) {
  // Merge defaults, the previous options,
  // and the current options
  const prev = _.pick(options, SPECIAL_KEYS)
  const next = _.pick(rules, SPECIAL_KEYS)
  options = _.merge({}, {
    '.functions': {},
    '.refs': {}
  }, prev, next)
  const {
    '.functions': functions,
    '.refs': refs,
    '.parent': parent
  } = options
  // Remove the options from the rule set
  forEach(SPECIAL_KEYS, key => delete rules[key])
  // See if there is a parent ruleset
  if (parent) {
    // Check to see if any parent was a $wildcard
    forEach(parent, (value, key) => {
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
function replaceRefs (value, options) {
  const {'.refs': refs} = options
  forEach(refs, (ref, name) => {
    name = _.escapeRegExp(name)
    const pattern = new RegExp(`\\^${name}(?:\\((next|prev)\\))?`, 'g')
    value = value.replace(pattern, (match, keyword) => {
      const snapshot = keyword || ref.value
      const parents = _.repeat('.parent()', ref.depth)
      return match.replace(match, `${snapshot}${parents}`)
    })
  })
  return value
}

/**
 * Replace function () calls inside a rule expression
 *
 * @param {string} value
 * @param {object} options
 * @returns {object}
 */
function replaceFunctions (value, options) {
  const {'.functions': fns} = options
  // Get a list of available fn names
  const fnNames = map(fns, fn => fn.name)
  // Parse the rule expression
  const valueSyntax = esprima.parse(value)
  /**
   * Walk the .function body and replace argument
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
    if (node.type === 'Identifier' && _.includes(fn.args, node.name)) {
      // Get the argument
      const arg = args[fn.args.indexOf(node.name)]
      // Replace the identifier with the supplied argument node
      parentNode[key] = arg
    } else {
      // Keep walking
      forEach(node, function (child, childKey) {
        // Only objects that arent "property"
        if (Object.isObject(child)) {
          if (childKey === 'property' && node.computed === false) return
          walkFn(...[...arguments].concat(fn, [args]))
        }
      })
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
    // A CallExpression that matches one of the fnNames to be replaced
    if (node.type === 'CallExpression' && _.includes(fnNames, node.callee.name)) {
      // Get the fn definition by name
      const fn = _.find(fns, { name: node.callee.name })
      // Parse the fn definition
      const fnSyntax = esprima.parse(replaceFunctions(fn.body, options).code)
      // Walk the definition and replace the argument identifiers with the
      // provided arguments
      walkFn(fnSyntax.body[0], key, parentNode, fn, node.arguments)
      // Replace the CallExpression with a node that represents the fn.body
      parentNode[key] = fnSyntax.body[0].expression
    } else {
      // Keep walking
      // Can't use _.pick/_.omit because we need to keep references
      // to nodes inside valueSyntax
      forEach(node, function (child) {
        if (Object.isObject(child) && !isArray(child)) {
          walkValue(...arguments)
        }
      })
    }
  }
  walkValue(valueSyntax.body[0])
  return {
    syntax: valueSyntax,
    code: cleanSyntax(valueSyntax)
  }
}

/**
 * Append .val() if an expression is next to an operator
 * or in an array like child selector
 *
 * @param {string} value
 * @returns {object}
 */
function coerceVal (value) {
  const syntax = esprima.parse(value)
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
      const newNode = _.clone(node)
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
      forEach(node, function (child, childKey) {
        if (Object.isObject(child)) {
          if (node.type === 'CallExpression' && childKey === 'callee') {
            return
          }
          walk(...arguments)
        }
      })
    }
  }
  walk(syntax.body[0])
  return {
    syntax,
    code: cleanSyntax(syntax)
  }
}

/**
 * Replace dot/bracket syntax with the necessary
 * snapshot.child() calls
 *
 * @param {string} value
 * @returns {object}
 */
function replaceChildSyntax (value) {
  // Parse the rule expression
  const syntax = esprima.parse(value)
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
      return replaceChildSyntax(escodegen.generate(node)).syntax.body[0].expression
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
      let newNode = _.clone(parentNode)
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
          if (argument.type === 'MemberExpression' || node.type === 'CallExpression') {
            return filterMemeberExpression(argument)
          }
          return argument
        })
      }
      forEach(node, function (child) {
        if (Object.isObject(child) && !isArray(child)) {
          // Ignore some identifiers
          if (node.type === 'MemberExpression') {
            const name = getMemberExpressionRootName(node)
            if (includes(IGNORE_IDENTIFIERS, name)) return
          }
          walkValue(...[...arguments].concat(key))
        }
      })
    }
  }
  walkValue(syntax.body[0])
  return {
    syntax,
    code: cleanSyntax(syntax)
  }
}

/**
 * Replace items in the SNAPSHOT_IDENTIFIERS map
 *
 * @param {string} value
 * @returns {object}
 */
function replaceFirebaseIdentifiers (value) {
  const syntax = esprima.parse(value)
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
      forEach(node, function (child) {
        if (Object.isObject(child)) {
          walk(...[...arguments].concat(key))
        }
      })
    }
  }
  walk(syntax.body[0])
  return {
    syntax,
    code: cleanSyntax(syntax)
  }
}

/**
 * Parse a collection of rulesets and replace all Butane syntax
 *
 * @param {object} rules
 * @param {object} [options]
 * @returns {object}
 */
function parse (rules, options={}) {
  options = getOptions(rules, options)
  forEach(rules, (rule, key) => {
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
  })
  return rules
}
