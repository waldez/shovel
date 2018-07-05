'use strict';

// 25 seconds hook timeout
const HOOK_TIMEOUT = 25 * 1000;
const OK_STATUSES = [200];
const URL = '/';
const isOkStatus = status => OK_STATUSES.indexOf(status) > -1;

function getOfType(value, type) {
    if (typeof value !== type) {
        throw new TypeError(`Value "${value}" should be of type ${type}, but is of type ${typeof value}!`);
    }
    return value;
}

class Net {

    constructor(options) {

        const {
            requestFn,
            host,
            port,
            sessionId,
            bodyParser,
            buildMetadata,
            onHandlerData,
            reverseHookEnabled = true
        } = getOfType(options, 'object');

        this.hookTimer = undefined;
        this.hookPromise = undefined;

        // assign with type control
        this.host = getOfType(host, 'string');
        this.port = getOfType(port, 'string');
        this.sessionId = getOfType(sessionId, 'string');
        this.requestFn = getOfType(requestFn, 'function');
        this.bodyParser = getOfType(bodyParser, 'function');
        this.buildMetadata = getOfType(buildMetadata, 'function');
        this.onHandlerData = getOfType(onHandlerData, 'function');
        this.reverseHookEnabled = getOfType(reverseHookEnabled, 'boolean');
    }

    processResponse(resolve, reject, body, statusCode, statusMessage) {

        const response = body;
        if (isOkStatus(statusCode)) {
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

    request(options = {}, data) {

        options.host = this.host;
        options.port = this.port;
        options.bodyParser = this.bodyParser;

        const headers = {
            'x-shovel-session': this.sessionId
        };

        return this.requestFn(this.processResponse.bind(this), options, data, headers);
    }

    foreverHook() {

        // clear the timer
        clearTimeout(this.hookTimer);
        this.hookTimer = null;

        // needed this direct promise, to be able call abort
        this.hookPromise = this.request({ method: 'POST', path: URL + 'foreverhook' }, [this.buildMetadata()]);
        this.hookPromise
            .then(data => {
                if (this.hookPromise) {
                    // fullfilled, so clear it
                    this.hookPromise = null;
                    // call the external "event handler"
                    this.onHandlerData(data);
                }
                // keep the cycle alive
                this.nextTickForeverHook();
            }, error => {

                // TODO: FIX!!
                // jakmile to vytimeoutuje, tak je to zruseno na clientovi, coz znamena,
                // ze server ma neplatne spojeni (tudiz ta promisa ve scopu je k nicemu)
                // OSETRIT!! pred odeslanim zjistit, jestli je to spojeni jeste cerstvy!!!
                // estli ne, tak pockat na dalsi forever hook
                // (toto je asi duvod, proc mi to obcas neodesilalo ze serveru)

                if (error.code === 'ECONNRESET' ||
                    error.response === '"aborted"' ||
                    error.statusCode == 0) {
                    // NOOP - this is expected
                } else {
                    console.log('Error occured on forever hook:\n', error);
                }

                // fullfilled with error, so clear it
                this.hookPromise = null;
            });

        // set the timeout
        this.hookTimer = setTimeout(this.abortForeverHook.bind(this), HOOK_TIMEOUT);
    }

    abortForeverHook() {

        this.hookTimer = null;
        // if there is pending request, cancel it
        if (this.hookPromise) {
            this.hookPromise.abort();
            this.hookPromise = null;

        }
        // restart the loop
        this.nextTickForeverHook();
    }

    // we don't want to bleed out of stack, do we?
    nextTickForeverHook() {

        if (this.reverseHookEnabled) {
            setTimeout(this.foreverHook.bind(this), 0);
        }
    }
}

module.exports = Net;
