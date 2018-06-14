'use strict'

const ScopeContainer = require('./scope_container');

class Session {

    constructor(sessionId) {

        this.functionHandlers = new Map();
        const data = new ScopeContainer();

        Object.defineProperties(this, {
            id: {
                get: () => sessionId
            },
            data: {
                get: () => data
            }
        });
    }

    getFnHandler(id) {

        return this.functionHandlers.get(id);
    }

    setFnHandler(handler) {

        return this.functionHandlers.set(handler.id, handler);
    }
}

module.exports = Session;
