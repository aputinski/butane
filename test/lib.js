'use strict'

/*global describe,after,it*/

import {expect} from 'chai'
import {resolve} from 'path'
import {existsSync, unlinkSync} from 'fs'
import {convert} from '../lib'

const local = resolve.bind(null, __dirname)

describe('lib', () => {
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
