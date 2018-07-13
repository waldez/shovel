'use strict'

const DELIMITER = 'λ';
const MESSAGE_TYPE = Object.freeze({
    REQUEST: 'q',
    RESPONSE: 's',
    ERROR: 'e'
});

class ConcurentIds {

    constructor() {

        this.used = new Set();
        this.next = 0;
    }

    popId() {

        const id = this.next;
        this.used.add(id);
        while (this.used.has(++this.next)) {/*NOP*/}
        return id;
    }

    pushId(id) {

        this.next = this.next > id ? id : this.next;
        this.used.delete(id);
    }
}

module.exports = {

    // TODO: better!
    extractHeader(message) {

        const [header, rawData] = message.split(DELIMITER, 2);
        return {
            type: header[header.length - 1],
            id: parseInt(header),
            rawData
        };
    },

    insertHeader(message, type, id) {

        return id + type + DELIMITER + message;
    },

    ConcurentIds,
    MESSAGE_TYPE
};
