'use strict'
const esprima = require('esprima');
const getParamValue = {
    'Identifier': par => par.name,
    'AssignmentPattern': par => getParamValue[par.left.type](par.left),
    'RestElement': par => getParamValue[par.argument.type](par.argument),
    'ArrayPattern': par => par.elements.map(arrayPatternElementValue),
    'ObjectPattern': par => par.properties.map(objectPatternPropertyValue)
};

// TODO: RestElement not working correctly

function arrayPatternElementValue(element) {

    return getParamValue[element.type](element);
}

function objectPatternPropertyValue(property) {

    return getParamValue[property.key.type](property.key);
}

function mapPars(par) {
    return {
        type: par.type,
        value: getParamValue[par.type](par)
    };
}

function getFunctionArguments(fn) {

    if (typeof fn !== 'function') {
        throw new Error( `argument fn (${fn}) is not function!` );
    }

    var fnString = fn.toString().trim();
    fnString = (fnString.startsWith('function') ? 'const __fn = ' : 'const __fn = function ') + fnString;
    var parsed = esprima.parse(fnString);
    var pars = parsed.body[0].declarations[0].init.params;

    return pars.map(mapPars);
}

module.exports = {
    getFunctionArguments
};
