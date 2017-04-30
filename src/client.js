'use strict';
const JSONE = require('./jsone');

// 30 seconds hook timeout
const HOOK_TIMEOUT = 30 * 1000;
const UID_KEY = Symbol('uid');
const TYPE_KEY = Symbol('type');
const Ξ = Symbol('private');

const ACTIONS = {
    list: 'list',
    call: 'call',
    get: 'get',
    set: 'set'
};

const url = '/';

const OK_STATUSES = [200];
const DEFAULT_BODY_PARSER = JSON.parse.bind(JSON);

let isOkStatus = status => OK_STATUSES.indexOf(status) > -1;
let processResponse = (resolve, reject, body, statusCode, statusMessage, bodyParser = DEFAULT_BODY_PARSER) => {

    let response = body;

    if (isOkStatus(statusCode)) {
        try {
            Promise.resolve(bodyParser(body))
                .then(resolve)
                .catch(reject);
        } catch (parsingError) {
            reject(parsingError);
        }

    } else {
        let errorResponse = {
            statusCode,
            statusMessage,
            response
        };
        reject(errorResponse);
    }
};

/**
 * Simple function handler class
 */
class FunctionHandler {

    constructor(handlerFunction) {

        if (typeof handlerFunction == 'function') {
            let id = getUid();

            this.call = function(...args) {

                try {
                    var result = handlerFunction(...args);
                } catch (error) {
                    return Promise.reject(error);
                }

                return Promise.resolve(result);
            };

            Object.defineProperties(this, {
                id: {
                    get: () => id
                }
            });

        } else {
            throw new TypeError('FunctionHandler constructor parameter is not a function!');
        }
    }

    static stringify(instance) {

        return `{"id":"${instance.id}"}`;
    }
}

/**
 * Simple wrapper class
 * @param {string} typeName
 * @param {string} typeHash
 */
let Wrapper = function(typeName, typeHash) {

    Object.defineProperties(this, {
        [TYPE_KEY]: {
            get: () => ({ typeName, typeHash })
        }
    });
};

function getUid(as32BitNumber) {

    const timePart = (new Date()).getTime();
    const rand = Math.random();

    if (as32BitNumber) {
        const randomPart = (rand * MAX_UINT32) | 0;
        return timePart ^ randomPart;
    } else {
        const randomPart = (rand * 1e9) | 0;
        const modPart = randomPart % 15;
        return timePart.toString(16) + randomPart.toString(16) + modPart.toString(16);
    }
}

function _w(instance) {

    if (instance instanceof Wrapper) {
        return instance;
    }

    throw Error('Not a Wrapper instance');
}

// some statics
Wrapper.isWrapper = function(instance) { return instance instanceof Wrapper; };
Wrapper.getTypeInfo = function(instance) { return _w(instance)[TYPE_KEY]; };
Wrapper.getUid = function(instance) { return _w(instance)[UID_KEY]; };
Wrapper.equals = function(a, b) { return _w(a)[UID_KEY] == _w(b)[UID_KEY]; };
Wrapper.stringify = function(instance) {

    let wrapper = _w(instance);
    return `{"uid":${wrapper[UID_KEY]},"typeHash":${wrapper[TYPE_KEY].typeHash}}`;
};

function createWrapperClass(descriptor, typeName, typeHash, shovel) {

    function getProperty(ctx, name) { return shovel(ctx[UID_KEY], ACTIONS.get, name); };
    function setProperty(ctx, name, value) { return shovel(ctx[UID_KEY], ACTIONS.set, name, value); };
    function callFunction(ctx, name, ...args) { return shovel(ctx[UID_KEY], ACTIONS.call, name, args); }

    // this cheap trick is for the name of the constructor function
    const wrapperClassName = typeName + 'Wrapper';
    let dummy = {
        [wrapperClassName]: function(uid) { this[UID_KEY] = uid; }
    };

    let classConstructor = dummy[wrapperClassName];

    let proto = new Wrapper(typeName, typeHash);

    for (var key in descriptor) {
        let { type, parameters } = descriptor[key];

        if (type == 'function') {
            let joinedPars = parameters.join();
            let pars = joinedPars.length != '' ? ',' + joinedPars : '';
            let body = `(function(${joinedPars}) { return callFunction(this,'${key}'${pars}); })`;
            // new Function() doesn't create closure
            let fn = eval(body);
            proto[`${key}`] = fn;
        } else {
            proto[`${key}`] = function(value) { return typeof value == 'undefined' ? getProperty(this, key) : setProperty(this, key, value); };
        }
    }

    classConstructor.prototype = proto;
    classConstructor.prototype.constructor = classConstructor;
    return classConstructor;
}

