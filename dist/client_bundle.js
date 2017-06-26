var ShovelClient =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// identity function for calling harmony imports with the correct context
/******/ 	__webpack_require__.i = function(value) { return value; };
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, {
/******/ 				configurable: false,
/******/ 				enumerable: true,
/******/ 				get: getter
/******/ 			});
/******/ 		}
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = 1);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

const JSONE = __webpack_require__(2);

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

            if (reverseHookEnabled) {
                setTimeout(foreverHook, 0);
            }
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

            nextTickForeverHook();
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


/***/ }),
/* 1 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


const ShovelClient = __webpack_require__(0);

if (typeof window.sessionStorage != 'object') {
    throw new Error('Incompatible client for Shovel! Unsupported window.sessionStorage.');
}

const STORAGE_SESSION_KEY = 'shovelSessionId';

const getSessionId = () => {

    let sessionId = window.sessionStorage.getItem(STORAGE_SESSION_KEY);

    if (!sessionId) {
        sessionId = ShovelClient.generateSessionId();
        window.sessionStorage.setItem(STORAGE_SESSION_KEY, sessionId);
    }

    return sessionId;
};

const request = (processResponse, { method = 'POST', port, host, path = '/', bodyParser }, data, headers) => {

    let req;
    let promise = new Promise((resolve, reject) => {

        data = typeof data === 'object' ? JSON.stringify(data) : data;
        req = new XMLHttpRequest();

        req.error = (error) => {

            reject({
                state: req.readyState,
                status: req.status,
                response: req.responseText,
                error
            });
        };

        req.onreadystatechange = () => {

            if (req.readyState === XMLHttpRequest.DONE) {
                processResponse(resolve, reject, req.responseText, req.status, /*req.statusMessage*/ undefined, bodyParser);
            }
        };
        req.open(method, `http://${host}:${port}${path}`, true);

        if (typeof headers == 'object') {
            for (let headerName in headers) {
                if (headers.hasOwnProperty(headerName)) {
                    req.setRequestHeader(headerName, headers[headerName]);
                }
            }
        }
    });

    // enhance promise with request cancelation
    promise.abort = () => {

        promise.aborted = true;
        req.abort();
        return promise;
    };

    // finally, send the stuff
    req.send(data);

    return promise;
};

module.exports = ShovelClient.create.bind(null, request, getSessionId);


/***/ }),
/* 2 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


function isInheritable(type) { return type.ctor || (typeof type.instanceOf == 'function'); }
function getNullStr(value) { return 'null'; }
function stringifyExtended(type, body) {

    return `{"$$type":"${type}","$$data":${body}}`;
}

const DATA_TYPES = {
    Undefined: {
        name: 'Undefined',
        stringify: getNullStr
    },
    Boolean: { name: 'Boolean' },
    Number: { name: 'Number' },
    String: { name: 'String' },
    Object: {
        name: 'Object',
        stringify: objectStringify
    },
    // stringify it to null - for now
    Function: {
        name: 'Function',
        ctor: Function,
        stringify: getNullStr
    },
    Date: {
        name: 'Date',
        ctor: Date,
        stringify: instance => stringifyExtended('Date', `"${instance.toISOString()}"`),
        parse: data => new Date(data)
    },
    RegExp: {
        name: 'RegExp',
        ctor: RegExp,
        stringify: instance => stringifyExtended('RegExp', `["${instance.source}","${instance.flags}"]`),
        parse: ([pattern, flags]) => new RegExp(pattern, flags)
    },
    Error: { name: 'Error', ctor: Error },
    Array: { name: 'Array', ctor: Array, stringify: arrayStringify }
    // TODO: !!!
    // Buffer: { name: 'Buffer', ctor: Buffer } // TODO: !!! Typed Arrays?
    // Map (using mapToJson - probably)
    // Set
};

const INHERITABLES = Object.keys(DATA_TYPES).map(key => DATA_TYPES[key]).filter(isInheritable);

function getTypeFromName(name, dataTypes = DATA_TYPES) {

    return dataTypes[name];
}

function getType(value, userData, dataTypes = DATA_TYPES, inheritables = INHERITABLES) {

    const jstype = typeof value;

    if (value === null || jstype == 'undefined') {
        return dataTypes.Undefined;
    }

    if (jstype == 'object') {
        const proto = Object.getPrototypeOf(value);

        let found = dataTypes[proto.constructor.name];
        if (found && found.ctor && value instanceof found.ctor) {
            return found;
        }

        // return found or unknown generic object
        return inheritables.find(item => (item.instanceOf && item.instanceOf(value, userData)) || (item.ctor && value instanceof item.ctor))
            || dataTypes.Object;
    } else {
        return dataTypes[Object.getPrototypeOf(value).constructor.name];
    }
}

function arrayStringify(array, userData) {

    let delimiter = '';
    let body = '';
    for (let i = 0; i < array.length; i++) {
        const value = array[i];
        body += delimiter + stringify.call(this, value, userData);
        delimiter = ',';
    }

    return `[${body}]`;
}

function objectStringify(object, userData) {

    let delimiter = '';
    let body = '';
    for (let key in object) {
        if (object.hasOwnProperty(key)) {
            const value = object[key];
            if (typeof value == 'undefined') {
                continue;
            }
            body += delimiter + JSON.stringify(key) + ':' + stringify.call(this, value, userData);
            delimiter = ',';
        }
    }

    return `{${body}}`;
}

function decode(jsonString, userData) {

    return parse.call(this, jsonString, userData);
};

function encode(json, userData) {

    return stringify.call(this, json, userData);
};

function stringify(value, userData) {

    const type = getType(value, userData, this.handlers, this.inheritables);
    if (type.stringify) {
        return type.stringify.call(this, value, userData);
    } else {
        return JSON.stringify(value);
    }
}

function parse(jsonString, userData) {

    const json = JSON.parse(jsonString, (key, value) => {

        if (value && value.$$type && value.$$data) {
            const type = getTypeFromName(value.$$type, this.handlers);
            return type && type.parse ? type.parse(value.$$data, userData) : value;
        }

        return value; // return the unchanged property value.
    });

    return json;
}

const JSONE = function({ handlers }) {

    for (let key in handlers) {
        if (handlers.hasOwnProperty(key)) {
            let handler = handlers[key];
            if (typeof handler.stringify == 'function') {
                let enhancedStringify = handler.stringify.bind(handler);
                handler.stringify = (instance, userData) => stringifyExtended(handler.name, enhancedStringify(instance, userData));
            }
        }
    }

    this.handlers = Object.assign({}, DATA_TYPES, handlers);
    this.inheritables = Object.keys(handlers).map(key => handlers[key]).filter(isInheritable);
};


let prototype = {
    decode,
    encode,
    stringify,
    parse
};

Object.assign(JSONE, prototype);
JSONE.prototype = prototype;

module.exports = JSONE;


/***/ })
/******/ ]);