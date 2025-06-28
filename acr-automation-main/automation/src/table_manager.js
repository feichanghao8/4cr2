const TableState = require("./table_state.js");

/**
 * Manages a collection of table states associated with socket IDs.
 *
 * Although TableManager and TableController can be considered to be tightly coupled, they
 * are separated as TableManager's responsibility is solely to manage the state of each table.
 *
 * TableController is responsible for the higher-level network events.
 */
class TableManager {
    constructor() {
        this.tables = new Map();
    }

    /**
     * Adds a new table state associated with a given socket ID and table ID.
     *
     * @param {string} socketId - The unique identifier for the socket.
     * @param {string} tableId - The unique identifier for the table.
     * @param {string} externalId - Hero's unique identifier.
     * @return {TableState} The newly created table state instance.
     */
    addTable(socketId, tableId, externalId) {
        const state = new TableState(socketId, tableId, externalId);
        this.tables.set(socketId, state)
        return state;
    }

    /**
     * Removes a table associated with the given socket ID.
     *
     * @param {string} socketId - The unique identifier of the socket associated with the table to be removed.
     * @return {boolean} Returns true if the table was successfully removed, otherwise false.
     */
    removeTable(socketId) {
        const table = this.get(socketId);
        if (table) {
            if (table.ai) {
                table.ai.disconnect();
            }

            return this.tables.delete(socketId);
        }

        return false;
    }

    /**
     * Retrieves the value associated with the provided socketId from the tables map.
     *
     * @param {string} socketId The unique identifier for the socket used to retrieve the associated value.
     * @return {*} The value associated with the provided socketId, or null if none exists.
     */
    get(socketId) {
        return this.tables.get(socketId) || null;
    }
}

module.exports = new TableManager();