class ShovelClient {
    constructor({ serviceHost = 'localhost', servicePort = '31415', request, getSessionId }) {

        request = request.bind(null, processResponse);
        // clientId, <-client identifier

        const boundShovel = this.shovel.bind(this);
        const that = this;
        // typeHash:[WrapperClass].constructor
        const wrappers = new Map();
        // uid:[WrapperClass]
        const instances = new Map();
        // id:[FunctionHandler]
        const fnHandlers = new Map();
        const fn2Handlers = new WeakMap();

        // handlers for unknown types (Wrapper type)
        const jsonHandlers = {
            FunctionHandler: {
                name: 'FunctionHandler',
                ctor: FunctionHandler.prototype.constructor,
                stringify: FunctionHandler.stringify,
                parse: ({ id, args, responseId }) => {

                    // responseId - usefull for the response of the handler (if it will be sent to server)
                    const handler = handlers.get(id);
                    if (handler) {
                        // TODO: vraci promise, takze bych teoreticky jeste mohl reagovat a poslat odpoved na server
                        handler.call(args);
                    } else {
                        // TODO:
                        // !! pridat handler do metadat oznaceny k odregistrovani na serveru
                    }
                    return handler;
                }
            },
            Wrapper: {
                name: 'Wrapper',
                ctor: Wrapper,
                stringify: Wrapper.stringify,
                parse: ({ uid, typeHash }) => {

                    let instance = instances.get(uid);
                    if (instance) {
                        return instance;
                    }

                    const wrapperClass = wrappers.get(typeHash);
                    if (wrapperClass) {
                        return this[Ξ].addInstance(uid, wrapperClass.wrapper);
                    }

                    // TODO: better
                    return null;
                }
            }
        };

        // start with empty promise and hook timeout timer
        let hookPromise = null;
        let hookTimer = null;

        const jsone = new JSONE({ handlers: jsonHandlers });
        const bodyParser = jsone.decode.bind(jsone);
        // private stuff
        this[Ξ] = {
            JSONE: jsone,
            wrappers,
            instances,
            fnHandlers,
            fn2Handlers,
            addWrapperClass: function(descriptor, typeName, typeHash) {

                let wrapper = wrappers.get(typeHash);
                if (!wrapper) {
                    wrapper = createWrapperClass(descriptor, typeName, typeHash, boundShovel);
                    wrappers.set(typeHash, {
                        wrapper,
                        descriptor,
                        typeName
                    });
                }
                return wrapper;
            }.bind(that),
            getWrapperClass: function(typeHash) { return wrappers.get(typeHash); }.bind(that),
            addInstance: function(uid, WrapperClass) {

                let instance = instances.get(uid);
                if (!instance) {
                    instance = new WrapperClass(uid);
                    instances.set(uid, instance);
                }
                return instance;
            }.bind(that),
            foreverHook: function() {

                console.log(`--== Forever hook start new cycle ==--`);

                // clear the timer
                clearTimeout(hookTimer);
                hookTimer = null;
                // if there is pending request, cancel it
                if (hookPromise) {
                    hookPromise.abort()
                        .then(() => {

                            this[Ξ].foreverHook();
                        })
                        .catch(() => {

                            this[Ξ].foreverHook();
                        });
                    // hookPromise = null;
                }

                // needed this direct promise, to be able call abort
                hookPromise = this.request({ method: 'POST', path: url + 'foreverhook', bodyParser }, {});
                hookPromise
                    .then(data => {

                        // fullfilled, so clear it
                        hookPromise = null;

                        console.log('!W! - data:', data);

                        // keep the cycle alive
                        this[Ξ].foreverHook();
                    }, error => {

                        if (hookPromise.aborted) {

                            this[Ξ].foreverHook();
                        } else {

                            // TODO: better
                            console.log('Forever hook error:', error);
                        }

                        // fullfilled with error, so clear it
                        hookPromise = null;
                    });

                // set the timeout
                hookTimer = setTimeout(() => {

                    // restarts the loop
                    this[Ξ].foreverHook();
                }, HOOK_TIMEOUT);

            }.bind(that)
        };

        this.getServiceInfo = () => ({ serviceHost, servicePort });
        this.request = function(serviceHost, servicePort, options = {}, data) {

            options.host = serviceHost;
            options.port = servicePort;

            const headers = {
                'x-shovel-session': getSessionId()
            };

            return request(options, data, headers);
        }.bind(this, serviceHost, servicePort);

    }

