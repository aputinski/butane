const _ = require('lodash');

const {
  isString,
  isObject,
  isNumber,
  forEach
} = _;

const esprima = require('esprima');
const escodegen = require('escodegen');

const SPECIAL_KEYS = ['.functions', '.refs', '.parent'];
const SNAPSHOT_PATTERN = /(next|prev|root|\^)[\s\S]*?((?=[\s\n])|$)/g;
const ARGUMENT_PATTERN = /(\[)(?=[^\]])(.+?)(\])(?=(?:[^\]]|$))|(\()(?=[^\)])(.+?)(\))(?=(?:[^\)]|$))/g;

/**
 * Expand a .refs map of strings to objects
 *
 * @param {object} refs
 */
function expandRefs(refs) {
  forEach(refs, (ref, key) => {
    if (isString(ref)) {
      ref = refs[key] = { value: ref };
    }
    ref.depth = isNumber(ref.depth) ? ++ref.depth : 0;
  });
}

/**
 * Expand a .functions map of strings to objects
 *
 * @param {object} functions
 */
function expandFunctions(functions) {
  forEach(functions, (fn, fnName) => {
    let syntax;
    try { syntax = esprima.parse(fnName).body[0]; }
    catch(e) {
      throw new Error(`Invalid .function delcaration: ${fnName}`);
    }
    if (syntax.type !== 'ExpressionStatement' || syntax.expression.type !== 'CallExpression') {
      throw new Error(`Invalid .function delcaration: ${fnName}`);
    }
    syntax.expression.arguments.forEach(arg => {
      if (arg.type !== 'Identifier') {
        throw new Error(`Invalid .function delcaration: ${fnName}`);
      }
     });
    if (isString(fn)) {
      fn = functions[fnName] = {
        body: fn,
        name: syntax.expression.callee.name,
        args: syntax.expression.arguments.map(arg => arg.name)
      };
    }
  });
}

/**
 * Get the options for a ruleset.
 * They are recursively merged down.
 *
 * @param {object} rules - will be mutated to remove SPECIAL_KEYS
 * @param {object} [options] - options from the parent ruleset
 * @returns {object}
 */
