const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .cjs to source extensions so Metro can resolve bitcoinjs-lib's CJS entry
config.resolver.sourceExts = [...(config.resolver.sourceExts || []), 'cjs'];

// Custom resolver for @noble/curves and @noble/hashes. Their exports maps
// differ across versions:
//   - v2.x lists subpaths WITH .js (e.g. "./crypto.js"), but consumers often
//     import without it — append .js so Metro can resolve.
//   - v1.x lists subpaths WITHOUT .js (e.g. "./crypto"), but consumers import
//     "./crypto.js" — strip the trailing .js first, fall back to the original
//     form if the stripped form can't be resolved.
const originalResolveRequest = config.resolver.resolveRequest;
const resolveWith = (context, moduleName, platform) => {
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

const isModuleNotFound = (err) => {
  if (!err) return false;
  // Metro throws a custom error; match by name/code/message to avoid
  // swallowing unrelated resolver errors.
  if (err.code === 'MODULE_NOT_FOUND') return true;
  if (err.name === 'UnableToResolveError') return true;
  return typeof err.message === 'string' && /unable to resolve/i.test(err.message);
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const nobleMatch = moduleName.match(/^@noble\/(curves|hashes)\/.+$/);
  if (nobleMatch) {
    if (!moduleName.endsWith('.js')) {
      return resolveWith(context, moduleName + '.js', platform);
    }
    try {
      return resolveWith(context, moduleName.slice(0, -3), platform);
    } catch (err) {
      if (!isModuleNotFound(err)) throw err;
      return resolveWith(context, moduleName, platform);
    }
  }

  return resolveWith(context, moduleName, platform);
};

module.exports = config;
