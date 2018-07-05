'use strict';
// modules
const JSONE = require('./jsone');
const Net = require('./client_net');

// symbols
const UID_KEY = Symbol('uid');
const TYPE_KEY = Symbol('type');

// constants
const ACTIONS = Object.freeze({
    list: 'list',
    call: 'call',
    get: 'get',
    set: 'set'
});
const URL = '/';

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
            const id = getUid();

            this.call = function(args) {

                try {
                    return Promise.resolve(handlerFunction(...args));
                } catch (error) {
                    return Promise.reject(error);
                }
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
const Wrapper = function(typeName, typeHash) {

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

    const wrapper = _w(instance);
    return `{"uid":${wrapper[UID_KEY]},"typeHash":${wrapper[TYPE_KEY].typeHash}}`;
};

function createWrapperClass(descriptor, typeName, typeHash, shovel) {

    function getProperty(ctx, name) { return shovel(ctx[UID_KEY], ACTIONS.get, name); };
    function setProperty(ctx, name, value) { return shovel(ctx[UID_KEY], ACTIONS.set, name, value); };
    function callFunction(ctx, name, ...args) { return shovel(ctx[UID_KEY], ACTIONS.call, name, args); }

    // this cheap trick is for the name of the constructor function
    const wrapperClassName = typeName + 'Wrapper';
    const dummy = {
        [wrapperClassName]: function(uid) { this[UID_KEY] = uid; }
    };

    const classConstructor = dummy[wrapperClassName];
    const proto = new Wrapper(typeName, typeHash);

    for (let key in descriptor) {
        const { type, parameters } = descriptor[key];

        if (type == 'function') {
            const joinedPars = parameters.join();
            const pars = joinedPars.length != '' ? ',' + joinedPars : '';
            const body = `(function(${joinedPars}) { return callFunction(this,'${key}'${pars}); })`;
            // new Function() doesn't create closure
            const fn = eval(body);
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
    constructor({
        serviceHost = 'localhost',
        servicePort = '31415',
        request,
        getSessionId,
        reverseHookEnabled = true
    }) {

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

        // create Extended JSON encoder/decoder
        const jsone = new JSONE({ handlers: jsonHandlers });
        const bodyParser = jsone.decode.bind(jsone);

        // create net comunication helper
        const net = new Net({
            requestFn: request,
            host: serviceHost,
            port: servicePort,
            sessionId: getSessionId(),
            bodyParser,
            buildMetadata,
            onHandlerData: onHandlerData.bind(this),
            reverseHookEnabled
        });

        // private stuff
        // =============
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
                    const { descriptor, typeName, instances } = data.metadata[typeHash];
                    const WrapperClass = addWrapperClass(descriptor, typeName, Number(typeHash));

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
         * Handles data for callbacks
         * @param  {Object} data
         */
        function onHandlerData(data) {
            if (Array.isArray(data)) {
                data.forEach(handlerData => {

                    const handler = this.getHandler(handlerData.id);
                    if (handler) {
                        // could return promise, which could be sent back to server...
                        const result = Promise.resolve(handler.call(handlerData.data));
                    } else {
                        // NOOP - just ignore
                    }
                });
            } else {
                // TODO: what? some kind of error..
            }
        };

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

            return net.request({ method: 'POST', path: URL }, jsone.encode(postData))
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

            // fetch the list from server & start forever hook
            return this.list(true).then(() => net.nextTickForeverHook() || this);
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

                return net.request({ method: 'POST', path: URL }, postData);
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

    static create(request, getSessionId, options = {}, fetchList = true) {

        options.request = request;
        options.getSessionId = getSessionId;

        let client = new ShovelClient(options);
        return fetchList ? client.initialize() : client;
    }

    static generateSessionId() {

        return getUid();
    }
}

module.exports = ShovelClient;
