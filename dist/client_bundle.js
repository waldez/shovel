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
/******/ 	return __webpack_require__(__webpack_require__.s = 4);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


const WebSocket = __webpack_require__(2);
const wsHelpers = __webpack_require__(5);
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


/***/ }),
/* 1 */
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


/***/ }),
/* 2 */
/***/ (function(module, exports, __webpack_require__) {

/* WEBPACK VAR INJECTION */(function(global) {// https://github.com/maxogden/websocket-stream/blob/48dc3ddf943e5ada668c31ccd94e9186f02fafbd/ws-fallback.js

var ws = null

if (typeof WebSocket !== 'undefined') {
  ws = WebSocket
} else if (typeof MozWebSocket !== 'undefined') {
  ws = MozWebSocket
} else if (typeof global !== 'undefined') {
  ws = global.WebSocket || global.MozWebSocket
} else if (typeof window !== 'undefined') {
  ws = window.WebSocket || window.MozWebSocket
} else if (typeof self !== 'undefined') {
  ws = self.WebSocket || self.MozWebSocket
}

module.exports = ws

/* WEBPACK VAR INJECTION */}.call(exports, __webpack_require__(3)))

/***/ }),
/* 3 */
/***/ (function(module, exports) {

var g;

// This works in non-strict mode
g = (function() {
	return this;
})();

try {
	// This works if eval is allowed (see CSP)
	g = g || Function("return this")() || (1,eval)("this");
} catch(e) {
	// This works if the window reference is available
	if(typeof window === "object")
		g = window;
}

// g can still be undefined, but nothing to do about it...
// We return undefined, instead of nothing here, so it's
// easier to handle this case. if(!global) { ...}

module.exports = g;


/***/ }),
/* 4 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

// modules
const JSONE = __webpack_require__(1);
const Net = __webpack_require__(0);

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
        servicePort = '31415'
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
            host: serviceHost,
            port: servicePort,
            bodyParser,
            buildMetadata,
            onHandlerData: onHandlerData.bind(this)
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

            return net.request(jsone.encode(postData))
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

        this.stop = () => net.stop();

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

            // wait for Net to heave an connection then fetch the list from server
            return net.ready.then(this.list.bind(this, true)).then(() => this);
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

                return net.request(jsone.encode(postData));
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

    static async create(options = {}, fetchList = true) {

        let client = new ShovelClient(options);
        return await (fetchList ? client.initialize() : client);
    }
}

module.exports = ShovelClient.create;


/***/ }),
/* 5 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


const DELIMITER = ':';
const MESSAGE_TYPE = Object.freeze({
    REQUEST: 'q',
    RESPONSE: 's',
    ERROR: 'e'
});

class ConcurentIds {

    constructor() {

        this.used = new Set();
        this.next = 0;
    }

    popId() {

        const id = this.next;
        this.used.add(id);
        while (this.used.has(++this.next)) {/*NOP*/}
        return id;
    }

    pushId(id) {

        this.next = this.next > id ? id : this.next;
        this.used.delete(id);
    }
}

module.exports = {

    // TODO: better!
    extractHeader(message) {

        const headerEndIndex = message.indexOf(DELIMITER);
        const header = message.substring(0, headerEndIndex);
        const rawData = message.substring(headerEndIndex + 1);
        return {
            type: header[header.length - 1],
            id: parseInt(header),
            rawData
        };
    },

    insertHeader(message, type, id) {

        return id + type + DELIMITER + message;
    },

    ConcurentIds,
    MESSAGE_TYPE
};


/***/ })
/******/ ]);