    /**
     * @param  {function} handlerFunction
     * @return {FunctionHandler}
     */
    registerHandler(handlerFunction) {

        // TODO: make hash out of handlerFunction (or have WeakMap where key is this function)
        // to be able determine, if duplicities are going on
        if (typeof handlerFunction != 'function') {
            throw new TypeError(`Trying to register ${typeof handlerFunction} instead of function!`);
        }

        let handler = this[Ξ].fn2Handlers.get(handlerFunction);

        if (handler) {
            return handler;
        }

        handler = new FunctionHandler(handlerFunction);
        this[Ξ].fnHandlers.set(handler.id, handler);
        this[Ξ].fn2Handlers.set(handlerFunction, handler);
        return handler;
    }

    /**
     * Returns handler or undefined
     * @param  {string|function} handler - could be 'id' of handler as string
     * or function (which was used for registering the handler)
     * @return {?FunctionHandler}         [description]
     */
    getHandler(handler) {

        return this[Ξ].fnHandlers.get(handler) || this[Ξ].fn2Handlers.get(handler);
    }

    /**
     * [unregisterHandler description]
     * @param  {function|string|FunctionHandler} handler
     * @return {boolean} returns true, if handler was unregitered. false, if there was nothing to unregister
     */
    unregisterHandler(handler) {

        switch (typeof handler) {

            case 'function':
                // TODO: !!!
                throw new Error('Not implemented yet!');
                break;

            case 'string':
                // noop, already 'id' ..we hope!
                break;

            case 'object':

                if (handler instanceof FunctionHandler) {
                    handler = handler.id;
                } else {
                    throw new TypeError(`Trying to unregister handler, using invalid handler identifier!`);
                }
                break;

            default:
                throw new TypeError(`Trying to unregister handler, using invalid handler identifier!`);
                break;
        }

        return this[Ξ].fnHandlers.delete(handler);
    }

    initialize() {

        this[Ξ].foreverHook();
        return this.list(true).then(() => this);
    }

    get(uid) {

        return this[Ξ].instances.get(uid);
    }

    list(forceRequest = false) {

        if (forceRequest) {
            let postData = { action: ACTIONS.list };

            return this.request({ method: 'POST', path: url }, postData)
                .then(data => {

                    let list = [];
                    for (let typeHash in data) {
                        let { descriptor, typeName, instances } = data[typeHash];
                        let WrapperClass = this[Ξ].addWrapperClass(descriptor, typeName, Number(typeHash));

                        instances.forEach(uid => {

                            this[Ξ].addInstance(uid, WrapperClass);
                        });

                        list.push({ typeName, instances });
                    }

                    return list;
                });
        } else {
            let types = new Map();
            this[Ξ].instances.forEach((instance, uid) => {

                let { typeName, typeHash } = instance[TYPE_KEY];
                let typeInfo = types.get(typeHash) || {
                    typeName,
                    instances: []
                };

                typeInfo.instances.push(uid);
                types.set(typeHash, typeInfo);

            });

            return Array.from(types.values());
        }
    }

    /**
     * shovels the data to server, process response and returns appropriate response
     * @param  {string} uid
     * @param  {string} action
     * @param  {string} name
     * @param  {Array<string>} args
     * @return {Promise}
     */
    shovel(uid, action, name, args) {

        const jsone = this[Ξ].JSONE;
        // TODO: encode args(data) to store types etc..
        const bodyParser = jsone.decode.bind(jsone);

        let postData = {
            action,
            path: uid,
            field: name,
            data: args
            // TODO: in the future, generate UUID for the request
        };

        return this.request({ method: 'POST', path: url, bodyParser }, jsone.encode(postData))
            .then(([metadata, data]) => {

                // TODO: decode data! and much more (like raise Shovel event, log etc)
                return data[uid].data;
            })
            .catch(error => {

                // TODO: log error, raise Shovel event etc..
                return Promise.reject(error);
            });
    }

    static get Wrapper() {

        return Wrapper;
    }

    static create(request, getSessionId, { serviceHost, servicePort } = {}, fetchList = true) {

        let client = new ShovelClient({ serviceHost, servicePort, request, getSessionId });
        return fetchList ? client.initialize() : client;
    }

    static generateSessionId() {

        return getUid();
    }
}

module.exports = ShovelClient;
