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

function fullScriptFn(no) {
    return path.join(scriptDir, 'tests', getTestscriptName(no)) + '.js';
}

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

function getTestscriptName(no, ext) {
    return 'Test Script ' + no + (ext ? '.'+ext : '');
}

var nextDelay = 4000;

describe('Test ' + adapterShortName + ' adapter', function() {
    before('Test ' + adapterShortName + ' adapter: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';

            if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir);
            config.native.rootDir   = scriptDir;
            if (!fs.existsSync(path.join(scriptDir, 'tests'))) fs.mkdirSync(path.join(scriptDir, 'tests'));
            config.native.basicSync = true;

            var scriptFileTest1 = fullScriptFn(1);
            var scriptContent1 = "console.log('" + getTestscriptName(1) + " - LOCAL');";
            fs.writeFileSync(scriptFileTest1,scriptContent1);

            var scriptFileTest3 = fullScriptFn(3);
            var scriptContent3 = "console.log('" + getTestscriptName(3) + " - LOCAL');";
            fs.writeFileSync(scriptFileTest3,scriptContent3);

            setup.setAdapterConfig(config.common, config.native);

            setup.startController(false, function (id, obj) {
                    if (onObjectChanged) onObjectChanged(id, obj);
                }, function (id, state) {
                    if (onStateChanged) onStateChanged(id, state);
                },
                function (_objects, _states) {
                    objects = _objects;
                    states  = _states;
                    states.subscribe("*");
                    objects.subscribe("*");
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
                        //"_id":              "script.js.global.Global_Script",
                        "native": {}
                    };
                    objects.setObject(script._id, script, function (err) {
                        expect(err).to.be.not.ok;
                        script = {
                            "common": {
                                "name": getTestscriptName(1),
                                "engineType": "Javascript/js",
                                "source": "console.log('" + getTestscriptName(1) + "');",
                                "enabled": true,
                                "engine": "system.adapter.javascript.0",
                                "mtime": 1
                            },
                            "type": "script",
                            "_id": "script.js.tests.Test_Script_1",
                            "native": {}
                        };
                        objects.setObject(script._id, script, function (err) {
                            expect(err).to.be.not.ok;
                            _done();
                        });
                    });
                });
        });
    });

    /*
        ENABLE THIS WHEN ADAPTER RUNS IN DEAMON MODE TO CHECK THAT IT HAS STARTED SUCCESSFULLY
    */
    it('Test ' + adapterShortName + ' adapter: start adapter and Check if adapter started', function (done) {
        this.timeout(60000);
        var changedObjects = {};
        var connectionChecked = false;
        onObjectChanged = function (id, obj) {
            console.log('Got initial Object-Modification for ' + id);
            if (id.substring(0,10) === 'script.js.') {
                expect(obj.common.mtime).not.to.be.undefined;
                changedObjects[id] = true;
                if (Object.keys(changedObjects).length >= 2 && connectionChecked) {
                    onObjectChanged = null;
                    setTimeout(done, nextDelay);
                }
            }
        };
        setup.startAdapter(objects, states, function () {
            checkConnectionOfAdapter(function (res) {
                if (res) console.log(res);
                expect(res).not.to.be.equal('Cannot check connection');
                objects.setObject('system.adapter.test.0', {
                        common: { },
                        type: 'instance'
                    },
                    function () {
                        changedObjects['system.adapter.test.0'] = true;
                        states.subscribeMessage('system.adapter.test.0');
                        connectionChecked = true;
                        if (Object.keys(changedObjects).length >= 3 && connectionChecked) {
                            onObjectChanged = null;
                            setTimeout(done, nextDelay);
                        }
                    });
            });
        });
    });

    it('Test ' + adapterShortName + ' adapter: Check that js files and backup-dir got created', function (done) {
        this.timeout(60000);
        var scriptFileTest1 = fullScriptFn(1);
        expect(fs.existsSync(path.join(path.dirname(scriptDir), 'js2fs-backup'))).to.be.true;
        expect(fs.existsSync(path.join(scriptDir,'js2fs-settings') + '.json')).to.be.true;
        expect(fs.existsSync(scriptFileTest1)).to.be.true;
        expect(fs.readFileSync(scriptFileTest1).toString()).to.be.equal("console.log('" + getTestscriptName(1) + "');");
        objects.getObject('script.js.tests.Test_Script_1', function(err, obj) {
            console.log(JSON.stringify(obj));
            expect(err).to.be.null;
            expect(obj.common.mtime).to.be.equal(1);
            expect(obj.common.source).to.be.equal("console.log('" + getTestscriptName(1) + "');");

            objects.getObject('script.js.tests.Test_Script_3', function(err, obj) {
                console.log(JSON.stringify(obj));
                expect(err).to.be.null;
                expect(obj).to.be.null;

                setTimeout(done, nextDelay);
            });
        });
    });

    after('Test ' + adapterShortName + ' adapter: Stop js-controller', function (done) {
        this.timeout(10000);

        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
