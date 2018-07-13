'use strict'
const EventEmitter = require('events');
const WebSocket = require('ws');
const uuidV1 = require('uuid/v1');
const wsHelpers = require('./ws-helpers');
const MESSAGE_TYPE = wsHelpers.MESSAGE_TYPE;
const PRIVATE = Symbol('private');

class ClientConnection {

    constructor(ws) {

        this.ws = ws;
        this[PRIVATE] = uuidV1();
        this.concurentIds = new wsHelpers.ConcurentIds();
    }

    get id() { return this[PRIVATE]; }

    sendRequest(data) {

        return this.ws.send(wsHelpers.insertHeader(data, MESSAGE_TYPE.REQUEST, this.concurentIds.popId()));
    }

    sendResponse(data, requestId) {

        this.concurentIds.pushId(requestId);
        return this.ws.send(wsHelpers.insertHeader(data, MESSAGE_TYPE.RESPONSE, requestId));
    }

    sendError(data, requestId) {

        this.concurentIds.pushId(requestId);
        return this.ws.send(wsHelpers.insertHeader(data, MESSAGE_TYPE.ERROR, requestId));
    }

}

class Server extends EventEmitter {

    constructor(port,
        {
            clientSourcePromise,
            clientSourceMinPromise,
            incomingMessageHandler,
            verbose = false,
            server = null
        }) {

        super();
        this.verbose = verbose;
        this.connections = new Map();
        this.port = port;
        this.incomingMessageHandler = incomingMessageHandler;
        this.server = server || require('http').createServer();
        const wss = this.wss = new WebSocket.Server({ server: this.server });

        wss.on('connection', ws => {

            // TODO!!!!!!
            // + pushId() for function handler requestu!

            const connection = new ClientConnection(ws);
            this.connections.set(connection.id, connection);

            ws.on('close', (code, reason) => {
                this.log(`Connection ${connection.id} has been closed! reason: ${reason}`);
                this.connections.delete(connection.id);
                this.emit('endSession', connection.id);
            });

            ws.on('message', message => {

                const { type, id, rawData } = wsHelpers.extractHeader(message);
                switch (type) {
                    case MESSAGE_TYPE.REQUEST:
                        incomingMessageHandler(rawData, connection.id, id)
                            .then(responseData => {
                                responseData = typeof responseData == 'string' ? responseData : JSON.stringify(responseData);
                                connection.sendResponse(responseData, id);
                            })
                            .catch(error => {
                                this.log('[requestListener]', id, error);
                                if (error instanceof Error) {
                                    error = error.stack;
                                }

                                connection.sendError(JSON.stringify(error), id);
                            });
                        return;

                    case MESSAGE_TYPE.RESPONSE:
                        return;

                    case MESSAGE_TYPE.ERROR:
                        return;
                }
            });

            // emit start session event
            this.emit('startSession', connection.id);
        });
    }

    log(...args) {

        if (this.verbose) {
            console.log(new Date() + ':', ...args);
        }
    }

    start() {

        this.server.listen(this.port);
        this.log('Server started - listenning at port:', this.port);
    }

    close(callback) {

        this.server.close(callback);
    }

    sendMessage(sessionId, data) {

        // TODO:
    }

    sendHandlerRequest(sessionId, data) {

        const connection = this.connections.get(sessionId);
        if (connection) {
            // TODO: remove brackets hack
            connection.sendRequest('[' + data + ']');
            return;
        }
    }
}

module.exports = Server;
