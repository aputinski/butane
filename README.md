# Butane

[![Build Status][travis-image]][travis-url]
[![NPM version][npm-image]][npm-url]

Butane is a simplified version of the official Firebase
[Blaze Compiler](https://github.com/firebase/blaze_compiler)

##  Getting started

```
npm install -g butane
```

Create a `rules.yaml` file containing the following code:

```yaml
.functions:
  isAuthed(): auth !== null
  createOnly(): next.exists() && !prev.exists()

rules:
  chats:
    $chat:
      .read: true
      .write: isAuthed() && createOnly()
```

Now compile it from the command line:

```
butane rules.yaml rules.json
```

```json
{
  "rules": {
    "chats": {
      "$chat": {
        ".read": true,
        ".write": "auth !== null && (newData.exists() && !data.exists())"
      }
    }
  }
}
```

## Functions

Commonly used expressions are defined in the `.functions` map.

```yaml
.functions:
  isLoggedIn():  auth.uid !== null
  isUser(user):  auth.uid === user
```

You can then use them anywhere a security expression would be expected.

## Simple Security Expressions

Security expressions are the strings that go in `.write/.read/.validate`
values of security rules.

Butane expressions have similar semantics, but shorter syntax.

### Renamed Variables

Some predefined variables have been renamed for clarity:

| Old Name  | New Name  |
| :-------- |:---------:|
| data      | prev      |
| newData   | next      |

### Child Selection

The expression for selecting a child is now an array-like syntax:

```javascript
// Old
root.child('users')
// New:
root['users']
```

In the common case that you are selecting a child using a single literal,
you can select the child as if it were a property.

```javascript
root.users
```

### Coercion of `.val()`

In the new syntax, `.val()` is inserted if the expression is next to an operator
or in an array like child selector. You only need to use `.val()` if you
are using a method of a value type like `.length`, `.beginsWith()`, `.contains(...)`.

```javascript
// Old
newData.child('counter').val() == data.child('counter').val() + 1
// New
next.counter == prev.counter + 1
```

## References

References to commonly used nodes are defined in the `.refs` map.

They can then be accessed by using the `^` symbol.

```yaml
rules:
  messages:
    $message:
      .refs:
        myMessageRef: prev
      title:
       #.read: data.parent().child('settings').child('private').val() ==== false
        .read: ^myMessageRef.settings.private === false
      meta:
        info:
         #.read: data.parent().parent().child('settings').child('private').val() ==== false
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

References can also override the provided value:

```yaml
rules:
  messages:
    $message:
      title:
       #.read: data.parent().child('settings').child('private').val() ==== false
        .read: ^$message.settings.private === false
       #.write: newData.parent().child('settings').child('private').val() ==== false
        .write: ^$message(next).settings.private === false
      settings:
        private:
          .validate: next.isBoolean()
```

[npm-url]: https://npmjs.org/package/butane
[npm-image]: http://img.shields.io/npm/v/butane.svg

[travis-url]: https://travis-ci.org/aputinski/butane
[travis-image]: http://img.shields.io/travis/aputinski/butane.svg
