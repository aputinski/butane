const expect = require('chai').expect;
const path = require('path');
const fs = require('fs');
const exec = require('child_process').exec;

const local = path.resolve.bind(path, __dirname);
const cwd = path.resolve(__dirname, '..');

describe('CLI', () => {
  before(function(done) {
    exec('npm run dist', {cwd}, done);
  });
  after(function () {
    const output = local('rules.json.ignore');
    if (fs.existsSync(output)) {
      fs.unlinkSync(output);
    }
  });
  it(`throws an error if the input doesn't exist`, (done) => {
    exec('./bin/butane.js test/foobar.yml', { cwd }, err => {
      expect(err).to.be.an.instanceof(Error);
      expect(err.message).to.contain('Input "');
      done();
    });
  });
  it(`throws an error if the output directory doesn't exist`, (done) => {
    exec('./bin/butane.js test/rules.yaml foo/bar.json', { cwd }, err => {
      expect(err).to.be.an.instanceof(Error);
      expect(err.message).to.contain('Output directory "');
      done();
    });
  });
  it(`outputs the converted file`, (done) => { 
    exec('./bin/butane.js test/rules.yaml test/rules.json.ignore', { cwd }, err => {
      expect(err).to.be.null;
      done();
    });
  });
});
