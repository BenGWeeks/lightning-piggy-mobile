const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .cjs to source extensions so Metro can resolve bitcoinjs-lib's CJS entry
config.resolver.sourceExts = [...(config.resolver.sourceExts || []), 'cjs'];

// Custom resolver for @noble/curves and @noble/hashes which use ESM exports
// maps with .js extensions that Metro can't resolve by default.
// We rewrite the module name to include .js and delegate to the original resolver.
const originalResolveRequest = config.resolver.resolveRequest;
const resolveWith = (context, moduleName, platform) => {
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const nobleMatch = moduleName.match(/^@noble\/(curves|hashes)\/.+$/);
  if (nobleMatch) {
    if (!moduleName.endsWith('.js')) {
      return resolveWith(context, moduleName + '.js', platform);
    }
    // v1.x exports map lists subpaths without .js (e.g. "./crypto") while
    // consumers import "./crypto.js" — try the stripped form first, fall back.
    try {
      return resolveWith(context, moduleName.slice(0, -3), platform);
    } catch (_) {
      return resolveWith(context, moduleName, platform);
    }
  }

  return resolveWith(context, moduleName, platform);
};

module.exports = config;
