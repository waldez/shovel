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
                }

                // needed this direct promise, to be able call abort
                hookPromise = this.request({ method: 'POST', path: url + 'foreverhook', bodyParser }, {});
                hookPromise
                    .then(data => {

                        // fullfilled, so clear it
                        hookPromise = null;

                        // console.log('!W! - data:\n', JSON.stringify(data, null, '\t'));

                        if (Array.isArray(data)) {
                            data.forEach(handlerData => {

                                let handler = this.getHandler(handlerData.id);
                                // could return promise, which could be sent back to server...
                                let result = Promise.resolve(handler.call(handlerData.data));
                            });
                        } else {
                            // TODO: what? some kind of error..
                        }

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


        // TODO: ?? inspiration
        // var xhr = new XMLHttpRequest();
        // console.log('UNSENT', xhr.status);

        // xhr.open('GET', '/server', true);
        // console.log('OPENED', xhr.status);

        // xhr.onprogress = function () {
        //   console.log('LOADING', xhr.status);
        // };

        // xhr.onload = function () {
        //   console.log('DONE', xhr.status);
        // };

        // xhr.send(null);


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
        req.abort.bind(req);
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
    // Buffer: { name: 'Buffer', ctor: Buffer } // TODO: !!! Typed Arrays?
};

const INHERITABLES = Object.keys(DATA_TYPES).map(key => DATA_TYPES[key]).filter(isInheritable);

function getTypeFromName(name, dataTypes = DATA_TYPES) {

    return dataTypes[name];
}

function getType(value, dataTypes = DATA_TYPES, inheritables = INHERITABLES) {

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
        return inheritables.find(item => (item.instanceOf && item.instanceOf(value)) || (item.ctor && value instanceof item.ctor))
            || dataTypes.Object;
    } else {
        return dataTypes[Object.getPrototypeOf(value).constructor.name];
    }
}

function arrayStringify(array) {

    let delimiter = '';
    let body = '';
    for (let i = 0; i < array.length; i++) {
        const value = array[i];
        body += delimiter + stringify.call(this, value);
        delimiter = ',';
    }

    return `[${body}]`;
}

function objectStringify(object) {

    let delimiter = '';
    let body = '';
    for (let key in object) {
        if (object.hasOwnProperty(key)) {
            const value = object[key];
            if (typeof value == 'undefined') {
                continue;
            }
            body += delimiter + JSON.stringify(key) + ':' + stringify.call(this, value);
            delimiter = ',';
        }
    }

    return `{${body}}`;
}

function decode(jsonString, userData) {

    return parse.call(this, jsonString, userData);
};

function encode(json) {

    return stringify.call(this, json);
};

function stringify(value) {

    const type = getType(value, this.handlers, this.inheritables);
    if (type.stringify) {
        return type.stringify.call(this, value);
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
                handler.stringify = instance => stringifyExtended(handler.name, enhancedStringify(instance));
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