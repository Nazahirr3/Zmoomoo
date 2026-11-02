const path = require("path");
const { DefinePlugin } = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");

const isProd = process.env.NODE_ENV === "production";
const clientDistDir = process.env.CLIENT_DIST_DIR ?
  path.resolve(process.env.CLIENT_DIST_DIR) :
  path.resolve(__dirname, "../dist/client");

module.exports = {
  entry: path.resolve(__dirname, "src/index.js"),
  mode: isProd ? "production" : "development",
  output: {
    path: path.join(clientDistDir, "assets"),
    filename: "bundle.js",
    clean: true
  },
  plugins: [
    new DefinePlugin({
      VERSION: JSON.stringify(
        require("./package.json").version + (isProd ? "" : "-dev")
      )
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "public"),
          to: clientDistDir
        }
      ]
    })
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /(node_modules|bower_components)/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"]
          }
        }
      }
    ]
  }
};