function getOptions(rules, options={}) {
  // Merge defaults, the previous options,
  // and the current options
  const prev = _.pick(options, SPECIAL_KEYS);
  const next = _.pick(rules, SPECIAL_KEYS);
  options = _.merge({}, {
    '.functions': {},
    '.refs': {}
  }, prev, next);
  const {
    '.functions': functions,
    '.refs': refs,
    '.parent': parent
  } = options;
  // Remove the options from the rule set
  forEach(SPECIAL_KEYS, key => delete rules[key]);
  // See if there is a parent ruleset
  if (parent) {
    // Check to see if any parent was a $wildcard
    forEach(parent, (value, key) => {
      if (/^\$/.test(key)) {
        refs[key] = 'prev';
      }
    });
  }
  // Refs
  expandRefs(refs);
  // Functions
  expandFunctions(functions);
  // Misc
  options['.parent'] = rules;
  return options;
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
function replaceRefs(value, options) {
  const {'.refs': refs} = options;
  forEach(refs, (ref, name) => {
    name = _.escapeRegExp(name);
    const pattern = new RegExp(`\\^${name}(?:\\((next|prev)\\))?`, 'g');
    value = value.replace(pattern, (match, keyword) => {
      const snapshot = keyword || ref.value;
      const parents = _.repeat('.parent()', ref.depth);
      return match.replace(match, `${snapshot}${parents}`);
    });
  });
  return value;
}

/**
 * Replace function() calls inside a rule expression
 *
 * @param {string} value
 * @param {object} options
 * @returns {string}
 */
function replaceFunctions(value, options) {
  const {'.functions': fns} = options;
  // Get a list of available fn names
  const fnNames = _.map(fns, fn => fn.name);
  // Parse the rule expression
  const valueSyntax = esprima.parse(value);
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
  function walkFn(node, key, parentNode, fn, args) {
    // We found an identifier — see if it is one of the fn args
    if (node.type === 'Identifier' && _.includes(fn.args, node.name)) {
      // Get the argument
      const arg = args[fn.args.indexOf(node.name)];
      // Replace the identifier with the supplied argument node
      parentNode[key] = arg;
    }
    else {
      // Keep walking
      _(node).forEach(function(child, childKey) {
        // Only objects that arent "property"
        if (isObject(child)) {
          if (childKey === 'property' && node.computed === false) return;
          walkFn.apply(null, _(arguments).slice().push(fn).push(args).value());
        }
      }).value();
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
  function walkValue(node, key, parentNode) {
    // A CallExpression that matches on of the fnNames to be replaced
    if (node.type === 'CallExpression' && _.includes(fnNames, node.callee.name)) {
      // Get the fn definition by name
      const fn = _.find(fns, { name: node.callee.name });
      // Parse the fn definition
      const syntaxA = esprima.parse(fn.body);
      // Walk the definition and replace the argument identifiers with the
      // provided arguments
      walkFn(syntaxA.body[0], key, parentNode, fn, node.arguments);
      // Replace the CallExpression with a node that represents the fn.body
      parentNode[key] = syntaxA.body[0].expression;
    }
    // Keep walking
    else {
      // Can't use _.pick/_.omit because we need to keep references
      // to nodes inside valueSyntax
      _(node).forEach(function(child) {
        if (isObject(child)) {
          walkValue.apply(null, _.slice(arguments));
        }
      }).value();
    }
  }
  walkValue(valueSyntax.body[0]);
  return escodegen.generate(valueSyntax).replace(/;$/, '');
}



/**
 * Replace dot/bracket syntax with the necessary
 * snapshot.child() calls
 *
 * @param {string} value
 * @returns {string}
 */
function replaceChildSyntax(value) {
  // Parse the rule expression
  const syntax = esprima.parse(value);
  //console.log(JSON.stringify(syntax, null, 2));
  /**
   * Walk the rule expression for Identifier nodes and convert parentNode
   * to a CallExpression: .child(Identifier)
   *
   * @param {object} node
   * @param {string} key
   * @param {object} parentNode
   * @param {string} parentKet
   */
  function walkValue(node, key, parentNode, parentKey) {
    // Only look at Identifiers that are propertys
    // and not part of a CallExpression
    if (key === 'property' && ((node.type === 'Identifier' && parentKey !== 'callee') || (parentNode && parentNode.computed === true))) {
      const isComputed = parentNode.computed;
      const isIdentifier = parentNode.property.type === 'Identifier';
      parentNode.computed = false;
      const newNode  = _.clone(parentNode);
      // If the node was computed, make sure the CallExpression
      // argument is an Identifier and not a Literal
      let argumentValue = isIdentifier
        ? newNode.property.name
        : newNode.property.value;
      let argument = isComputed && isIdentifier
        ? { type: 'Identifier', name: argumentValue }
        : { type: 'Literal', value: argumentValue };
      // Convert the parent to a CallExpression
      parentNode.type = 'CallExpression';
      parentNode.callee = newNode;
      parentNode.arguments = [argument];
      delete parentNode.object;
      delete parentNode.property;
      newNode.property.name = 'child';
    }
    // Keep walking
    else {
      _(node).forEach(function(child) {
        if (isObject(child)) {
          walkValue.apply(null, _(arguments).slice().push(key).value());
        }
      }).value();
    }
  }
  walkValue(syntax.body[0]);
  return escodegen.generate(syntax).replace(/;$/, '');
}

/**
 * Replace (prev|next) followed by a "."
 *
 * @param {string} value
 * @returns {string}
 */
function replaceKeywords(value) {
  return value
    .replace(/next(?=\.)/g, 'newData')
    .replace(/prev(?=\.)/g, 'data');
}

/**
 * Append .val() if the expression is next to an operator
 * or in an array like child selector
 *
 * @param {string} value
 * @returns {string}
 */
function coerceVal(value) {
  return value.replace(SNAPSHOT_PATTERN, match => {
    if (/(\.val\(\))|(\))$/.test(match)) {
      return match;
    }
    return `${match}.val()`;
  });
}

/**
 * Parse a collection of rulesets and replace all Butane syntax
 *
 * @param {object} rules
 * @param {object} [options]
 * @returns {object}
 */
function parse(rules, options={}) {
  options = getOptions(rules, options);
  forEach(rules, (rule, key) => {
    switch (typeof rule) {
    case 'object':
      parse(rule, options);
      break;
    case 'string':
      rule = replaceRefs(rule, options);
      rule = replaceFunctions(rule, options);
      rule = coerceVal(rule);
      rule = replaceChildSyntax(rule);
      rule = replaceKeywords(rule);
      rules[key] = rule;
      break;
    }
  });
  return rules;
}

module.exports = {
  getOptions,
  replaceRefs,
  replaceFunctions,
  replaceChildSyntax,
  replaceKeywords,
  coerceVal,
  parse
};
