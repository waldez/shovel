var ShovelClient =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.l = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// identity function for calling harmony imports with the correct context
/******/ 	__webpack_require__.i = function(value) { return value; };

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

/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};

/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = 2);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

const JSONE = __webpack_require__(1);

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
            Promise.reject(parsingError);
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
    constructor({ serviceHost = 'localhost', servicePort = '31415', request }) {

        request = request.bind(null, processResponse);
        // clientId, <-client identifier

        let that = this;
        // typeHash:[WrapperClass].constructor
        let wrappers = new Map();
        // uid:[WrapperClass]
        let instances = new Map();
        let boundShovel = this.shovel.bind(this);

        // handlers for unknown types (Wrapper type)
        let jsonHandlers = {
            Wrapper: {
                name: 'Wrapper',
                ctor: Wrapper,
                stringify: Wrapper.stringify,
                parse: ({ uid, typeHash }) => {

                    let instance = instances.get(uid);
                    if (instance) {
                        return instance;
                    }

                    let wrapperClass = wrappers.get(typeHash);
                    if (wrapperClass) {
                        return this[Ξ].addInstance(uid, wrapperClass.wrapper);
                    }

                    // TODO: better
                    return null;
                }
            }
        };

        // private stuff
        this[Ξ] = {
            JSONE: new JSONE({ handlers: jsonHandlers }),
            wrappers,
            instances,
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
            }.bind(that)
        };

        this.getServiceInfo = () => ({ serviceHost, servicePort });
        this.request = function(serviceHost, servicePort, options = {}, data) {

            options.host = serviceHost;
            options.port = servicePort;

            return request(options, data);
        }.bind(this, serviceHost, servicePort);
    }

    initialize() {

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

    static create(request, { serviceHost, servicePort } = {}, fetchList = true) {

        let client = new ShovelClient({ serviceHost, servicePort, request });
        return fetchList ? client.initialize() : client;
    }
}

module.exports = ShovelClient;


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

function decode(jsonString) {

    return parse.call(this, jsonString);
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

function parse(jsonString) {

    const json = JSON.parse(jsonString, (key, value) => {

        if (value && value.$$type && value.$$data) {
            const type = getTypeFromName(value.$$type, this.handlers);
            return type.parse ? type.parse(value.$$data) : value;
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



/***/ }),
/* 2 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


const ShovelClient = __webpack_require__(0);
const request = (processResponse, { method = 'POST', port, host, path = '/', bodyParser }, data) => {

    return new Promise((resolve, reject) => {

        data = typeof data === 'object' ? JSON.stringify(data) : data;
        let req = new XMLHttpRequest();

        // TODO: do the headers
        // req.setRequestHeader('custom-header', 'value');

        req.onreadystatechange = () => {

            if (req.readyState === XMLHttpRequest.DONE) {
                processResponse(resolve, reject, req.responseText, req.status, /*req.statusMessage*/ undefined, bodyParser);
            }
        };
        req.open(method, `http://${host}:${port}${path}`, true);
        req.send(data);
    });
};

module.exports = ShovelClient.create.bind(null, request);


/***/ })
/******/ ]);