const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .cjs to source extensions so Metro can resolve bitcoinjs-lib's CJS entry
config.resolver.sourceExts = [...(config.resolver.sourceExts || []), 'cjs'];

// Custom resolver for @noble/curves and @noble/hashes which use ESM exports
// maps with .js extensions that Metro can't resolve by default.
// We rewrite the module name to include .js and delegate to the original resolver.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Handle @noble/curves/* and @noble/hashes/* imports without .js extension
  // e.g. '@noble/curves/secp256k1' → '@noble/curves/secp256k1.js'
  const nobleMatch = moduleName.match(/^(@noble\/(curves|hashes)\/.+)$/);
  if (nobleMatch && !moduleName.endsWith('.js')) {
    const rewritten = moduleName + '.js';
    // Use the original resolver (not context.resolveRequest) to avoid
    // recursion through this custom resolver.
    if (originalResolveRequest) {
      return originalResolveRequest(context, rewritten, platform);
    }
    return context.resolveRequest(context, rewritten, platform);
  }

  // Fall through to default resolution
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
