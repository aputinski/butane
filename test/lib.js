'use strict'

/*global describe,after,it*/

import {expect} from 'chai'
import {resolve} from 'path'
import {readFileSync, existsSync, unlinkSync} from 'fs'
import {convert, convertFile, registerFunction} from '../lib'

const local = resolve.bind(null, __dirname)

describe('lib', () => {
  describe('#registerFunction()', () => {
    it('returns the name of registered function', () => {
      const name = registerFunction('MyCustomFunction', function () {})
      expect(name).to.equal('MyCustomFunction')
    })
  })
  describe('#convert()', () => {
    it(`throws an error if the input isn't a string`, () => {
      expect(() => {
        convert()
      })
      .to.throw(/string/)
    })
    it(`returns the rules as a string`, () => {
      const rulesString = readFileSync(local('rules.yaml')).toString()
      const rules = convert(rulesString)
      expect(rules).to.be.a('string')
    })
    it(`returns the expected rules`, () => {
      const rules = JSON.parse(convert(readFileSync(local('rules.yaml')).toString()))
      const expectedRules = JSON.parse(readFileSync(local('rules.json')).toString())
      expect(rules).to.deep.equal(expectedRules)
    })
  })
  describe('#convertFile()', () => {
    after(() => {
      const output = local('rules.json.ignore')
      if (existsSync(output)) unlinkSync(output)
    })
    it(`throws an error if the input doesn't exist`, () => {
      expect(() => {
        convertFile(local('foo/bar/baz.yml'))
      })
      .to.throw(/Input \"/)
    })
    it(`returns the rules`, () => {
      const rules = convertFile(local('rules.yaml'))
      const expectedRules = JSON.parse(readFileSync(local('rules.json')).toString())
      expect(rules).to.deep.equal(expectedRules)
    })
    it(`throws an error if the output directory doesn't exist`, () => {
      expect(() => {
        convertFile(local('rules.yaml'), local('foo/bar/rules.json.ignore'))
      })
      .to.throw(/Output directory \"/)
    })
    it(`outputs the converted file`, () => {
      convertFile(local('rules.yaml'), local('rules.json.ignore'))
      expect(existsSync(local('rules.json.ignore'))).to.equal(true)
    })
  })
})
