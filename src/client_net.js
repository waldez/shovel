'use strict';

const WebSocket = require('isomorphic-ws');
const wsHelpers = require('./ws-helpers');
const MESSAGE_TYPE = wsHelpers.MESSAGE_TYPE;

function getOfType(value, type) {
    if (typeof value !== type) {
        throw new TypeError(`Value "${value}" should be of type ${type}, but is of type ${typeof value}!`);
    }
    return value;
}

class Net {

    constructor(options) {

        const {
            host,
            port,
            bodyParser,
            buildMetadata,
            onHandlerData
        } = getOfType(options, 'object');

        // assign with type control
        this.host = getOfType(host, 'string');
        this.port = getOfType(port, 'string');

        this.bodyParser = getOfType(bodyParser, 'function');
        this.buildMetadata = getOfType(buildMetadata, 'function');
        this.onHandlerData = getOfType(onHandlerData, 'function');

        const awaitingResponses = new Map();
        const concurentIds = new wsHelpers.ConcurentIds();
        const ws = new WebSocket('ws://' + host + ':' + port);
        ws.onmessage = event => {

            const { type, id, rawData } = wsHelpers.extractHeader(event.data);
            switch (type) {
                case MESSAGE_TYPE.REQUEST:
                    try {
                        const body = this.bodyParser(rawData);
                        this.onHandlerData(body);
                    } catch (parsingError) {
                        // TODO:
                        /*who knows?*/
                    }
                    return;

                case MESSAGE_TYPE.RESPONSE:
                    awaitingResponses.get(id)(rawData, 200, null);
                    return;

                case MESSAGE_TYPE.ERROR:
                    awaitingResponses.get(id)(rawData, 500, 'Error vole!');
                    return;
            }
        };

        this.readyPromise = new Promise((resolveReady, rejectReady) => {

            ws.onopen = event => {

                this.stop = () => ws.close(1000, 'OK - Shovel client "stop" was called.');

                this.request = (data) => {

                    return new Promise((resolve, reject) => {

                        const requestId = concurentIds.popId();
                        const requestData = wsHelpers.insertHeader(data, MESSAGE_TYPE.REQUEST, requestId);
                        awaitingResponses.set(requestId, (body, statusCode, statusMessage) => {
                            // cleanup
                            awaitingResponses.delete(requestId);
                            concurentIds.pushId(requestId);
                            // process the response
                            return this.processResponse(resolve, reject, body, 200, null);
                        });
                        ws.send(requestData);
                    });
                };

                resolveReady(this);
            };
        });
    }

    /**
     * Returns promise, which will resolve with this when connection is established
     * @return {Promise<Net>}
     */
    get ready() { return this.readyPromise; }

    processResponse(resolve, reject, body, statusCode, statusMessage) {

        const response = body;
        if (statusCode === 200) {
            try {
                Promise.resolve(this.bodyParser(body))
                    .then(resolve)
                    .catch(reject);
            } catch (parsingError) {
                reject(parsingError);
            }

        } else {
            const errorResponse = {
                statusCode,
                statusMessage,
                response
            };
            reject(errorResponse);
        }
    }
}

module.exports = Net;
