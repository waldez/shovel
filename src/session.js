'use strict'

class Session {

    constructor(sessionId) {

        this.foreverHook = null;
        this.functionHandlers = new Map();
        this.outbox = [];
        this.scheduledOutboxFlush = false;

        Object.defineProperties(this, {
            id: {
                get: () => sessionId
            }
        });
    }

    setForeverHook(resolve, reject) {

        // TODO: here I can set timestamp, which can be used to check, if the session is alive

        this.foreverHook = {
            resolve,
            reject
        };

        if (this.scheduledOutboxFlush) {
            this.tryFlushOutbox();
        }
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

    tryFlushOutbox() {

        if (this.outbox.length > 0 && this.foreverHook) {
            this.scheduledOutboxFlush = false;
            // FLUSH IT!
            let data = this.outbox;
            this.outbox = [];
            this.resolveForeverHook(data);
        } else {
            // noop, we wait for another forever hook..
        }
    }

    consumeHandlerResult(id, data) {

        this.outbox.push({ id, data });
        if (!this.scheduledOutboxFlush) {
            this.scheduledOutboxFlush = true;
            // give the engine some time to aggregate more data (maybe)
            process.nextTick(this.tryFlushOutbox.bind(this));
        }
    }
}

module.exports = Session;
