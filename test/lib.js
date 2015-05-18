'use strict'

/*global describe,after,it*/

import {expect} from 'chai'
import {resolve} from 'path'
import {readFileSync, existsSync, unlinkSync} from 'fs'
import {convert, registerFunction} from '../lib'

const local = resolve.bind(null, __dirname)

describe('lib', () => {
  describe('#registerFunction()', () => {
    it('returns the name of registered function', () => {
      const name = registerFunction('MyCustomFunction', function () {})
      expect(name).to.equal('MyCustomFunction')
    })
  })
  describe('#convert()', () => {
    after(() => {
      const output = local('rules.json.ignore')
      if (existsSync(output)) unlinkSync(output)
    })
    it(`throws an error if the input doesn't exist`, () => {
      expect(() => {
        convert(local('foo/bar/baz.yml'))
      })
      .to.throw(/Input \"/)
    })
    it(`returns the rules`, () => {
      const rules = convert(local('rules.yaml'))
      const expectedRules = JSON.parse(readFileSync(local('rules.json')).toString())
      expect(rules).to.deep.equal(expectedRules)
    })
    it(`throws an error if the output directory doesn't exist`, () => {
      expect(() => {
        convert(local('rules.yaml'), local('foo/bar/rules.json.ignore'))
      })
      .to.throw(/Output directory \"/)
    })
    it(`outputs the converted file`, () => {
      convert(local('rules.yaml'), local('rules.json.ignore'))
      expect(existsSync(local('rules.json.ignore'))).to.equal(true)
    })
  })
})
