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

function toUnixTime(t) {
    return ~~(t / 1000);
}
Date.prototype.getUnixTime = Date.prototype.getCTime = function () {
    return toUnixTime(this.getTime());
};

function fullScriptFn(no, ext) {
    if (!ext) ext = 'js';
    return path.join(scriptDir, 'tests', getTestscriptName(no)) + '.' + ext;
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

            var scriptFileTest1 = fullScriptFn(1);
            var scriptContent1 = "console.log('" + getTestscriptName(1) + " - LOCAL');";
            fs.writeFileSync(scriptFileTest1,scriptContent1);

            var scriptFileTest3 = fullScriptFn(3);
            var scriptContent3 = "console.log('" + getTestscriptName(3) + " - LOCAL');";
            fs.writeFileSync(scriptFileTest3,scriptContent3);
            var fd = fs.openSync(scriptFileTest3, 'w');
            fs.futimesSync(fd, 1324567890, 1324567890);
            fs.closeSync(fd);

            var scriptFileTest10 = fullScriptFn(10, 'blockly');
            var scriptContent10 = "console.log('" + getTestscriptName(10) + " Blockly - LOCAL');";
            fs.writeFileSync(scriptFileTest10,scriptContent10);

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
                        "native": {},
                        "ts":   1234567890000
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
                                "mtime": 1234567899
                            },
                            "type": "script",
                            "_id": "script.js.tests.Test_Script_1",
                            "native": {}
                        };
                        objects.setObject(script._id, script, function (err) {
                            expect(err).to.be.not.ok;
                            script = {
                                "common": {
                                    "name": getTestscriptName(11),
                                    "engineType": "Blockly",
                                    "source": "console.log('" + getTestscriptName(11) + " Blockly');",
                                    "enabled": true,
                                    "engine": "system.adapter.javascript.0"
                                },
                                "type": "script",
                                "_id": "script.js.tests.Test_Script_11",
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
                changedObjects[id] = true;
                if (Object.keys(changedObjects).length >= 3 && connectionChecked) {
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

    it('Test ' + adapterShortName + ' adapter: Check that js files got created', function (done) {
        this.timeout(60000);
        expect(fs.existsSync(path.join(scriptDir,'js2fs-settings') + '.json')).to.be.true;

        var scriptFileGlobal = path.join(scriptDir, 'global', 'Global Script.js');
        expect(fs.existsSync(scriptFileGlobal)).to.be.true;
        expect(fs.readFileSync(scriptFileGlobal).toString()).to.be.equal("console.log('Global');");
        var stat = fs.lstatSync(scriptFileGlobal);
        console.log(' STAT: ' + stat.mtime + ' -> ' + new Date(stat.mtime).toString() + '  --- ' + new Date(stat.mtime).getUnixTime())
        expect(new Date(stat.mtime).getUnixTime()).to.be.equal(1234567890);

        var scriptFileTest1 = fullScriptFn(1);
        expect(fs.existsSync(scriptFileTest1)).to.be.true;
        expect(fs.readFileSync(scriptFileTest1).toString()).to.be.equal("console.log('" + getTestscriptName(1) + " - LOCAL');");
        stat = fs.lstatSync(scriptFileTest1);
        console.log(' STAT: ' + stat.mtime + ' -> ' + new Date(stat.mtime).toString() + '  --- ' + new Date(stat.mtime).getUnixTime())
        expect(new Date(stat.mtime).getUnixTime()).not.to.be.equal(1234567899);

        var scriptFileTest11 = fullScriptFn(11, 'blockly');
        expect(fs.existsSync(scriptFileTest11)).to.be.true;
        expect(fs.readFileSync(scriptFileTest11).toString()).to.be.equal("console.log('" + getTestscriptName(11) + " Blockly');");
        stat = fs.lstatSync(scriptFileTest11);
        console.log(' STAT: ' + stat.mtime + ' -> ' + new Date(stat.mtime).toString() + '  --- ' + new Date(stat.mtime).getUnixTime())
        expect(new Date().getUnixTime() - new Date(stat.mtime).getUnixTime()).to.be.less(60);

        objects.getObject('script.js.tests.Test_Script_1', function(err, obj) {
            console.log(JSON.stringify(obj));
            expect(err).to.be.null;
            expect(obj.common.engineType).to.be.equal('Javascript/js');
            expect(obj.common.mtime).to.be.equal(0);
            expect(obj.common.source).to.be.equal("console.log('" + getTestscriptName(1) + " - LOCAL');");
            expect(new Date().getUnixTime() - obj.ts).to.be.less(60);

            objects.getObject('script.js.tests.Test_Script_3', function(err, obj) {
                console.log(JSON.stringify(obj));
                expect(err).to.be.null;
                expect(obj.common.engineType).to.be.equal('Javascript/js');
                expect(obj.common.source).to.be.equal("console.log('" + getTestscriptName(3) + " - LOCAL');");
                expect(obj.ts).to.be.equal(1324567890*1000);

                objects.getObject('script.js.tests.Test_Script_10', function(err, obj) {
                    console.log(JSON.stringify(obj));
                    expect(err).to.be.null;
                    expect(obj.common.engineType).to.be.equal('Blockly');
                    expect(obj.common.source).to.be.equal("console.log('" + getTestscriptName(10) + " Blockly - LOCAL');");

                    setTimeout(done, nextDelay);
                });
            });
        });
    });

    it('Test ' + adapterShortName + ' adapter: update TestScript 1', function (done) {
        this.timeout(60000);
        var scriptFileTest1 = fullScriptFn(1);
        var scriptContent = "console.log('" + getTestscriptName(1) + " - NEW');";
        var initObj = null;

        onObjectChanged = function (id, obj2) {
            console.log('Got Object-Modification on update for ' + id);
            if (id !== 'script.js.tests.Test_Script_1') return;

            expect(obj2.common.source).to.be.equal(scriptContent);
            expect(((new Date().getTime())-obj2.ts)<10000).to.be.true;
            expect(obj2.ts).not.to.be.equal(initObj.ts);
            onObjectChanged = null;
            setTimeout(done, nextDelay);
        };

        objects.getObject('script.js.tests.Test_Script_1', function(err, obj) {
            console.log(JSON.stringify(obj));
            expect(err).to.be.null;
            initObj = obj;

            console.log('CHANGE Local File ' + getTestscriptName(1));
            fs.writeFileSync(scriptFileTest1, scriptContent);
        });
    });

    it('Test ' + adapterShortName + ' adapter: create ' + getTestscriptName(2), function (done) {
        this.timeout(60000);
        var scriptFileTest2 = fullScriptFn(2);
        var scriptContent = "console.log('" + getTestscriptName(2) + "');";

        onObjectChanged = function (id, obj) {
            onObjectChanged = null;
            console.log('Got Object-Modification on create for ' + id);
            if (id !== 'script.js.tests.Test_Script_2') return;

            expect(obj.common.source).to.be.equal(scriptContent);
            setTimeout(done, nextDelay);
        };

        console.log('CREATE Local File ' + getTestscriptName(2));
        fs.writeFileSync(scriptFileTest2,scriptContent);
    });

    it('Test ' + adapterShortName + ' adapter: update ' + getTestscriptName(2) + ' in iobroker', function (done) {
        this.timeout(60000);
        var scriptFileTest2 = fullScriptFn(2);
        var scriptContent = "console.log('" + getTestscriptName(2) + " UPDATED');";

        var objNew = {};
        objNew.common = {}
        objNew.common.source = scriptContent;
        objects.extendObject('script.js.tests.Test_Script_2',objNew, function(err) {
            expect(err).to.be.null;
            setTimeout(function() {
                expect(fs.readFileSync(scriptFileTest2).toString()).to.be.equal(scriptContent);
                done();
            }, 2000)
        });
    });

    it('Test ' + adapterShortName + ' adapter: unlink ' + getTestscriptName(1), function (done) {
        this.timeout(60000);
        var scriptFileTest1 = fullScriptFn(1);

        onObjectChanged = function (id, obj) {
            console.log('onObjectChanged unlink, id=' + id);
            if (id !== 'script.js.tests.Test_Script_1') return;
            onObjectChanged = null;
            expect(obj).to.be.null;
            //expect(id).to.be.equal('script.js.tests.Test_Script_1');
            setTimeout(done, nextDelay);
        };
        console.log('unlinkSync(' + scriptFileTest1 + ')');
        fs.unlinkSync(scriptFileTest1);
    });

    it('Test ' + adapterShortName + ' adapter: delete script object', function (done) {
        this.timeout(60000);
        var scriptFileTest3 = fullScriptFn(3);
        expect(fs.existsSync(scriptFileTest3)).to.be.true;

        objects.delObject('script.js.tests.Test_Script_3', function(err) {
            expect(err).to.be.null;
            setTimeout(function() {
                var exists;
                try {
                    exists = fs.existsSync(scriptFileTest3);
                } catch(e) {
                    exists = false;
                }
                expect(exists).to.be.false;
                setTimeout(done, nextDelay);
            }, 2000)
        });
    });

    it('Test ' + adapterShortName + ' adapter: rename script object', function (done) {
        this.timeout(30000);
        var scriptFileTest2 = fullScriptFn(2),
            newName = 'new Name for Script 2',
            oldId = 'script.js.tests.Test_Script_2',
            newId = 'script.js.tests.' + newName.replace(/ /g, '_');

        objects.getObject(oldId, function(err, obj) {
            expect(err).to.be.null;
            expect(obj).to.be.an('object');
            expect(obj.common.name).to.be.equal('Test Script 2');
            obj.common.name = newName;

            objects.setObject(newId, obj, function(err, newObj) {
                expect(err).to.be.null;
                expect(newObj).to.be.not.null;
                expect(newObj.id).to.be.equal(newId);

                objects.delObject(oldId, function(err) {
                    expect(err).to.be.null;
                    setTimeout(function() {
                        var exists = fs.existsSync(scriptFileTest2);
                        expect(exists).to.be.false;
                        console.log(scriptFileTest2 + ' was removed!');
                        scriptFileTest2 = path.join(scriptDir,'tests', newName) + '.js';
                        console.log(scriptFileTest2 + ' should exist');
                        exists = fs.existsSync(scriptFileTest2);
                        expect(exists).to.be.true;
                        setTimeout(done, nextDelay);
                    }, 2000)
                })

            });
        });
    });

    it('Test ' + adapterShortName + ' adapter: update config', function (done) {
        this.timeout(60000);

        var changeCount = 0;
        var modifiedSettings = JSON.parse(fs.readFileSync(path.join(scriptDir, 'js2fs-settings.json')));
        modifiedSettings.config.disableWrite = true;
        modifiedSettings.config.allowDeleteScriptInioBroker = false;
        console.log('writeFileSync(js2fs-settings.json): ' + JSON.stringify(modifiedSettings));
        fs.writeFileSync(path.join(scriptDir, 'js2fs-settings.json'), JSON.stringify(modifiedSettings));
        setTimeout(done, nextDelay);
    });

    it('Test ' + adapterShortName + ' adapter: update ' + getTestscriptName(2) + ' in iobroker Do not write!', function (done) {
        this.timeout(60000);
        var scriptFileTest2 = path.join(scriptDir,'tests', 'new Name for Script 2') + '.js';

        var scriptContentOrig = "console.log('" + getTestscriptName(2) + " UPDATED');";
        var scriptContent = "console.log('" + getTestscriptName(2) + " UPDATED-DO_NOT_WRITE');";

        var objNew = {};
        objNew.common = {}
        objNew.common.source = scriptContent;
        objects.extendObject('script.js.tests.new_Name_for_Script_2',objNew, function(err) {
            expect(err).to.be.null;
            setTimeout(function() {
                expect(fs.readFileSync(scriptFileTest2).toString()).to.be.equal(scriptContentOrig);
                done();
            }, 2000)
        });
    });

    it('Test ' + adapterShortName + ' adapter: unlink ' + getTestscriptName(2) + ' Do not delete', function (done) {
        this.timeout(60000);
        var scriptFileTest2 = path.join(scriptDir,'tests', 'new Name for Script 2') + '.js';

        console.log('unlinkSync(' + scriptFileTest2 + ')');
        fs.unlinkSync(scriptFileTest2);
        setTimeout(function() {
            objects.getObject('script.js.tests.new_Name_for_Script_2', function(err, obj) {
                expect(err).to.be.null;
                expect(obj).not.to.be.null;
                setTimeout(done, nextDelay);
            });
        }, 2000);
    });

    after('Test ' + adapterShortName + ' adapter: Stop js-controller', function (done) {
        this.timeout(10000);

        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
