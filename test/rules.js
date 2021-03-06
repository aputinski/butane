'use strict'

/*global describe,beforeEach,it*/

import {expect} from 'chai'
import {resolve} from 'path'
import {readFileSync} from 'fs'
import yaml from 'js-yaml'

import {
  coerceVal,
  getOptions,
  registerFunction,
  replaceChildSyntax,
  replaceFirebaseIdentifiers,
  replaceFunctions,
  replaceRefs,
  parse
} from '../lib/rules'

describe('rules', () => {
  describe('#getOptions()', () => {
    it('returns an object', () => {
      const options = getOptions({})
      expect(options).to.be.an('object')
    })
    it('returns the correct option keys', () => {
      const options = getOptions({})
      expect(options).to.have.all.keys('.functions', '.refs', '.parent')
    })
    it('removes option keys from the rules', () => {
      const rules = {
        '.functions': {},
        '.refs': {}
      }
      getOptions(rules)
      expect(rules).not.to.have.any.keys('.functions', '.refs', '.parent')
    })
    it('save the parent rule for the next iteration', () => {
      const rules = {
        '.refs': {},
        messages: {
          $message: {}
        }
      }
      let options = getOptions(rules)
      options = getOptions(rules.messages, options)
      expect(options['.parent']).to.equal(rules.messages)
    })
    it('save creates .refs to $wildcards', () => {
      const rules = {
        '.refs': {},
        messages: {
          $message: {}
        }
      }
      let options = getOptions(rules)
      options = getOptions(rules.messages, options)
      options = getOptions(rules.messages.$message, options)
      expect(options['.refs']).to.have.ownProperty('$message')
      expect(options['.refs']['$message']).to.all.keys('value', 'depth')
      expect(options['.refs']['$message'].depth).to.be.a('number')
    })
    it('expands .refs', () => {
      const rules = {
        '.refs': {
          foo: 'next',
          bar: 'next.parent()'
        }
      }
      let options = getOptions(rules)
      expect(options['.refs']).to.have.ownProperty('foo')
      expect(options['.refs'].foo).to.deep.equal({
        value: 'next',
        depth: 0
      })
      expect(options['.refs']).to.have.ownProperty('bar')
      expect(options['.refs'].bar).to.deep.equal({
        value: 'next.parent()',
        depth: 0
      })
    })
    it('throws an error for invalid .functions', () => {
      expect(() => {
        getOptions({
          '.functions': {
            'isAuthed(a,': 'auth !== null'
          }
        })
      }).to.throw('Invalid .function declaration: isAuthed(a,')
      expect(() => {
        getOptions({
          '.functions': {
            '1===2': 'auth !== null'
          }
        })
      }).to.throw('Invalid .function declaration: 1===2')
      expect(() => {
        getOptions({
          '.functions': {
            'isAuthed(a.b)': 'auth !== null'
          }
        })
      }).to.throw('Invalid .function declaration: isAuthed(a.b)')
    })
    it('expands .functions', () => {
      const prevOptions = {
        '.functions': {
          'isAuthed()': 'auth !== null'
        }
      }
      const rules = {
        '.functions': {
          'isAuthed(user)': 'auth !== null && auth.uid === user',
          'isActive()': 'active === true'
        }
      }
      let options = getOptions(rules, prevOptions)
      expect(options['.functions']['isAuthed']).to.deep.equal({
        body: 'auth !== null && auth.uid === user',
        name: 'isAuthed',
        args: ['user']
      })
      expect(options['.functions']['isActive']).to.deep.equal({
        body: 'active === true',
        name: 'isActive',
        args: []
      })
    })
  })
  describe('#replaceRefs()', () => {
    it('replaced ^REF_NAME', () => {
      let options = {'.refs': {chat: {value: 'next', depth: 0}}}
      expect(replaceRefs('^chat', options)).to.equal('next')
      expect(replaceRefs('^chat.foo.bar', options)).to.equal('next.foo.bar')
      expect(replaceRefs('^chat.foo === ^chat.bar', options)).to.equal('next.foo === next.bar')
      expect(replaceRefs('isUser(^chat.creator)', options)).to.equal('isUser(next.creator)')
    })
    it('appends the correct number of parent() functions', () => {
      let options = {'.refs': {chat: {value: 'next', depth: 0}}}
      expect(replaceRefs('^chat', options).match(/parent/g)).to.be.null
      options = {'.refs': {chat: {value: 'next', depth: 1}}}
      expect(replaceRefs('^chat', options).match(/parent/g)).to.have.length(1)
      options = {'.refs': {chat: {value: 'next', depth: 2}}}
      expect(replaceRefs('^chat', options).match(/parent/g)).to.have.length(2)
    })
    it('replaces ^REF_NAME(value)', () => {
      let options = {'.refs': {chat: {value: 'next', depth: 1}}}
      expect(replaceRefs('^chat(prev)', options)).to.equal('prev.parent()')
      expect(replaceRefs('^chat(prev).foo', options)).to.equal('prev.parent().foo')
    })
  })
  describe('#replaceFunctions()', () => {
    let options
    beforeEach(() => {
      options = {'.functions': {}}
    })
    it('replaces function calls', () => {
      options['.functions'] = {
        'simple': {
          name: 'simple',
          body: 'next.exists()',
          args: []
        },
        'complex': {
          name: 'complex',
          body: 'next === a && prev == b || c === b',
          args: ['a', 'b', 'c']
        },
        'hasUser': {
          name: 'hasUser',
          body: 'root.chats[chat].users.hasChild(user)',
          args: ['chat', 'user']
        },
        'userHasChat': {
          name: 'userHasChat',
          body: 'root.users[auth.uid].chats.hasChild(chat) && root.chats[chat].users.hasChild(auth.uid)',
          args: ['chat']
        },
        'isUser': {
          name: 'isUser',
          body: 'user === auth.uid',
          args: ['user']
        },
        'getChatUser': {
          name: 'getChatUser',
          body: 'root.chats[chat].users[auth.uid]',
          args: ['chat']
        }
      }
      expect(replaceFunctions('simple()', options).code).to.equal('next.exists()')
      expect(replaceFunctions('complex(1,2,3)', options).code).to.equal('next === 1 && prev == 2 || 3 === 2')
      expect(replaceFunctions('hasUser($chat, $user)', options).code).to.equal('root.chats[$chat].users.hasChild($user)')
      expect(replaceFunctions('userHasChat(next.parent().val())', options).code).to.equal('root.users[auth.uid].chats.hasChild(next.parent().val()) && root.chats[next.parent().val()].users.hasChild(auth.uid)')
      expect(replaceFunctions('isUser($user)', options).code).to.equal('$user === auth.uid')
      expect(replaceFunctions('getChatUser($chat)', options).code).to.equal('root.chats[$chat].users[auth.uid]')
    })
    it('throws an error for non-existent function calls', () => {
      options['.functions'] = {
      }
      expect(() => {
        replaceFunctions('doesNotExist()', options)
      }).to.throw(/ has not been defined/)
    })
    it('replaces nested function calls', () => {
      options['.functions'] = {
        'isString': {
          name: 'isString',
          body: 'snapshot.isString()',
          args: ['snapshot']
        },
        'b': {
          name: 'b',
          body: 'isString(snapshot)',
          args: ['snapshot']
        }
      }
      expect(replaceFunctions('b(prev)', options).code).to.equal('prev.isString()')
    })
    it('replaces argument function calls', () => {
      options['.functions'] = {
        'greeting': {
          name: 'greeting',
          body: 'name',
          args: ['name']
        },
        'getName': {
          name: 'getName',
          body: 'next.name',
          args: []
        },
        'getUser': {
          name: 'getUser',
          body: 'root.users[user].name',
          args: ['user']
        }
      }
      expect(replaceFunctions('greeting(getName())', options).code).to.equal('next.name')
      expect(replaceFunctions('greeting(getUser(auth.uid))', options).code).to.equal('root.users[auth.uid].name')
    })
    it('replaces registered functions', () => {
      registerFunction('myCustomRegisterdFunction', function (snapshot, value) {
        return `${snapshot} === "${value}"`
      })
      expect(replaceFunctions('myCustomRegisterdFunction("next.greeting", "hello")', options).code).to.equal(`next.greeting === 'hello'`)
    })
    it('replaces functions inside registered functions', () => {
      options['.functions'] = {
        'foo': {
          name: 'foo',
          body: 'snapshot.bar === baz',
          args: ['snapshot']
        }
      }
      registerFunction('myCustomRegisterdFunction', function (snapshot, value) {
        return `${snapshot}.hello.world === true && foo(${snapshot})`
      })
      expect(replaceFunctions('myCustomRegisterdFunction("next")', options).code).to.equal(`next.hello.world === true && next.bar === baz`)
    })
    it('replaces oneOf() functions', () => {
      expect(() => {
        replaceFunctions('oneOf()', options)
      }).to.throw(Error)
      expect(replaceFunctions('oneOf(["foo", "bar", "baz"])', options).code).to.equal(`next === 'foo' || next === 'bar' || next === 'baz'`)
      expect(replaceFunctions('oneOf(["foo", "bar"], "prev")', options).code).to.equal(`prev === 'foo' || prev === 'bar'`)
      expect(replaceFunctions('oneOf([true,"false"])', options).code).to.equal(`next === true || next === 'false'`)
    })
  })
  describe('#coerceVal()', () => {
    it('only matches Firebase identifiers', () => {
      expect(coerceVal('next').code).to.equal('next.val()')
      expect(coerceVal('foobar').code).to.equal('foobar')
      expect(coerceVal('root').code).to.equal('root.val()')
    })
    it('appends .val() to Identifiers / MemberExpressions', () => {
      expect(coerceVal('next.foo').code).to.equal('next.foo.val()')
      expect(coerceVal('next.foo.bar').code).to.equal('next.foo.bar.val()')
      expect(coerceVal(`next.foo['bar']`).code).to.equal(`next.foo['bar'].val()`)
      expect(coerceVal('next.foo === next.bar').code).to.equal('next.foo.val() === next.bar.val()')
      expect(coerceVal('next.foo === next.bar').code).to.equal('next.foo.val() === next.bar.val()')
      expect(coerceVal('root.users[user].hasUser(next.bar.baz)').code).to.equal('root.users[user].hasUser(next.bar.baz.val())')
      expect(coerceVal('root.users[user].hasUser(next.bar.baz)').code).to.equal('root.users[user].hasUser(next.bar.baz.val())')
    })
    it(`doesn't append .val() to CallExpressions`, () => {
      expect(coerceVal('next.hasChild()').code).to.equal('next.hasChild()')
      expect(coerceVal('next.val()').code).to.equal('next.val()')
    })
    it(`doesn't append .val() if .val() already exists`, () => {
      expect(coerceVal('next.val().length').code).to.equal('next.val().length')
    })
    it(`appends .val() to computed properties`, () => {
      expect(coerceVal('root.names[next]').code).to.equal('root.names[next.val()].val()')
      expect(coerceVal('root.names[next][prev]').code).to.equal('root.names[next.val()][prev.val()].val()')
      expect(coerceVal('root.names[root.foo.bar][prev][next]').code).to.equal('root.names[root.foo.bar.val()][prev.val()][next.val()].val()')
      expect(coerceVal('isUser(next.foo[prev])').code).to.equal('isUser(next.foo[prev.val()].val())')
      expect(coerceVal('isUser(getUser(next), next)').code).to.equal('isUser(getUser(next.val()), next.val())')
      expect(coerceVal('root[next] === $player').code).to.equal('root[next.val()].val() === $player')
      expect(coerceVal('root[next].exists()').code).to.equal('root[next.val()].exists()')
    })
    it('appends .val() to CallExpressions arguments', () => {
      expect(coerceVal('isUser(next).exists()').code).to.equal('isUser(next.val()).exists()')
      expect(coerceVal('isUser(next.id).exists()').code).to.equal('isUser(next.id.val()).exists()')
      expect(coerceVal('root.games[$game].players.hasChild(auth.uid)').code).to.equal('root.games[$game].players.hasChild(auth.uid)')
    })
  })
  describe('#replaceChildSyntax()', () => {
    it('ignores function calls', () => {
      expect(replaceChildSyntax('next.foo().bar()').code).to.equal('next.foo().bar()')
    })
    it('ignores certain identifiers', () => {
      expect(replaceChildSyntax('$player === auth.uid').code).to.equal('$player === auth.uid')
    })
    it('replaces property syntax', () => {
      expect(replaceChildSyntax('next.foo').code).to.equal(`next.child('foo')`)
      expect(replaceChildSyntax('next.foo.bar').code).to.equal(`next.child('foo').child('bar')`)
      expect(replaceChildSyntax('next.foo().bar').code).to.equal(`next.foo().child('bar')`)
    })
    it('replaces computed property syntax', () => {
      expect(replaceChildSyntax(`next['foo']`).code).to.equal(`next.child('foo')`)
      expect(replaceChildSyntax(`next['foo']['bar']`).code).to.equal(`next.child('foo').child('bar')`)
      expect(replaceChildSyntax(`next[$foo][$bar]`).code).to.equal(`next.child($foo).child($bar)`)
    })
    it('replaces property and computed property syntax', () => {
      expect(replaceChildSyntax(`root.chats[$chat].users.hasChild(auth.uid)`).code).to.equal(`root.child('chats').child($chat).child('users').hasChild(auth.uid)`)
      expect(replaceChildSyntax(`root.chats[$chat].users[auth.uid]`).code).to.equal(`root.child('chats').child($chat).child('users').child(auth.uid)`)
      expect(replaceChildSyntax(`root.chats[$chat].users[next.foo]`).code).to.equal(`root.child('chats').child($chat).child('users').child(next.child('foo'))`)
      expect(replaceChildSyntax(`root.chats[$chat].users[next.foo]`).code).to.equal(`root.child('chats').child($chat).child('users').child(next.child('foo'))`)
      expect(replaceChildSyntax(`root.users[user].chats.hasChild(root.chats[chat])`).code).to.equal(`root.child('users').child(user).child('chats').hasChild(root.child('chats').child(chat))`)
    })
    it('replaces property and computed property syntax inside function arguments ', () => {
      expect(replaceChildSyntax('next.foo.bar.val()').code).to.equal(`next.child('foo').child('bar').val()`)
      expect(replaceChildSyntax('next.hasChild(next.foo.bar.val())').code).to.equal(`next.hasChild(next.child('foo').child('bar').val())`)
    })
    it('replaces property and computed property syntax inside computed properties', () => {
      expect(replaceChildSyntax('root[next.user.val()]').code).to.equal(`root.child(next.child('user').val())`)
      expect(replaceChildSyntax('root[next.val()]').code).to.equal(`root.child(next.val())`)
    })
  })
  describe('#replaceFirebaseIdentifiers()', () => {
    it('replaces reserved Firebase replaceFirebaseIdentifiers', () => {
      expect(replaceFirebaseIdentifiers('prev').code).to.equal('data')
      expect(replaceFirebaseIdentifiers('prev.prev').code).to.equal('data.prev')
      expect(replaceFirebaseIdentifiers('next').code).to.equal('newData')
      expect(replaceFirebaseIdentifiers('next.next').code).to.equal('newData.next')
      expect(replaceFirebaseIdentifiers('prev.foo.bar').code).to.equal('data.foo.bar')
      expect(replaceFirebaseIdentifiers('next.foo.bar').code).to.equal('newData.foo.bar')
      expect(replaceFirebaseIdentifiers('next.foo.hasChild(prev.bar)').code).to.equal('newData.foo.hasChild(data.bar)')
    })
  })
  describe('#parse()', () => {
    it('parses an entire ruleset', () => {
      const rules = readFileSync(resolve(__dirname, 'rules.yaml')).toString()
      const rulesJSON = yaml.safeLoad(rules)
      parse(rulesJSON)
      const expectedJSON = JSON.parse(readFileSync(resolve(__dirname, 'rules.json')).toString())
      expect(rulesJSON).to.deep.equal(expectedJSON)
    })
  })
})
