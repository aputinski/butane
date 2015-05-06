const expect = require('chai').expect;
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const {
  getOptions,
  replaceRefs,
  replaceFunctions,
  replaceChildSyntax,
  replaceKeywords,
  coerceVal,
  parse
} = require('../lib/rules');

describe('rules', () => {
  describe('#getOptions()', () => {
    it('returns an object', () => {
      const options = getOptions({});
      expect(options).to.be.an('object');
    });
    it('returns the correct option keys', () => {
      const options = getOptions({});
      expect(options).to.have.all.keys('.functions', '.refs', '.parent');
    });
    it('removes option keys fromm the rules', () => {
      const rules = {
        '.functions': {},
        '.refs': {}
      };
      const options = getOptions(rules);
      expect(rules).not.to.have.any.keys('.functions', '.refs', '.parent');
    });
    it('save the parent rule for the next iteration', () => {
      const rules = {
        '.refs': {},
        messages: {
          $message: {}
        }
      };
      let options = getOptions(rules);
      options = getOptions(rules.messages, options);
      expect(options['.parent']).to.equal(rules.messages);
    });
    it('save creates .refs to $wildcards', () => {
      const rules = {
        '.refs': {},
        messages: {
          $message: {}
        }
      };
      let options = getOptions(rules);
      options = getOptions(rules.messages, options);
      options = getOptions(rules.messages.$message, options);
      expect(options['.refs']).to.have.ownProperty('$message');
      expect(options['.refs']['$message']).to.all.keys('value', 'depth');
      expect(options['.refs']['$message'].depth).to.be.a('number');
    });
    it('expands .refs', () => {
      const rules = {
        '.refs': {
          foo: 'next',
          bar: 'next.parent()'
        }
      };
      let options = getOptions(rules);
      expect(options['.refs']).to.have.ownProperty('foo');
      expect(options['.refs'].foo).eql({
        value: 'next',
        depth: 0
      });
      expect(options['.refs']).to.have.ownProperty('bar');
      expect(options['.refs'].bar).eql({
        value: 'next.parent()',
        depth: 0
      });
    });
    it('expands .functions', () => {
      const rules = {
        '.functions': {
          'isAuthed(a,b)': 'auth !== null',
          'isActive()': 'active === true'
        }
      };
      let options = getOptions(rules);
      expect(options['.functions']).to.have.ownProperty('isAuthed(a,b)');
      expect(options['.functions']['isAuthed(a,b)']).eql({
        body: 'auth !== null',
        name: 'isAuthed',
        args: ['a', 'b']
      });
      expect(options['.functions']).to.have.ownProperty('isActive()');
      expect(options['.functions']['isActive()']).eql({
        body: 'active === true',
        name: 'isActive',
        args: []
      });
    });
  });
  describe('#replaceRefs()', () => {
    it('replaced ^REF_NAME', () => {
      let options = {'.refs':{chat:{value:'next',depth:0}}}
      expect(replaceRefs('^chat', options)).to.equal('next');
      expect(replaceRefs('^chat.foo.bar', options)).to.equal('next.foo.bar');
      expect(replaceRefs('^chat.foo === ^chat.bar', options)).to.equal('next.foo === next.bar');
    });
    it('appends the correct number of parent() functions', () => {
      let options = {'.refs':{chat:{value:'next',depth:0}}};
      expect(replaceRefs('^chat', options).match(/parent/g)).to.be.null;
      options = {'.refs':{chat:{value:'next',depth:1}}};
      expect(replaceRefs('^chat', options).match(/parent/g)).to.have.length(1);
      options = {'.refs':{chat:{value:'next',depth:2}}};
      expect(replaceRefs('^chat', options).match(/parent/g)).to.have.length(2);
    });
    it('replaces ^REF_NAME(value)', () => {
      let options = {'.refs':{chat:{value:'next',depth:1}}};
      expect(replaceRefs('^chat(prev)', options)).to.equal('prev.parent()')
      expect(replaceRefs('^chat(prev).foo', options)).to.equal('prev.parent().foo')
    });
  });
  describe('#replaceFunctions()', () => {
    let options = {};
    before(() => {
      options['.functions'] = {
        'simple()': {
          name: 'simple',
          body: 'myValue',
          args: []
        },
        'hasUser(user)': {
          name: 'hasUser',
          body: 'auth.uid === user',
          args: ['user']
        },
        'complex(a,b,c)': {
          name: 'complex',
          body: 'next === a && prev == b || c === b',
          args: ['a', 'b', 'c']
        },
        'chatHasUser(chat)': {
          name: 'chatHasUser',
          body: 'root.users[user].hasChild(auth.uid) && user === true',
          args: ['user']
        },
        'isUser(user)': {
          name: 'isUser',
          body: 'user === auth.uid',
          args: ['user']
        },
        'getUser': {
          name: 'getUser',
          body: 'root.chats[chat].users[auth.uid]',
          args: ['chat']
        }
      };
    });
    it('replaces function calls', () => {
      expect(replaceFunctions('simple()', options)).to.equal('myValue');
      expect(replaceFunctions('hasUser($user)', options)).to.equal('auth.uid === $user');
      expect(replaceFunctions('complex(1,2,3)', options)).to.equal('next === 1 && prev == 2 || 3 === 2');
      expect(replaceFunctions('chatHasUser($user)', options)).to.equal('root.users[$user].hasChild(auth.uid) && $user === true');
      expect(replaceFunctions('isUser($user)', options)).to.equal('$user === auth.uid');
      expect(replaceFunctions('getUser($chat)', options)).to.equal('root.chats[$chat].users[auth.uid]');
    });
  });
  describe('#replaceChildSyntax()', () => {
    it('ignores function calls', () => {
      expect(replaceChildSyntax('next.foo().bar()')).to.equal('next.foo().bar()');
    });
    it('replaces dot syntax', () => {
      expect(replaceChildSyntax('next.foo')).to.equal(`next.child('foo').val()`);
      expect(replaceChildSyntax('next.foo.bar')).to.equal(`next.child('foo').child('bar').val()`);
      expect(replaceChildSyntax('next.foo().bar')).to.equal(`next.foo().child('bar').val()`);
    });
    it('replaces bracket syntax', () => {
      expect(replaceChildSyntax(`next['foo']`)).to.equal(`next.child('foo').val()`);
      expect(replaceChildSyntax(`next['foo']['bar']`)).to.equal(`next.child('foo').child('bar').val()`);
      expect(replaceChildSyntax(`next[$foo][$bar]`)).to.equal(`next.child($foo).child($bar).val()`);
    });
    it('replaces dot and bracket syntax', () => {
      expect(replaceChildSyntax(`root.chats[$chat].users.hasChild(auth.uid)`)).to.equal(`root.child('chats').child($chat).child('users').hasChild(auth.uid)`);
      expect(replaceChildSyntax(`root.chats[$chat].users[auth.uid]`)).to.equal(`root.child('chats').child($chat).child('users').child(auth.uid).val()`);
      expect(replaceChildSyntax(`root.users[user].chats.hasChild(root.chats[chat])`)).to.equal(`root.child('users').child(user).child('chats').hasChild(root.child('chats').child(chat).val())`);
    });
  });
  describe('#replaceKeywords()', () => {
    it('replaces keywords (prev|next) followed by a "."', () => {
      expect(replaceKeywords('prev.')).to.equal('data.');
      expect(replaceKeywords('next.')).to.equal('newData.');
      expect(replaceKeywords('prev.foo.bar')).to.equal('data.foo.bar');
      expect(replaceKeywords('next.foo.bar')).to.equal('newData.foo.bar');
    });
  });
  describe('#coerceVal()', () => {
    it('only matches (next|prev|root)', () => {
      expect(coerceVal('foobar')).to.equal('foobar');
      expect(coerceVal('root')).not.to.equal('root');
    });
    it('appends .val() when necessary', () => {
       expect(coerceVal('next.foo')).to.equal('next.foo.val()');
       expect(coerceVal('next.foo.bar')).to.equal('next.foo.bar.val()');
       expect(coerceVal('next.foo["bar"]')).to.equal('next.foo["bar"].val()');
       expect(coerceVal('next.foo === next.bar')).to.equal('next.foo.val() === next.bar.val()');
       expect(coerceVal('^myRef.foo === next.bar')).to.equal('^myRef.foo.val() === next.bar.val()');
       expect(coerceVal('next.hasChild()')).to.equal('next.hasChild()');
       expect(coerceVal('next.val()')).to.equal('next.val()');
    });
  });
  describe('#parse()', () => {
    it('parses an entire ruleset', () => {
      const rules = fs.readFileSync(path.resolve(__dirname, 'rules.yml')).toString();
      const rulesJSON = yaml.safeLoad(rules);
      parse(rulesJSON);
      const expectedJSON = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'rules.json')).toString());
      expect(rulesJSON).to.eql(expectedJSON);
    });
  });
});
