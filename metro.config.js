const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@react-navigation/native-stack") {
    return {
      type: "sourceFile",
      filePath: path.join(
        __dirname,
        "node_modules",
        "@react-navigation",
        "native-stack",
        "lib",
        "commonjs",
        "index.js"
      ),
    };
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
