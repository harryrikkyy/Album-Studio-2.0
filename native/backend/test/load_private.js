'use strict'

// Loads a fresh copy of a backend module for a test. `names` lists private functions to expose as
// `exports.__private`, and `stubs` replaces what the module requires, including the collaborators
// it destructures at load, which a mock of the real module's export can't reach.

const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

function loadPrivate(file, { names = [], stubs = {} } = {}) {
  const filename = require.resolve(file)
  const copy = new Module(filename, module)
  copy.filename = filename
  copy.paths = Module._nodeModulePaths(path.dirname(filename))
  copy.require = function (id) {
    return Object.hasOwn(stubs, id) ? stubs[id] : Module.prototype.require.call(this, id)
  }
  const tail = names.length ? `\nmodule.exports.__private = { ${names.join(', ')} }\n` : ''
  copy._compile(fs.readFileSync(filename, 'utf8') + tail, filename)
  return copy.exports
}

module.exports = { loadPrivate }
