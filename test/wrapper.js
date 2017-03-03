'use strict';

const expect = require('chai').expect;
const Promise = require('bluebird');

const Wrapper = require('../wrapper');

// just define some testing classes

class BaseMockClass {

    constructor(delay) {

        this.delay = delay;
    }

    baseFunction(par1, callback) {

        setTimeout(() => {
            callback(null, par1 * 2);
        }, this.delay);
    }
}

class MockClass extends BaseMockClass {

    constructor(delay) {

        super(delay);
        this.property = 'baz';
    }

    myFunction(arg1, arg2) {

        return {
            a: arg1,
            b: arg2,
            foo: this.property
        };
    }
}

describe('Wrapper', () => {

    let mockInstance;
    let mockInstanceWrapper;

    before(() => {
        mockInstance = new MockClass(200);
        mockInstanceWrapper = new Wrapper(mockInstance);
    });

    it('should get wrapper descriptor', () => {

        let expected = {
            'baseFunction': {
                'type': 'function',
                'parameters': [
                    'par1'
                ]
            },
            'myFunction': {
                'type': 'function',
                'parameters': [
                    'arg1',
                    'arg2'
                ]
            },
            'property': {
                'type': 'property',
                'getter': true,
                'setter': true
            },
            'delay': {
                'type': 'property',
                'getter': true,
                'setter': true
            }
        };

        let descriptor = Wrapper.getDescriptor(mockInstanceWrapper);

        expect(descriptor).to.deep.equal(expected);
    });

    it('should call sync function and receive data', done => {

        mockInstanceWrapper.myFunction('Hello', true)
            .then(data => {

                let expected = { a: 'Hello', b: true, foo: 'baz' };

                expect(data).to.deep.equal(expected);
                done();
            })
            .catch(done);
    });

    it('should call async function and receive', done => {

        mockInstanceWrapper.baseFunction(45)
            .then(data => {

                expect(data).equal(90);
                done();
            })
            .catch(done);
    });
});
