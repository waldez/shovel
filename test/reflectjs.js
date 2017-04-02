'use strict';

const expect = require('chai').expect;
const reflectjs = require('../src/reflectjs');

describe('ReflectJS', () => {

    var functions = null;
    const getFnParamsExpect = [
        [{ 'type':'Identifier', 'value':'delay' }, { 'type':'Identifier', 'value':'nuff' }, { 'type':'AssignmentPattern', 'value':'str' }, { 'type':'AssignmentPattern', 'value':'str2' }, { 'type':'Identifier', 'value':'bagr' }, { 'type':'Identifier', 'value':'param34' }, { 'type':'AssignmentPattern', 'value':'json' }, { 'type':'Identifier', 'value':'callback' }] , [] , [{ 'type':'Identifier', 'value':'a' }, { 'type':'Identifier', 'value':'b' }, { 'type':'RestElement', 'value':'c' }] , [{ 'type':'Identifier', 'value':'g' }] , [{ 'type':'ArrayPattern', 'value':['name', 'val'] }] , [{ 'type':'ObjectPattern', 'value':['name', 'val'] }] , [{ 'type':'ObjectPattern', 'value':['name', 'val'] }]
    ];

    before(() => {

        var fn = function(delay, nuff,
            str = ' ',
            str2 = ',',
            /* multiline

            comment
            with ',' inside */ bagr,
            param34, // singleline comment
            json = { foo: 54, bar: true },
            callback) {
            setTimeout(() => {

                callback({ foo: 42, bar: 'Yello timeout!', data: this.options });
            }, delay * 1000);
        };

        function f ([ name, val ]) {
            console.log(name, val);
        }

        function g ({ name: n, val: v }) {
            console.log(n, v);
        }

        function h ({ name, val }) {
            console.log(name, val);
        }

        functions = [
            fn,
            function() { return 4; },
            (a, b, ...c) => (a + b),
            g => g,
            f,
            g,
            h
        ];

    });

    it('should parse test functions', () => {

        functions.forEach((fn, index) => {

            var pars = reflectjs.getFunctionArguments(fn);

            // uncomment to printout actual param parsing
            // console.log(',' + JSON.stringify(pars));

            expect(pars).to.deep.equal(getFnParamsExpect[index]);
        });

    });
});
