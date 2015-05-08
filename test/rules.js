const expect = require('chai').expect;
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const {
  getOptions,
  replaceRefs,
  replaceFunctions,
  coerceVal,
  replaceChildSyntax,
  replaceFirebaseIdentifiers,
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
    it('throws an error for invalid .functions', () => {
      expect(() => {
        getOptions({
          '.functions': {
            'isAuthed(a,': 'auth !== null'
          }
        });
      }).to.throw;
      expect(() => {
        getOptions({
          '.functions': {
            '1===2': 'auth !== null'
          }
        });
      }).to.throw;
      expect(() => {
        getOptions({
          '.functions': {
            'isAuthed(a.b)': 'auth !== null'
          }
        });
      }).to.throw;
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
      expect(replaceRefs('isUser(^chat.creator)', options)).to.equal('isUser(next.creator)');
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
          body: 'a && b',
          args: []
        },
        'complex(a,b,c)': {
          name: 'complex',
          body: 'next === a && prev == b || c === b',
          args: ['a', 'b', 'c']
        },
        'hasUser(chat,user)': {
          name: 'hasUser',
          body: 'root.chats[chat].users.hasChild(user)',
          args: ['chat', 'user']
        },
        'userHasChat(chat)': {
          name: 'userHasChat',
          body: 'root.users[auth.uid].chats.hasChild(chat) && root.chats[chat].users.hasChild(auth.uid)',
          args: ['chat']
        },
        'isUser(user)': {
          name: 'isUser',
          body: 'user === auth.uid',
          args: ['user']
        },
        'getChatUser(chat)': {
          name: 'getChatUser',
          body: 'root.chats[chat].users[auth.uid]',
          args: ['chat']
        }
      };
    });
    it('replaces function calls', () => {
      expect(replaceFunctions('simple()', options).code).to.equal('a && b');
      expect(replaceFunctions('complex(1,2,3)', options).code).to.equal('next === 1 && prev == 2 || 3 === 2');
      expect(replaceFunctions('hasUser($chat, $user)', options).code).to.equal('root.chats[$chat].users.hasChild($user)');
      expect(replaceFunctions('userHasChat(next.parent().val())', options).code).to.equal('root.users[auth.uid].chats.hasChild(next.parent().val()) && root.chats[next.parent().val()].users.hasChild(auth.uid)');
      expect(replaceFunctions('isUser($user)', options).code).to.equal('$user === auth.uid');
      expect(replaceFunctions('getChatUser($chat)', options).code).to.equal('root.chats[$chat].users[auth.uid]');
    });
  });
  describe('#coerceVal()', () => {
    it('only matches Firebase identifiers', () => {
      expect(coerceVal('next').code).to.equal('next.val()');
      expect(coerceVal('foobar').code).to.equal('foobar');
      expect(coerceVal('root').code).to.equal('root.val()');
    });
    it('appends .val() to Identifiers / MemberExpressions', () => {
       expect(coerceVal('next.foo').code).to.equal('next.foo.val()');
       expect(coerceVal('next.foo.bar').code).to.equal('next.foo.bar.val()');
       expect(coerceVal(`next.foo['bar']`).code).to.equal(`next.foo['bar'].val()`);
       expect(coerceVal('next.foo === next.bar').code).to.equal('next.foo.val() === next.bar.val()');
    });
    it(`doesn't append .val() to CallExpressions`, () => {
      expect(coerceVal('next.hasChild()').code).to.equal('next.hasChild()');
      expect(coerceVal('next.val()').code).to.equal('next.val()');
    });
  });
  describe('#replaceChildSyntax()', () => {
    it('ignores function calls', () => {
      expect(replaceChildSyntax('next.foo().bar()').code).to.equal('next.foo().bar()');
    });
    it('ignores certain identifiers', () => {
      expect(replaceChildSyntax('$player === auth.uid').code).to.equal('$player === auth.uid');
    });
    it('replaces dot syntax', () => {
      expect(replaceChildSyntax('next.foo').code).to.equal(`next.child('foo')`);
      expect(replaceChildSyntax('next.foo.bar').code).to.equal(`next.child('foo').child('bar')`);
      expect(replaceChildSyntax('next.foo().bar').code).to.equal(`next.foo().child('bar')`);
    });
    it('replaces bracket syntax', () => {
      expect(replaceChildSyntax(`next['foo']`).code).to.equal(`next.child('foo')`);
      expect(replaceChildSyntax(`next['foo']['bar']`).code).to.equal(`next.child('foo').child('bar')`);
      expect(replaceChildSyntax(`next[$foo][$bar]`).code).to.equal(`next.child($foo).child($bar)`);
    });
    it('replaces dot and bracket syntax', () => {
      expect(replaceChildSyntax(`root.chats[$chat].users.hasChild(auth.uid)`).code).to.equal(`root.child('chats').child($chat).child('users').hasChild(auth.uid)`);
      expect(replaceChildSyntax(`root.chats[$chat].users[auth.uid]`).code).to.equal(`root.child('chats').child($chat).child('users').child(auth.uid)`);
      expect(replaceChildSyntax(`root.chats[$chat].users[next.foo]`).code).to.equal(`root.child('chats').child($chat).child('users').child(next.child('foo'))`);
      expect(replaceChildSyntax(`root.chats[$chat].users[next.foo]`).code).to.equal(`root.child('chats').child($chat).child('users').child(next.child('foo'))`);
      expect(replaceChildSyntax(`root.users[user].chats.hasChild(root.chats[chat])`).code).to.equal(`root.child('users').child(user).child('chats').hasChild(root.child('chats').child(chat))`);
    });
  });
  describe('#replaceFirebaseIdentifiers()', () => {
    it('replaces reserved Firebase replaceFirebaseIdentifiers', () => {
      expect(replaceFirebaseIdentifiers('prev').code).to.equal('data');
      expect(replaceFirebaseIdentifiers('prev.prev').code).to.equal('data.prev');
      expect(replaceFirebaseIdentifiers('next').code).to.equal('newData');
      expect(replaceFirebaseIdentifiers('next.next').code).to.equal('newData.next');
      expect(replaceFirebaseIdentifiers('prev.foo.bar').code).to.equal('data.foo.bar');
      expect(replaceFirebaseIdentifiers('next.foo.bar').code).to.equal('newData.foo.bar');
      expect(replaceFirebaseIdentifiers('next.foo.hasChild(prev.bar)').code).to.equal('newData.foo.hasChild(data.bar)');
    });
  });
  describe('#parse()', () => {
    it('parses an entire ruleset', () => {
      const rules = fs.readFileSync(path.resolve(__dirname, 'rules.yaml')).toString();
      const rulesJSON = yaml.safeLoad(rules);
      parse(rulesJSON);
      const expectedJSON = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'rules.json')).toString());
      expect(rulesJSON).to.eql(expectedJSON);
    });
  });
});
