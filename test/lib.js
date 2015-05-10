const expect = require('chai').expect;
const path = require('path');
const fs = require('fs');

const local = path.resolve.bind(path, __dirname);

const {
  convert
} = require('../lib');

describe('lib', () => {
  describe('#convert()', () => {
    after(function () {
      const output = local('rules.json.ignore');
      if (fs.existsSync(output)) {
        fs.unlinkSync(output);
      }
    });
    it(`throws an error if the input doesn't exist`, () => {
      expect(function() {
        convert(local('foo/bar/baz.yml'));
      }).to.throw(/Input \"/);
    });
    it(`throws an error if the output directory doesn't exist`, () => {
      expect(function() {
        convert(local('rules.yaml'), local('foo/bar/rules.json.ignore'));
      }).to.throw(/Output directory \"/);
    });
    it(`outputs the converted file`, () => { 
      convert(local('rules.yaml'), local('rules.json.ignore'));
      expect(fs.existsSync(local('rules.json.ignore'))).to.be.true;
    });
  });
});
