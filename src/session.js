'use strict'

class Session {

    constructor(sessionId) {

        this.foreverHook = null;
        this.functionHandlers = new Map();

        Object.defineProperties(this, {
            id: {
                get: () => sessionId
            }
        });
    }

    setForeverHook(reject, resolve) {

        this.foreverHook = {
            reject,
            resolve
        };
    }

    resolveForeverHook(data) {

        if (this.foreverHook) {
            this.foreverHook.resolve(data);
            this.foreverHook = null;
        }
    }

    rejectForeverHook(data) {

        if (this.foreverHook) {
            this.foreverHook.reject(data);
            this.foreverHook = null;
        }
    }

    getFnHandler(id) {

        return this.functionHandlers.get(id);
    }

    setFnHandler(handler) {

        return this.functionHandlers.set(handler.id, handler);
    }

    callFnHandler(id, args) {

    }
}

module.exports = Session;
