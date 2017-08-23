/* jshint -W097 */// jshint strict:false
/*jslint node: true */
var expect = require('chai').expect;
var path = require('path');
var fs = require('fs');
var setup  = require(__dirname + '/lib/setup');

var objects = null;
var states  = null;
var onStateChanged = null;
var onObjectChanged = null;
var sendToID = 1;

var adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.')+1);

var scriptDir = path.join(__dirname, 'myScripts');

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    console.log('Try check #' + counter);
    if (counter > 30) {
        if (cb) cb('Cannot check connection');
        return;
    }

    states.getState('system.adapter.' + adapterShortName + '.0.alive', function (err, state) {
        if (err) console.error(err);
        if (state && state.val) {
            if (cb) cb();
        } else {
            setTimeout(function () {
                checkConnectionOfAdapter(cb, counter + 1);
            }, 1000);
        }
    });
}

function checkValueOfState(id, value, cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        if (cb) cb('Cannot check value Of State ' + id);
        return;
    }

    states.getState(id, function (err, state) {
        if (err) console.error(err);
        if (value === null && !state) {
            if (cb) cb();
        } else
        if (state && (value === undefined || state.val === value)) {
            if (cb) cb();
        } else {
            setTimeout(function () {
                checkValueOfState(id, value, cb, counter + 1);
            }, 500);
        }
    });
}

function sendTo(target, command, message, callback) {
    onStateChanged = function (id, state) {
        if (id === 'messagebox.system.adapter.test.0') {
            callback(state.message);
        }
    };

    states.pushMessage('system.adapter.' + target, {
        command:    command,
        message:    message,
        from:       'system.adapter.test.0',
        callback: {
            message: message,
            id:      sendToID++,
            ack:     false,
            time:    (new Date()).getTime()
        }
    });
}

describe('Test ' + adapterShortName + ' adapter', function() {
    before('Test ' + adapterShortName + ' adapter: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';

            fs.mkdirSync(scriptDir);
            config.native.rootDir   = scriptDir;

            setup.setAdapterConfig(config.common, config.native);

            setup.startController(false, function (id, obj) {
                    if (onObjectChanged) onObjectChanged(id, obj);
                }, function (id, state) {
                    if (onStateChanged) onStateChanged(id, state);
            },
            function (_objects, _states) {
                objects = _objects;
                states  = _states;
                states.subscribe('*');
                var script = {
                    "common": {
                        "name":         "Global Script",
                        "engineType":   "Javascript/js",
                        "source":       "console.log('Global');",
                        "enabled":      true,
                        "engine":       "system.adapter.javascript.0"
                    },
                    "type":             "script",
                    "_id":              "script.js.global.TestGlobal",
                    "native": {}
                };
                objects.setObject(script._id, script, function (err) {
                    expect(err).to.be.not.ok;
                    script = {
                        "common": {
                            "name": "Test Script 1",
                            "engineType": "Javascript/js",
                            "source": "console.log('Test Script 1');",
                            "enabled": true,
                            "engine": "system.adapter.javascript.0"
                        },
                        "type": "script",
                        "_id": "script.js.tests.TestScript1",
                        "native": {}
                    };
                    objects.setObject(script._id, script, function (err) {
                        expect(err).to.be.not.ok;
                        setup.startAdapter(objects, states, function () {
                            _done();
                        });
                    });
                });
            });
        });
    });

/*
    ENABLE THIS WHEN ADAPTER RUNS IN DEAMON MODE TO CHECK THAT IT HAS STARTED SUCCESSFULLY
*/
    it('Test ' + adapterShortName + ' adapter: Check if adapter started', function (done) {
        this.timeout(60000);
        var changedObjects = {};
        onObjectChanged = function (id, obj) {
            if (id.substring(0,10) === 'script.js.') {
                console.log('Go Object-Modification for ' + id);
                changedObjects[id] = true;
                if (Object.keys(changedObjects).length === 2) done();
            }
        };

        checkConnectionOfAdapter(function (res) {
            if (res) console.log(res);
            expect(res).not.to.be.equal('Cannot check connection');
            objects.setObject('system.adapter.test.0', {
                    common: {

                    },
                    type: 'instance'
                },
                function () {
                    states.subscribeMessage('system.adapter.test.0');
                    if (Object.keys(changedObjects).length === 2) done();
                });
        });
    });

    it('Test ' + adapterShortName + ' adapter: Check that file got created', function (done) {
        this.timeout(60000);
        if (fs.existsSync(path.join(scriptDir,'tests','TestScript1') + '.js')) done();
    });

    after('Test ' + adapterShortName + ' adapter: Stop js-controller', function (done) {
        this.timeout(10000);

        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
