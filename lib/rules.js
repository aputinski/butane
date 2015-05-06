const path = require('path');
const _ = require('lodash');

const SPECIAL_KEYS = ['.functions', '.refs', '.parent'];
const SNAPSHOT_PATTERN = /(next|prev|root)[\s\S]*?((?=[\s\n])|$)/g;
const FUNCTION_PATTERN = /([a-zA-Z]*?)\(([\s\S]*?)\)/g;

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
    '.refs': {},
  }, prev, next);
  const {
    '.functions': functions,
    '.refs': refs,
    '.parent': parent
  } = options;
  // Remove the options from the rule set
  _.forEach(SPECIAL_KEYS, key => delete rules[key]);
  // See if there is a parent ruleset
  if (parent) {
    // Check to see if any parent was a $wildcard
    _.forEach(parent, (value, key) => {
      if (/^\$/.test(key)) {
        refs[key] = 'prev';
      }
    });
  }
  // Refs
  _.forEach(refs, (ref, key) => {
    if (_.isString(ref)) {
      ref = refs[key] = { value: ref };
    }
    ref.depth = _.isNumber(ref.depth) ? ++ref.depth : 0;
  });
  // Functions
  _.forEach(functions, (fn, fnName) => {
    FUNCTION_PATTERN.lastIndex = 0;
    let [match, name, args] = FUNCTION_PATTERN.exec(fnName);
    if (_.isString(fn)) {
      fn = functions[fnName] = {
        body: fn,
        name,
        args: args ? args.split(',') : []
      };
    }
  });
  // Misc
  options['.parent'] = rules;
  return options;
}

/**
 * 
 */
function coerceVal(value) {
  return value.replace(SNAPSHOT_PATTERN, match => {
    if (/(\.val\()|(\)$)/.test(match)) {
      return match;
    }
    return `${match}.val()`;
  });
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
  _.forEach(refs, (ref, name) => {
    name = _.escapeRegExp(name);
    const pattern = new RegExp(`\\^${name}(?:\\((next|prev)\\))?`, 'g');
    value = value.replace(pattern, (match, keyword) => {
      const value = keyword || ref.value;
      const parents = _.repeat('.parent()', ref.depth);
      return match.replace(match, `${value}${parents}`);
    });
  });
  return value;
}

/**
 * Replace function() calls
 *
 * @param {string} value
 * @param {object} options
 * @returns {string}
 */
function replaceFunctions(value, options) {
  const {'.functions': functions} = options;
  _.forEach(functions, fn => {
    const pattern = new RegExp(`${fn.name}\\(([\\s\\S]*?)(?:\\)(?=\\s|$))`, 'g');
    value = value.replace(pattern, (match, localArgs) => {
      let {body,args} = fn;
      localArgs = localArgs.split(',');
      args.forEach((arg, index) => {
        body = body.replace(new RegExp(arg, 'g'), localArgs[index]);
      });
      return body;
    });
  });
  return value;
}

/**
 * Replace dot/bracket syntax with the necessary
 * snapshot.child() calls
 *
 * @param {string} value
 * @param {object} options
 * @returns {string}
 *
 * @example
 * .read: next.foo.bar[$baz]
 */
function replaceBrackets(value, options) {
  return value.replace(SNAPSHOT_PATTERN, (match, keyword) => {
    const replacements = [];
    // Temporarily replace function arguments
    match = match.replace(/\(([^()]+?)\)/g, (m, arg) => {
      const replacement = `__FIRE_RULES_${replacements.length}__`;
      replacements.push([replacement, arg]);
      return m.replace(arg, replacement);
    });
    // Split the match by "[" and "."
    const parents = match.split(/\.|\[/).slice(1).map(key => {
      // Function
      if (/\)$/.test(key)) {
        return `.${key}`;
      }
      // Bracket syntax
      if (/\]$/.test(key)) {
        key = key.replace(/\]$/, '');
      }
      // Dot synatx
      else {
        key = `'${key}'`;
      }
      return `.child(${key})`
    }).join('');
    // Final string
    let final =  `${keyword}${parents}`;
    // Undo replacements
    _.forEach(replacements, replacement => {
      final = final.replace(replacement[0], replacement[1]);
    });
    return final;
  });
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
 *
 */
function parse(rules, options={}) {
  options = getOptions(rules, options);
  _.forEach(rules, (rule, key) => {
    switch (typeof rule) {
    case 'object':
      parse(rule, options);
      break;
    case 'string':
      rule = coerceVal(rule);
      rule = replaceRefs(rule, options);
      rule = replaceFunctions(rule, options);
      rule = replaceBrackets(rule);
      rule = replaceKeywords(rule);
      rules[key] = rule;
      break;
    }
  });
  return rules;
}

module.exports = {
  getOptions,
  coerceVal,
  replaceRefs,
  replaceFunctions,
  replaceBrackets,
  replaceKeywords,
  parse
};
