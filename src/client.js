'use strict';
const JSONE = require('./jsone');

// 25 seconds hook timeout
const HOOK_TIMEOUT = 25 * 1000;
const UID_KEY = Symbol('uid');
const TYPE_KEY = Symbol('type');

const ACTIONS = Object.freeze({
    list: 'list',
    call: 'call',
    get: 'get',
    set: 'set'
});

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

function getUid() {

    const timePart = (new Date()).getTime();
    const randomPart = (Math.random() * 1e9) | 0;
    const modPart = randomPart % 15;
    return timePart.toString(16) + randomPart.toString(16) + modPart.toString(16);
}

/**
 * Simple function handler class
 */
class FunctionHandler {

    constructor(handlerFunction) {

        if (typeof handlerFunction == 'function') {
            let id = getUid();

            this.call = function(args) {

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

        const boundShovel = shovel.bind(this);
        // name:uid
        const globalNames = new Map();
        // typeHash:[WrapperClass].constructor
        const wrappers = new Map();
        // uid:[WrapperClass]
        const instances = new Map();
        // id:[FunctionHandler]
        const fnHandlers = new Map();
        const fn2Handlers = new WeakMap();
        // data id & global data uuid
        let dataUuid = 0;
        let globalDataUuid = 0;

        // handlers for unknown types (Wrapper type)
        const jsonHandlers = {
            Metadata: {
                name: 'Metadata',
                ctor: Metadata.prototype.constructor,
                parse: (data) => {

                    return Metadata(data);
                }
            },
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
                        return addInstance(uid, wrapperClass.wrapper);
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
        // =============

        function boundRequest(options = {}, data) {

            options.host = serviceHost;
            options.port = servicePort;
            options.bodyParser = bodyParser;

            const headers = {
                'x-shovel-session': getSessionId()
            };

            return request(processResponse, options, data, headers);
        };

        function addWrapperClass(descriptor, typeName, typeHash) {

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
        }

        function getWrapperClass(typeHash) {
            return wrappers.get(typeHash);
        }

        function addInstance(uid, WrapperClass) {

            let instance = instances.get(uid);
            if (!instance) {
                instance = new WrapperClass(uid);
                instances.set(uid, instance);
            }
            return instance;
        }

        const foreverHook = () => {

            // clear the timer
            clearTimeout(hookTimer);
            hookTimer = null;

            // needed this direct promise, to be able call abort
            hookPromise = boundRequest({ method: 'POST', path: url + 'foreverhook' }, [buildMetadata()]);
            hookPromise
                .then(data => {

                    if (hookPromise) {
                        // fullfilled, so clear it
                        hookPromise = null;

                        if (Array.isArray(data)) {
                            data.forEach(handlerData => {

                                let handler = this.getHandler(handlerData.id);
                                if (handler) {
                                    // could return promise, which could be sent back to server...
                                    let result = Promise.resolve(handler.call(handlerData.data));
                                } else {
                                    // NOOP - just ignore
                                }
                            });
                        } else {
                            // TODO: what? some kind of error..
                        }
                    }

                    // keep the cycle alive
                    nextTickForeverHook();
                }, error => {

                    if (error.code === 'ECONNRESET' || error.response === '"aborted"' ) {
                        // NOOP - this is expected
                    } else {
                        console.log('Error occured on forever hook:\n', error);
                    }

                    // fullfilled with error, so clear it
                    hookPromise = null;
                });

            // set the timeout
            hookTimer = setTimeout(abortForeverHook, HOOK_TIMEOUT);
        };

        function abortForeverHook() {

            hookTimer = null;
            // if there is pending request, cancel it
            if (hookPromise) {
                hookPromise.abort();
                hookPromise = null;

            }
            // restart the loop
            nextTickForeverHook();
        }

        // we don't want to bleed out of stack, do we?
        function nextTickForeverHook() {

            setTimeout(foreverHook, 0);
        }

        function buildMetadata() {

            return {
                dataUuid,
                globalDataUuid
            };
        }

        // helper class for building metadata using JSONE
        function Metadata(data) {

            processMetadata(data);
        }

        function processMetadata(data, generateList) {

            const list = generateList ? [] : null;
            // do we have latest metadata? ..
            if (data.dataUuid != dataUuid || data.globalDataUuid != globalDataUuid) {
                // ..nope, process them
                for (let typeHash in data.metadata) {
                    let { descriptor, typeName, instances } = data.metadata[typeHash];
                    let WrapperClass = addWrapperClass(descriptor, typeName, Number(typeHash));

                    instances.forEach(uid => {

                        addInstance(uid, WrapperClass);
                    });

                    if (generateList) {
                        list.push({ typeName, instances });
                    }
                }

                // setup global names
                for (let name in data.globals) {
                    globalNames.set(name, data.globals[name]);
                }

                // update data uuids
                dataUuid = data.dataUuid;
                globalDataUuid = data.globalDataUuid;
            }

            return list;
        }

        /**
         * shovels the data to server, process response and returns appropriate response
         * @param  {string} uid
         * @param  {string} action
         * @param  {string} name
         * @param  {Array<string>} args
         * @return {Promise}
         */
        function shovel(uid, action, name, args) {

            let postData = [
                buildMetadata(),
                {
                    action,
                    path: uid,
                    field: name,
                    data: args
                    // TODO: in the future, generate UUID for the request
                }
            ];

            return boundRequest({ method: 'POST', path: url }, jsone.encode(postData))
                .then(([metadata, data]) => {
                    // TODO: decode data! and much more (like raise Shovel event, log etc)
                    return data[uid].data;
                })
                .catch(error => {

                    // TODO: log error, raise Shovel event etc..
                    return Promise.reject(error);
                });
        };

        // public stuff
        // ============

        this.getServiceInfo = () => ({ serviceHost, servicePort });

        /**
         * @param  {function} handlerFunction
         * @return {FunctionHandler}
         */
        this.registerHandler = (handlerFunction) => {

            // TODO: make hash out of handlerFunction (or have WeakMap where key is this function)
            // to be able determine, if duplicities are going on
            if (typeof handlerFunction != 'function') {
                throw new TypeError(`Trying to register ${typeof handlerFunction} instead of function!`);
            }

            let handler = fn2Handlers.get(handlerFunction);

            if (handler) {
                return handler;
            }

            handler = new FunctionHandler(handlerFunction);
            fnHandlers.set(handler.id, handler);
            fn2Handlers.set(handlerFunction, handler);
            return handler;
        };

        /**
         * Returns handler or undefined
         * @param  {string|function} handler - could be 'id' of handler as string
         * or function (which was used for registering the handler)
         * @return {?FunctionHandler}         [description]
         */
        this.getHandler = (handler) => {

            return fnHandlers.get(handler) || fn2Handlers.get(handler);
        };

        /**
         * @param  {function|string|FunctionHandler} handler
         * @return {boolean} returns true, if handler was unregitered. false, if there was nothing to unregister
         */
        this.unregisterHandler = (handler) => {

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

            return fnHandlers.delete(handler);
        };

        this.initialize = () => {

            foreverHook();
            return this.list(true).then(() => this);
        };

        this.get = (uid) => {

            const key = typeof uid == 'number' ? uid : globalNames.get(uid);
            return instances.get(key);
        };

        this.list = (forceRequest = false) => {

            if (forceRequest) {
                let postData = [
                    buildMetadata(),
                    { action: ACTIONS.list }
                ];

                return boundRequest({ method: 'POST', path: url }, postData);
            } else {
                let types = new Map();
                instances.forEach((instance, uid) => {

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
        };
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
