const { createLogger, format, transports } = require("winston");
const path = require("path");

// Compute the path to the folder containing 'index.js'.
const LOG_FOLDER_PATH = path.resolve(process.cwd(), "logs-traffic");

// Create a log filename with a timestamp, e.g., `logs-traffic-2023-11-01-12-00-00.log`
const LOG_FILE_NAME = `logs-traffic-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
const LOG_FILE_PATH = path.join(LOG_FOLDER_PATH, LOG_FILE_NAME);

const logger = createLogger({
    level: "debug",
    format: format.combine(
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.printf(({ level, message, timestamp, loggerName }) => {
            const name = loggerName ? `${loggerName}` : "";
            return `${timestamp} ${name} ${level.toUpperCase()}  ${message}`;
        })
    ),
    transports: [
        new transports.File({
            filename: LOG_FILE_PATH,
            format: format.combine(
                format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
                format.printf(({ level, message, timestamp, loggerName }) => {
                    const name = loggerName ? `[${loggerName}]` : "";
                    return `${timestamp} ${level.toUpperCase()} ${name}: ${message}`;
                })
            )
        })
    ]
});

// Helper function to create custom named loggers.
function getLogger(name) {
    return logger.child({ loggerName: name });
}

module.exports = getLogger;
