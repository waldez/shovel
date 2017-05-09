SHOVEL
======
(Shit Happens Online Via Epic Library)

### Disclaimer
This is POC (proof of concept)! It's not nice... It's buggy and needs lots more love & coding. Improvements have to be done...

### Author
waldez

### WTF is this all about?
I hate REST, CRUD, Blueprint, Swagger or other stuff.. I don't care about network comunication, I just want use an application object on server side and remote control it on client side.

### Instalation

Via npm:
```sh
$ npm install --save https://github.com/waldez/shovel.git
```

### Known issues / missing esentials
 * __client__ - pending requests on client (they don't abort correctly and cumulate on client)
 * __client__ - forever hook abort causes exception on client
 * __server__ - missing global identifier for globaly refistered instances
 * __server__ - missing automatic (session) registered instances. meaning, we want to register (to session) all instances returned by globabl wrappers
 * __server__ - session manager (keep track of session life by setting timestamps on `setForeverHook` function)
 * __server__ - automatic handler registration
 * (server/client) support for binary data (buffers/typed arrays)
 * __client__ - keep track of registered wrappers using headers (array of IDs)
 * __server__ - separate server part from implicit HTTP server implementation (in our case native http.server) and make it, so *Shovel* could be just one route/endpoint of the http server

### Usage

Example of server-side usage:
```javascript
'use strict'

const Shovel = require('shovel').Shovel;

// creates instance of Shovel & starts listening on the port
const shovel = new Shovel({ port: 31415 });

class MyClass {

    unite(param1 = {}, param2 = {}) {

        if (typeof param1 != 'object' || typeof param2 != 'object') {
            throw Error('Not an object!');
        }

        return Object.assign(param1, param2);
    }

    wait(delay, callback) {

        setTimeout(() => {

            callback(null, 'Waited till: ' + (new Date()).toString());
        }, delay);
    }
}

var instance = new MyClass();

// register the object we want to expose
shovel.register(instance);
```

Example of client-side (node.js) usage:
```javascript
const ShovelClient = require('shovel').ShovelClient;

const options = {
    serviceHost: 'localhost',
    servicePort: '31415'
};

ShovelClient(options)
    .then(runMyStuff);

function runMyStuff(shovel) {

    // list registered stuff
    let list = shovel.list();

    // get first instance
    let obj = shovel.get(list[0].instances[0]);

    console.log(`Calling 'wait' at:`, new Date());
    // call wait function
    obj.wait(1000)
        .then(data => {

            console.log(data);
        })
        .catch(err => {

            console.log('Error:', err);
        });
}
```

Example of client-side (browser) usage:
```html
<!doctype html>

<html lang="en">
<head>
  <meta charset="utf-8">

  <title>Test site for wrapper client</title>
  <meta name="description" content="Test site for wrapper client">
  <meta name="author" content="waldez <tomas.waldauf@gmail.com>">
  <script src="dist/client_bundle.min.js"></script>
  <!-- <script src="dist/client_bundle.min.js"></script> -->
</head>
<body>
  <pre id="content"><pre/>
  <script>
'use strict'

const options = {
    serviceHost: 'localhost',
    servicePort: '31415'
};

window.ShovelClient(options)
    .then(runMyStuff);

function runMyStuff(shovel) {

    // get list of registered stuff
    let list = shovel.list();
    // get the first instance
    let obj = shovel.get(list[0].instances[0]);

    // some data
    let json = {
        count: 6,
        reg: /.*/im,
        timestamp: new Date(),
        wrapper1: obj,
        undef: undefined,
        items: [
            'hello',
            undefined
        ]
    };

    // call the function/property/field on the server
    obj.unite(json, { foo: 23, bar: 'bar', arrr: [1, 2, 3] })
        .then(data => {

            document.getElementById('content').innerHTML = JSON.stringify(data, null, '\t');
        })
        .catch(alert);
}
  </script>
</body>
</html>
```

### TODO-list
 - auto-register of object/class instances returned by already registered objects/instances
 - session lifetime manager
