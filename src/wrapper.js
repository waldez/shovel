'use strict'

const reflectjs = require('./reflectjs');
const Promise = require('bluebird');
// Generate a v1 UUID (time-based)
const uuidV1 = require('uuid/v1');

const CALLBACK_NAMES = [
    'callback',
    'cb',
    'done'
];

/**
 * check, instance is promise
 * @param  {*}  instance
 * @return {Boolean}
 */
function isPromiseInstance(instance) {
    return instance && typeof instance.then === 'function' && typeof instance.catch === 'function';
}

/**
 * wraps function calls to promises
 * @param  {string}    name
 * @param  {Function}  fn
 * @param  {*} params
 */
function functionCall(name, fn, ...params) {

    try {
        var result = fn(...params);

        // the function was async.. and returned Promise, so, act like it!
        // add then/catch and handle things
        if (isPromiseInstance(result)) {
            return result;
        } else {
            return Promise.resolve(result);
        }

    } catch (error) {
        return Promise.reject(error);
    }
}

function getter(name, instance) {

    let result = instance[name];
    return result;
}

function setter(name, instance, value) {

    instance[name] = value;
}

function getProps(obj) {

    var props = new Set();
    for (; obj && obj != Object.prototype; obj = Object.getPrototypeOf(obj)) {
        var ownProps = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < ownProps.length; i++) {
            props.add(ownProps[i]);
        }
    }
    return props;
}

// private property symbols
const _instance = Symbol('instance');
const _private = Symbol('private');

/**
 * wraps instance of an object to catch its function calls, property set/get stuff etc..
 * @param  {Object} instance
 * @param  {Wrapper} wrapper
 * @param  {Object} options
 */
function wrap(instance, wrapper, options) {

    // descriptor of instance for the client wrapper
    let descriptor = wrapper[_private].descriptor;
    let props = getProps(instance);

    props.forEach(prop => {
        if (options.proccessIherited || instance.hasOwnProperty(prop)) {
            // sanity check
            if (typeof wrapper[prop] != 'undefined') {
                // it basically means, there are Object properties which we don't want to override
                // console.log('Ignored property:', prop);
                return;
            }

            let value = instance[prop];
            let type = typeof value;

            // process function
            if (type === 'function') {

                descriptor[prop] = {
                    type,
                    parameters: null
                };

                let fnPars = reflectjs.getFunctionArguments(value);
                let params = fnPars.map((fnParam, index) => fnParam.value instanceof Array ? `param${index}` : fnParam.value);
                let fn = value;
                // FIX: really naive! WALDEZ, YOU ARE LAME! use esprim lib to improve! check body for callback calls, promises etc..
                // check, if last parameter falls into conventional callback names
                if (CALLBACK_NAMES.indexOf(params[params.length - 1]) > -1) {
                    // for the client wrapper, cut the callback
                    descriptor[prop].parameters = params.slice(0, params.length - 1);
                    // if so, promisify the shit out of this function!
                    fn = Promise.promisify(value, { context: instance });
                } else {
                    descriptor[prop].parameters = params;
                    // bind the instance to the function
                    fn = fn.bind(instance);
                }

                // assign wrapped function to the wrapper
                wrapper[prop] = functionCall.bind(null, prop, fn);

            } else { // process the rest, non-function

                // TODO: distinguish fields and properties (getter/setter)!
                // see: Object.getOwnPropertyDescriptor(obj, prop)

                descriptor[prop] = {
                    type: 'property',
                    getter: true,
                    setter: true
                };

                // create getters and setters for each property
                Object.defineProperty(wrapper, prop, {
                    get: getter.bind(null, prop, instance),
                    set: setter.bind(null, prop, instance),
                    enumerable: true,
                    configurable: false
                });
            }
        }
    });
}

function safeStaticGetter(prop, instance) {

    if (instance instanceof Wrapper) {
        return instance[_private][prop];
    }

    throw Error(`Parameter 'instance' is not type of Wrapper!`);
}

function safeStaticSetter(prop, instance, value) {

    if (instance instanceof Wrapper) {
        instance[_private][prop] = value;
    } else {
        throw Error(`Parameter 'instance' is not type of Wrapper!`);
    }
}


class Wrapper {

    constructor(instance, options = { proccessIherited: true, uid: uuidV1() }) {

        this[_instance] = instance;
        this[_private] = {
            descriptor: {},
            uid: options.uid,
            meta: null
        }; // private stuff

        wrap(instance, this, options);
    }
}

// Bound statics //
/**
 * Returns descriptor for the wrapper
 * @param {Wrapper} instance wrapper instance
 * @return {Object}
 */
Wrapper.getDescriptor = safeStaticGetter.bind(null, 'descriptor');
/**
 * Returns this wrappers unique identifier
 * @param {Wrapper} instance wrapper instance
 * @return {string}
 */
Wrapper.getUID = safeStaticGetter.bind(null, 'uid');
/**
 * Getter for metadata
 * @param {Wrapper} instance wrapper instance
 * @return {*}
 */
Wrapper.getMeta = safeStaticGetter.bind(null, 'meta');
/**
 * Setter for metadata
 * @param {Wrapper} instance wrapper instance
 * @param {*} value
 */
Wrapper.setMeta = safeStaticSetter.bind(null, 'meta');

/**
 * Returns wrapped instance
 * @param  {Wrapper} wrapper
 * @return {Object}
 */
Wrapper.getInstance = function(wrapper) {

    if (wrapper instanceof Wrapper) {
        return wrapper[_instance];
    }

    throw Error(`Parameter 'instance' is not type of Wrapper!`);
};

module.exports = Wrapper;
