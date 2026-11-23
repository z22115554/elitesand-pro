'use strict';

// Class methods are non-enumerable. Copy descriptors without changing this,
// names, argument defaults, or writable/configurable behavior.
module.exports = function installMethods(Type, methods) {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(methods))) {
    if (Object.hasOwn(Type.prototype, name)) throw new Error('Duplicate Twitch method: ' + name);
    Object.defineProperty(Type.prototype, name, { ...descriptor, enumerable: false });
  }
};
