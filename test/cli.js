'use strict'

/*global describe,after,it*/

import {expect} from 'chai'
import {resolve} from 'path'
import {readFileSync, existsSync, unlinkSync} from 'fs'
import {exec} from 'child_process'

const local = resolve.bind(null, __dirname)
const cwd = resolve(__dirname, '..')

describe('CLI', function () {
  this.timeout(1000)
  after(() => {
    const output = local('rules.json.ignore')
    if (existsSync(output)) unlinkSync(output)
  })
  it(`throws an error if the input doesn't exist`, (done) => {
    exec('./bin/butane.js test/foobar.yml', { cwd }, (err) => {
      expect(err).to.be.an.instanceof(Error)
      expect(err.message).to.contain('Input "')
      done()
    })
  })
  it(`prints the rules if no output was specified`, (done) => {
    exec('./bin/butane.js test/rules.yaml', { cwd }, (err, stdout) => {
      const rules = readFileSync(local('rules.json')).toString()
      expect(err).to.be.null
      expect(stdout.toString()).to.equal(rules)
      done()
    })
  })
  it(`throws an error if the output directory doesn't exist`, (done) => {
    exec('./bin/butane.js test/rules.yaml foo/bar.json', { cwd }, (err) => {
      expect(err).to.be.an.instanceof(Error)
      expect(err.message).to.contain('Output directory "')
      done()
    })
  })
  it(`outputs the converted file`, (done) => {
    exec('./bin/butane.js test/rules.yaml test/rules.json.ignore', { cwd }, (err) => {
      expect(err).to.be.null
      done()
    })
  })
})
