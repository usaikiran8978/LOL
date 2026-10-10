// Expo's default config already understands npm workspaces (watchFolders + nodeModulesPaths).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The workspace root hoists a newer `react` for apps/admin. React Native's renderer requires the exact React version
// it was built against, so every import of react (including from hoisted packages like react-native) must resolve to
// this app's pinned copy.
const pinned = new Set(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (pinned.has(moduleName)) {
    return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [__dirname] }) };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
