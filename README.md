# Butane

[![Build Status][travis-image]][travis-url]
[![NPM version][npm-image]][npm-url]

Butane is simplified version of the offical Firebase
[Blaze Compiler](https://github.com/firebase/blaze_compiler)

##  Getting started

```
npm install -g butane
```

Create a `rules.yml` containing the following code:

```yaml
rules:
  .functions:
    isAuthed(): auth !== null
  .read: isAuthed()
  .write: isAuthed()
```

Now compile it from the command line:

```
butane rules.yaml rules.json
```

```json
{
  "rules": {
    ".read": "auth !== null",
    ".write": "auth !== null"
  }
}
```

## Functions

Common expressions for reuse are defined in the `.functions` list.

```yaml
.functions:
  - isLoggedIn():      auth.username !== null
  - isUser(username):  auth.username === username
```

You can then use them anywhere a security expression would be expected.

**NOTE: functions cannot currently reference other functions.**

## Simple Security Expressions

Security expressions are the strings that used to go in write/read/validate
portions of the old security rules.

Butane expressions have similar semantics but shorter syntax.

### Variables renamed

`data` and `newData` have been renamed to `prev` and `next`. `root` has
the same meaning.

### Child selection

The expression for selecting a child is now an array-like syntax. What was:

```
root.child('users')
```

is now

```
root['users']
```

In the common case that you are selecting a child using a single literal,
you can select the child as if it were a property.

So you can also write the above as:

```
root.users
```

### Coercion of `.val()`

In the new syntax, `.val()` is inserted if the expression is next to an operator
or in an array like child selector. You only need to use `.val()` if you
are using a method of a value type like `.length`, `.beginsWith()`, `.contains(...)`.

```
newData.child('counter').val() == data.child('counter').val() + 1
```
is simplified to just
```
next.counter == prev.counter + 1
```

## References

References to commonly used nodes are defined in the `.refs` list.

They can then be accessed by using the `^` symbol.

```yaml
rules:
  messages:
    $message:
      .refs:
        myMessageRef: prev
      title:
       #.read: data.parent().child('settings/private').val() ==== false
        .read: ^myMessageRef.settings.private === false
      meta:
        info:
         #.read: data.parent().parent().child('settings/private').val() ==== false
          .read: ^myMessageRef.settings.private === false
      settings:
        private:
          .validate: next.isBoolean()
```

Because it's common to reference `$wildcard` paths, they will automatically
insert a `.ref` with the name of the wildcard (including the `$`)

```yaml
rules:
  messages:
    $message:
      # no need to specify .refs
      title:
        .read: ^$message.settings.private === false
      settings:
        private:
          .validate: next.isBoolean()
```

References can also override the provied value:

```yaml
rules:
  messages:
    $message:
      title:
       #.read: data.parent().child('settings/private').val() ==== false
        .read: ^$message.settings.private === false
       #.write: newData.parent().child('settings/private').val() ==== false
        .write: ^$message(next).settings.private === false
      settings:
        private:
          .validate: next.isBoolean()
```

[npm-url]: https://npmjs.org/package/butane
[npm-image]: http://img.shields.io/npm/v/butane.svg

[travis-url]: https://travis-ci.org/aputinski/butane
[travis-image]: http://img.shields.io/travis/aputinski/butane.svg
