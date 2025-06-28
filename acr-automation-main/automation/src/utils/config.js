const path = require("path");

// Compute the path to the folder containing 'config.json'.
const LOG_FOLDER_PATH = path.resolve(process.cwd(), "config.json");

module.exports = require(LOG_FOLDER_PATH);
