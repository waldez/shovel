'use strict'
const Url = require('url');
const http = require('http');
const EventEmitter = require('events');
const ForeverHook = require('./forever_hook');

const RESPONSE_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With, x-shovel-session'
};

function buildHeaders(sessionId) {

    return sessionId ? Object.assign({ 'x-shovel-session': sessionId }, RESPONSE_HEADERS) : RESPONSE_HEADERS;
}

class Server extends EventEmitter {

    constructor(port, { clientSourcePromise, clientSourceMinPromise, Promise, incomingMessageHandler }) {

        super();
        this.fHooks = new Map();
        this.port = port;
        this.incomingMessageHandler = incomingMessageHandler;
        this.router = {
            // define routes
            'OPTIONS': (requestData, request) => Promise.resolve(200),
            'GET': {
                '/shovel.js': () => clientSourcePromise,
                '/shovel.min.js': () => clientSourceMinPromise
                // not supported for now
            },
            'POST': {
                // '/': this.processRequest.bind(this),
                '/': incomingMessageHandler,
                '/foreverhook': this.processForeverHook.bind(this)
            }
        };

        this.server = http.createServer(this.requestListener.bind(this));
    }

    start() {

        this.server.listen(this.port);
    }

    close(callback) {

        this.server.close(callback);
    }

    sendMessage(sessionId, data) {

        // TODO:
    }

    sendResponse(sessionId, data) {

        const fHook = this.fHooks.get(sessionId);
        if (!fHook) {
            throw new Error('Forever hook not found for session ' + sessionId);
        }

        fHook.outbox.push(data);
        if (!fHook.scheduledOutboxFlush) {
            fHook.scheduledOutboxFlush = true;
            // give the engine some time to aggregate more data (maybe)
            process.nextTick(fHook.tryFlushOutbox.bind(fHook));
        }
    }

    processForeverHook(rawData, sessionId) {

        if (!sessionId) {
            throw new Error('Parameter sessionId missing');
        }

        let fHook;
        // TODO: is this right place??
        if (!(fHook = this.fHooks.get(sessionId))) {
            this.fHooks.set(sessionId, fHook = new ForeverHook(sessionId));
        }

        return new Promise((resolve, reject) => {

            // TODO: FIX!!
            // jakmile to vytimeoutuje, tak je to zruseno na clientovi, coz znamena,
            // ze server ma neplatne spojeni (tudiz ta promisa ve scopu je k nicemu)
            // OSETRIT!! pred odeslanim zjistit, jestli je to spojeni jeste cerstvy!!!
            // estli ne, tak pockat na dalsi forever hook
            // (toto je asi duvod, proc mi to obcas neodesilalo ze serveru)
            if (fHook.foreverHook) {
                fHook.rejectForeverHook('aborted');
            }

            fHook.setForeverHook(data => resolve(data), reject);
        });
    }

    preprocessRequest(request) {

        const sessionId = request.headers['x-shovel-session'];
        request.on('aborted', () => {
            if (request.url == '/foreverhook') {
                const fHook = this.fHooks.get(sessionId);
                fHook && fHook.rejectForeverHook('aborted');
            }
        });

        const methodHandler = this.router[request.method];
        if (!methodHandler) {
            return { code: 400, error: `Method '${request.method}' not supported.` };
        }

        const url = Url.parse(request.url);
        const route = typeof methodHandler == 'function' ? methodHandler : methodHandler[url.pathname];
        if (typeof route != 'function') {
            return { code: 400, error: `Endpoint '${url.pathname}' does not exist.` };
        }

        const { query, hash } = url.query || {};

        return {
            sessionId,
            route,
            query,
            hash
        };
    }

    requestListener(req, res) {

        // preprocess request
        let prereq = this.preprocessRequest(req);

        if (prereq.error) { // do we want to continue?

            res.writeHead(prereq.code, buildHeaders(prereq.sessionId));
            res.end(JSON.stringify({ error: { message: prereq.error } }));
            return;
        }

        // lets assume all the requests will be JSON with optional base64 encoding
        let body = [];
        req.on('data', chunk => {

            body.push(chunk);
        }).on('end', () => {

            let tmp;

            body = Buffer.concat(body).toString();
            // at this point, `body` has the entire request body stored in it as a string
            prereq.route(body, prereq.sessionId)
                .then(responseData => {

                    responseData = typeof responseData == 'string' ? responseData : JSON.stringify(responseData);
                    // TODO: remove
                    tmp = responseData;

                    res.writeHead(200, buildHeaders(prereq.sessionId));
                    res.end(Buffer.from(responseData));
                })
                .catch(error => {
                    if (error instanceof Error) {
                        error = error.stack;
                    }

                    res.writeHead(500, buildHeaders(prereq.sessionId)); // ?? do I want 500 all the time?
                    res.end(Buffer.from(JSON.stringify(error)));
                });
        });
    };
}

module.exports = Server;
