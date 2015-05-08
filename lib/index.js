const fs = require('fs');
const yaml = require('js-yaml');

const {
  parse
} = require('./rules');

module.exports = {

  /**
   * Convert a YML files to JSON
   *
   * @param {string} input - path of the input.yml file
   * @param {string} output - path of output.json file
   */
  convert(input, output) {
    const rules = fs.readFileSync(input).toString();
    const rulesJSON = yaml.safeLoad(rules);
    parse(rulesJSON);
    fs.writeFileSync(output, JSON.stringify(rulesJSON, null, 2));
  }

};
