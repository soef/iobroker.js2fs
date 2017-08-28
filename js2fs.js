/* jshint -W097 */
// jshint strict:false
/*jslint node: true */
/*jslint esversion: 6 */

"use strict";

const
    soef = require('soef'),
    path = require('path'),
    fs = require('fs'),
    chokidar = require('chokidar'),
    child_process = require('child_process')
;

const
    SETTINGS = 'js2fs-settings',
    SETTINGS_JSON = SETTINGS + '.json',
    GLOBALSCRIPT_MAGIC = 'CD3D5AC4-9831-4ECA-828F-17C369C592B5',
    GLOBALSCRIPT_SUFIX = '/*** ' + GLOBALSCRIPT_MAGIC + ' ***/',

    reScriptJsDot = /^script\.js\./,
    reScriptJs = /^script\.js/,

    reSettings = new RegExp (SETTINGS.replace(/\-/g, '\\-')), ///file\-settings$/
    //reGlobalScriptMagic = /^[\s|\S]*CD3D5AC4-9831-4ECA-828F-17C369C592B5.*?\r?\n([\s|\S]*)/
    reGlobalScriptMagic = new RegExp ('^[\\s|\\S]*' + GLOBALSCRIPT_MAGIC.replace(/\-/g, '\\-') + '.*?\\r?\\n([\\s|\\S]*)'),
    emptyArray = []
;

let noext, killext, ignoreObjectChange, scripts;
let rootDir, logFilter, copyLog;
let logTimer = soef.Timer();

String.prototype.fullFn = function (fn) {
    if (!fn) return adapter.config.rootDir.fullFn(this);
    //if (path.isAbsolute(fn)) return fn;
    if (fn.startsWith(adapter.config.rootDir)) return fn;
    return path.normalize(path.join(this, fn));
};
String.prototype.remove = function (regex) {
    return this.replace(regex, '');
};
String.prototype.noext = function () {
    //return this.replace(/\.[^.]*?$/, '');
    let fn = this;
    let ext = path.extname(fn);
    if (ext.length > 0) {
        return fn.substring(0,fn.length-ext.length);
    }
    return fn;
};
String.prototype.justPathname = function () {
    if (this.noext() === this) return this;
    return path.dirname(this);
};
String.prototype.justFilename = function () {
    return this.replace(/.*[\\/]([^\\/]+?)$/, '$1');
    // let idx = this.lastIndexOf(path.sep);
    // if (idx >= 0) return this.substr(idx+1);
    // return this;
};
String.prototype.withoutRoot = function () {
    if (this.startsWith(rootDir)) return this.substring(rootDir.length);
    return this;
};
String.prototype.toFn = String.prototype.toFilename = String.prototype.id2fn = function () {
    let o = scripts.id2obj(this);
    if (!o) return;
    return adapter.config.rootDir.fullFn(o.fn);
};

function toUnixTime(t) {
    return ~~(t / 1000);
}
Date.prototype.getUnixTime = Date.prototype.getCTime = function () {
    return toUnixTime(this.getTime());
};

let adapter = soef.Adapter(
    main,
    onStateChange,
    onObjectChange,
    onUnload,
    'js2fs'
);

function onUnload(callback) {
    watcher.close();
    callback && callback();
}

function onStateChange(id, state) {
    let dcs = adapter.idToDCS(id);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function deleteFile(id) {
    let dn, fn = id.toFn();
    adapter.log.debug('deleteFile: ' + fn);
    if (!fn) return;
    if (soef.isDirectory((dn = fn.noext()))) {
        adapter.log.debug('deleteDirectory: ' + dn);
        watcher.ignore(dn);
        return soef.rmdirSync(dn);
    }
    watcher.ignore(fn);
    soef.unlink(fn);
}

function onObjectChange(id, object) {
    if (soef.lastIdToModify === id || ignoreObjectChange || !reScriptJsDot.test(id)) return;
    adapter.log.debug('onObjectChange: ' + id);

    if (id && !object) { // deleted..
        return deleteFile(id);
    }

    let o = scripts.id2obj(id);
    if (!o)  {
        adapter.log.debug('onObjectChange: new object rescan');
        return start();
    }
    if (object.common.source === o.common.source) return;

    o.common = object.common;
    let mtime = new Date().getUnixTime();
    soef.modifyObject(id, {common: { mtime: mtime }});
    writeFile(id.toFn(), source, mtime);
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let Scripts = function () {
    if (!(this instanceof Scripts)) {
        return new Scripts();
    }
    const
        regExGlobalOld = /_global$/,
        regExGlobalNew = /script\.js\.global\./;

    let ids = {}, fns = {}, objs = {}, scripts = [], self = this;

    this.globalScript = '';

    Object.defineProperty(this, "fns", { get: () => fns });
    Object.defineProperty(this, "scripts", { get: () => scripts });

    let isGlobal = function (obj) {
        return regExGlobalOld.test(obj.common.name) || regExGlobalNew.test(obj._id);
    };

    this.fn2obj = (fn) => fns[fn];
    this.id2obj = (id) => ids[id];
    this.getobj = function (fnOrId) {
        if (typeof fnOrId !== 'string') fnOrId = fnOrId.toString();
        //if (fnOrId[0] === '/') fnOrId.replace(/\//g, '\\');
        if (fnOrId[0] === path.sep) return fns[fnOrId];
        return ids[fnOrId];
    };

    function addoo(oo) {
        scripts.push(oo);
        if (oo.isGlobal && oo.common.enabled) {
            self.globalScript += oo.common.source + '\n';
        }
        let obj = objs;
        let id = oo.id; //normalizedName(oo.id);
        id.split('.').forEach(function (n, i) {
            if (i < 2) return;
            obj[n] = obj[n] || {};
            obj = obj[n];
        });
        obj.isFile = true;
        if (oo.isSettings) obj.isSettings = true;
    }

    function addSettings() {
        let oo = {
            fn: path.sep + SETTINGS_JSON,
            id: 'script.js.' + SETTINGS,
            isFile: true,
            isSettings: 'create', //true,
            common: {
                source: '{' +
                '" config": {' +
                '  "useGlobalScriptAsPrefix": false,' +
                '  "restartScript": true,' +
                '  "disableWrite": false,' +
                ' }' +
                '}'
            }
        };
        addoo(oo);
    }

    this.read = function (callback) {
        ids = {};
        fns = {};
        objs = {};
        scripts = [];
        let settingsFound, now = new Date().getUnixTime();
        this.globalScript = '';

        adapter.objects.getObjectList({
            startkey: 'script.js.',
            endkey: 'script.js.' + '\u9999'
        }, null, function (err, res) {
            if (err || !res || !res.rows) return;
            res.rows.forEach(function (o) {
                o = o.value;
                if (o.type !== 'script') return;

                let oo = {
                    isFile: true,
                    isGlobal: isGlobal(o),
                    common: o.common,
                    id: o._id,
                };
                if (typeof oo.common.mtime === 'string') {
                    oo.common.mtime = new Date(oo.common.mtime).getUnixTime();
                    soef.modifyObject(oo.id, {common: { mtime: oo.common.mtime }});
                }
                if (!oo.common.mtime || oo.common.mtime > now) {
                    oo.common.mtime = now;
                    soef.modifyObject(oo.id, {common: { mtime: now }});
                }
                if (reSettings.test(o._id)) {
                    oo.isSettings = true;
                    settingsFound = true;
                }
                addoo(oo);
            });

            if (!settingsFound) {
                addSettings();
            }

            scripts = scripts.sort(function (a, b) {
                if (a.id > b.id) return 1;
                if (a.id < b.id) return -1;
                return 0;
            });

            function ext(o) {
                if (o.isFile !== true) return '';
                return o.isSettings ? '.json' : '.js';
            }

            function buildFilename(o) {
                let fn = o.id.remove(reScriptJs).replace(/\./g, path.sep);
                if (o.common && o.common.name) fn = fn.replace(/([^\\/]+?)$/, o.common.name);
                return fn + ext(o);
            }

            function add(o) {
                ids[o.id] = o;
                fns[o.fn] = o;
            }

            scripts.forEach(function (o, i) {
                let id, path;
                id = o.id; //replace(/(.*)\..*?$/, '$1');
                o.fn = o.fn || buildFilename(o); //o.id.replace(reScriptJs, '').replace(/\./g, '\\') + '.js';
                path = o.fn; //id.replace(reScriptJs, '').replace(/\./g, '\\') || '\\';
                add(o);
                if (ids[id] === undefined) {
                    let newo = {id: id, fn: path, isFile: false, dirs: []};
                    add(newo);
                    let oo = soef.getProp(objs, id.replace(reScriptJsDot, '')) || objs;
                    if (oo) Object.getOwnPropertyNames(oo).forEach(function (n) {
                        newo.dirs.push(path.sep + n + ext(oo[n]));
                    });
                    newo.dirs.sort();
                }
            });

            self.globalScript = self.globalScript.slice(0, -1) + GLOBALSCRIPT_SUFIX + '\n';
            callback && callback();
        });
    };

    let getmtime = function (fn, common) {
        let stat = soef.lstatSync(adapter.config.rootDir.fullFn(fn));
        if (stat && stat.mtime) {
            common.mtime = stat.mtime.getUnixTime();
            adapter.log.debug('getmtime: ' + stat.mtime.toJSON());
        }
    };

    this.removeGlobalScript = function (source) {
        let ar = reGlobalScriptMagic.exec(source);
        if (!ar || ar.length < 2) return source;
        return ar[1];
    };


    this.create = function (path, data, mtime, callback) {
        if (typeof mtime === 'function') {
            callback = mtime;
            mtime = undefined;
        }
        let name = path.replace(/^[\\\/](.*)\..+?$/, '$1');   // führenden BS und Extension entfernen
        let id = 'script.js.' + normalizedName(name);
        name = name.justFilename();                           // only filename
        id = id.replace(/[\\/]/g, '.');

        let obj = {
            type: 'script',
            common: {
                engineType: "Javascript/js",
                engine: "system.adapter.javascript.0",
                debug: false,
                verbose: false,
                name: name,
                enabled: false,
                source: self.removeGlobalScript(data),
                mtime: mtime
            },
            native: {}
        };

        if (!mtime) getmtime(path, obj.common);
        adapter.log.debug('create New Object: ' + id);
        adapter.setForeignObjectNotExists(id, obj, function (err, _obj) {
            if (!err && _obj) return self.read(callback);
            callback && callback(err);
        });
    };

    this.change = function (fn, source, mtime, callback) {
        if (typeof mtime === 'function') {
            callback = mtime;
            mtime = undefined;
        }
        if (adapter.config.disableWrite) return callback && callback (new Error ('EACCES: permission denied'));
        let obj = this.fn2obj(fn);

        adapter.log.debug('scripts.change: saving to ioBroker. fn=' + fn + ' mtime=' + (new Date(mtime*1000).toJSON()));

        source = source.toString();
        if (!obj || obj.isSettings === 'create') {  // create new file
            return this.create (fn, source, mtime, callback);
        }

        if (!obj.common || (obj.common.source === source && obj.common.mtime === mtime)) return callback && callback();

        obj.common.source = source;
        obj.common.mtime = mtime;

        if (!obj.isGlobal || !adapter.config.useGlobalScriptAsPrefix) {
            source = this.removeGlobalScript (source);
            if (source === false) return callback && callback (new Error ('missing global script prefix'));
        }
        if (obj.isSettings) {
            try {
                let json = JSON.parse (source);
                if (json) configChanged (json.config || json);
            } catch (e) {
            }
        }

        let oldEnabled, id = obj.id;  // oldEnabled is already not true
        if (id.indexOf(path.sep) >= 0) {
            adapter.log.error('invalid id: ' + id);
            return;
        }
        soef.modifyObject(id, function (o) {
            o.common.source = source;
            o.common.mtime = mtime;
            obj.common.source = source;
            obj.common.mtime = mtime;
            if (!mtime) getmtime (fn, o.common);
            if (adapter.config.restartScript) {
                oldEnabled = o.common.enabled;
                o.common.enabled = false;
            }
        }, function (err, o) {
            if (!oldEnabled) return callback && callback (null);
            self.enable(id, true, function (err, o) {
                callback && callback (null);
            })
        });
        if (obj.isGlobal) {
            self.read();
        }
    };

    this.enable = function enableScript(id, val, callback) {
        soef.modifyObject(id, {common: {enabled: val}}, callback);
    };

    this.restart = function restartScript(id, callback) {
        self.enable(id, false, function (err, obj) {
            if (err) return callback && callback(err);
            setTimeout(function () {
                self.enable(id, true, callback);
            })
        });
    }

};


function configChanged(config) {
    let oldConfig = soef.clone(adapter.config);
    Object.assign(adapter.config, config);

    if (oldConfig.useGlobalScriptAsPrefix !== adapter.config.useGlobalScriptAsPrefix) {
        scripts.read(function () {
        });
    }
}


function fn2id(fn) {
    let id = fn.remove(/^[\\/]/).noext().replace(/[\\\/]/g, '.').replace(/ /g, '_');
    return 'script.js.' + id;
}

let files = [];

function readAll(startDir) {

    function readAllFiles (rootDir) {
        (soef.readdirSync (rootDir) || []).forEach ((fn) => {
            let fullfn = rootDir.fullFn (fn);
            let stat = soef.lstatSync (fullfn);
            if (stat && stat.isDirectory()) {
                return readAllFiles (fullfn);
            }

            let oo = {
                id: fn2id (fullfn.withoutRoot()),
                fullfn: fullfn,
                fn: fullfn.substr(startDir.length),
                mtime: stat.mtime.getUnixTime(),
                size: stat.size,
            };
            files.push (oo);
        });
    }

    readAllFiles(startDir);
}


function writeFile(fn, data, mtime) {
    if (!fn) return;
    adapter.log.debug('writeFile: fn=' + fn + ' mtime=' + (new Date(mtime*1000).toJSON()));
    let filePath = fn.justPathname();
    if (!soef.existDirectory(filePath)) {
        let ar = filePath.split (path.sep);
        let s = '';
        if (ar) ar.forEach ((n, i) => {
            if (i > 0) s += path.sep;
            s += n;
            if (!soef.existDirectory(s)) {
                adapter.log.debug('createDirectory: ' + s);
                soef.mkdirSync (s);
            }
        });
    }
    try {
        let fd = fs.openSync(fn, 'w');
        if (fd) {
            watcher.ignore(fn);
            fs.writeSync(fd, data);
            if (mtime) {
                watcher.ignore(fn);
                fs.futimesSync(fd, mtime, mtime);
            }
            fs.closeSync(fd);
        }
    } catch (e) {
    }
}

function getFileObject(fn) {
    let obj = { };
    let stat = soef.lstatSync(fn);
    obj.source = soef.readFileSync(fn);
    if (obj.source) obj.source = obj.source.toString();
    obj.mtime = stat.mtime.getUnixTime();
    adapter.log.debug('getFileObject: mtime=' + stat.mtime.toJSON());
    return obj;
}


let watcher = {
    handle: null,
    cnt: 0,
    timer: soef.Timer(),
    //list: [],
    close: function() {
        if (this.handle) {
            this.handle.close();
            this.handle = null;
        }
    },
    ignore: function(fn) {
        this.cnt += 1;
        adapter.log.debug('watcher.ignore cnt=' + this.cnt);
        this.timer.set(function () {
            this.cnt = 0;
            adapter.log.debug('watcher.ignore: reset ignore cnt');
        }.bind(this), 1000);
        //this.list.push(fn);
    },
    run: function () {
        let self = this, initialScanComplete;
        this.close();
        //this.handle = fs.watch(adapter.config.rootDir, { recursive: true }, function (eventType, filename) {
        this.handle = chokidar.watch(adapter.config.rootDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true
        }). on('ready', function () {
            initialScanComplete = true;
        }). on('all', function (eventType, fullfn, details) {
            if (!initialScanComplete) return;
            if (self.cnt) {
                self.cnt -= 1;
                adapter.log.debug('watcher.run: event ignored! cnt=' + self.cnt + ' - ' + eventType + ' - ' + fullfn);
                return;
            }

            if (eventType === 'addDir') {
                adapter.log.debug('watcher.run: ' + eventType + ' - ' + fullfn + ' type ignored');
                return;
            }
            //jetbrians temp filename: \global\Global_global.js___jb_tmp___
            if (!fullfn || !/\.js$|\.json$/.test(fullfn)) {
                adapter.log.debug('watcher.run: ' + eventType + ' - ' + fullfn + ' ignored');
                return;
            }
            adapter.log.debug('watcher.run: ' + eventType + ' - ' + fullfn);

            let filename = fullfn.withoutRoot();
            if (filename[0] !== path.sep) filename = path.sep + filename;
            let file = getFileObject(fullfn);
            if (!file || file.source === false) {
                adapter.log.debug('watcher.run: ' + eventType + ' - ' + filename + ' ignored, because file not existing ');
                return;
                //return scripts.delete(filename);
            }
            // if (file.source === '') {
            //     adapter.log.debug('watcher.run: ' + eventType + ' - ' + filename + ' ignored, because file empty');
            //     return;
            // } else {
            let obj = scripts.fn2obj(filename);
            if (obj && eventType === 'add') {
                adapter.log.debug('watcher.run: ' + eventType + ' - ' + filename + ' ignored, because already exists');
                return;
            }
            if (eventType === 'unlink') {
                adapter.log.debug('watcher.run: ' + eventType + ' - ' + filename + ' ignored, because unlink not yet supported');
                return;
            }

            let cmdRes = file.source.match(/^[\/\s]*!!([\S]*)/);
            let cmd = '';
            if (cmdRes && cmdRes[1]) cmd = cmdRes[1];
            let ar = cmd.match(/^(.*?)=(.*?)$/);
            if (ar && ar[1]) cmd = ar[1];

            // let param, [, cmd] = file.source.match(/^[\/\s]*!!([\S]*)/) || emptyArray;
            // if (cmd && cmd.indexOf('=') >= 0) [, cmd, param] = cmd.match(/^(.*?)=(.*?)$/) || emptyArray;

            switch (cmd) {
                // case 'log':
                //     logFilter = ar[2];
                //     if (logFilter === 'this' || logFilter === 'self') logFilter = filename.noext();//replace(/\\(.*?).js$/, '$1');
                //     logTimer.set(copyLog, 500);
                //     return;
                case 'enable':
                    soef.modifyObject(obj.id, { common: { enabled: true }});
                    return;
                case 'disable':
                    soef.modifyObject(obj.id, { common: { enabled: false }});
                    return;
                case 'debug':
                case 'insertGlobalScript':
                    file.source = file.source.remove(/^[^\n^\r]*[\n\r]*/);
                    adapter.log.debug('changed: insertGlobalScript! ' + filename);
                    writeFile(filename.fullFn(), scripts.globalScript + file.source);
                    return;

                case 'reload':
                    if (!obj) return;
                    adapter.getForeignObject(obj.id, function (err, o) {
                        if (err || !o) return;
                        obj.common = o.common;
                        writeFile(filename.fullFn(), o.common.source, o.common.mtime);
                    });
                    break;

                default:
                    scripts.change(filename, file.source, file.mtime);
                    break;
            }
            //}
        });
    },
    restart: this.run
};


function start(restartCount) {
    adapter.log.debug('start:');
    ignoreObjectChange = true;
    scripts.read(function () {
        files.length = 0;
        readAll (adapter.config.rootDir);
        let rescanRequired = false, i=files.length, fids = {};

        (function doIt() {

            if (i <= 0) {
                if (rescanRequired && !restartCount) {
                    return setTimeout(start, 0, (restartCount||0)+1);
                }
                scripts.scripts.forEach ((o) => {
                    let fo = fids[o.id];
                    if (!fo || fo.mtime < o.common.mtime) {
                        let fullfn = adapter.config.rootDir.fullFn (o.fn);
                        writeFile (fullfn, o.common.source, o.common.mtime);
                    }
                });
                setTimeout(function() {
                    watcher.run ();
                }, 1000);
                ignoreObjectChange = false;
                return;
            }

            let o = files[--i];
            fids[o.id] = o;
            let obj = scripts.fn2obj (o.fn);
            if ((!obj || obj.common.mtime < o.mtime) && o.fullfn.endsWith ('.js')) {  // at first only files, no directories
                if (!obj) rescanRequired = true;
                let fobj = getFileObject (o.fullfn);
                scripts.change (o.fn, fobj.source, fobj.mtime, doIt);
            } else {
                setTimeout(doIt, 0);
            }
        })();
    })
}

//var windows1252 = require('windows-1252');

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function spawn(exe, command, onLine, callback) {
    let args = command.split(' ');
    let node = child_process.spawn(exe, args);

    function action(device, data) {
        if (!callback) return;
        if (typeof data !== 'string') data = data.toString();
        data.replace(/\r\n/g, '\n').split('\n').forEach(function (line) {
            let ret = onLine(device, data.replace(/[\r|\n]*$/, ''));
            if (ret !== undefined) {
                if (ret !== false) callback && callback(ret);
                callback = null;
            }
        });
    }

    node.stdout.on('data', action.bind(1, 'stdout'));
    node.stderr.on('data', action.bind(1, 'stderr'));
    node.on('close', function (code) {
        callback && callback(code, 'close');
        callback = null;
    });
    return node;
}

function startJavascriptAdapterInDebugMode(callback) {
    let nodeModulesPath = __dirname.replace(/\\/g, '/').remove(/([^\/]*?)$/);
    let nodeExe = process.argv[0] || 'node';
    const args = '--harmony --debug --expose_debug_as=v8debug ' + nodeModulesPath + 'iobroker.javascript/javascript.js --force';
    let node = spawn(nodeExe, args,
        function onLine(device, line) {
            let ar = /^Debugger listening on \[\:\:\]\:([0-9]+)/.exec(line);
            adapter.log.info(device + ': ' + line);
            if (ar && ar.length >= 2) {
                adapter.log.info('port: ' + ar[1]);
                return ~~ar[1];
            }
        },
        callback
    );
}


function checkRunnningInDebugmode(callback) {
    const execCmd = 'Get-WmiObject Win32_Process -Filter "name=\'node.exe\'"|Select-Object CommandLine';
    const setBufferSize = '$pshost=get-host;$pswindow=$pshost.ui.rawui;$newsize=$pswindow.buffersize;$newsize.height=3000;$newsize.width=200;$pswindow.buffersize=$newsize;';
    let args = (setBufferSize + execCmd).split(' ');
    let node = child_process.spawn('powershell', args);
    node.stdout.on('data', function (data) {
        if (!callback) return;
        if (typeof data !== 'string') data = data.toString();
        data = data.replace(/[\r|\n]*$/, '').replace(/\r\n/g, '\n');
        data.split('\n').forEach(function (line) {
            adapter.log.debug(line.slice(0, -1));
            if (/^.*--debug --expose.*iobroker.javascript\/javascript\.js --force/.test(line)) {
                callback && callback(true);
                callback = null;
            }
        });
    });

    node.stderr.on('data', function (data) {
        if (typeof data !== 'string') data = data.toString();
        data = data.replace(/[\r|\n]*$/, '');
        let ar = data.split('\r\n');
    });

    node.on('close', function (code) {
        callback && callback(false);
        callback = null;
    });
}

function stopJavascriptAdapter(callback) {
    soef.modifyObject('system.adapter.javascript.0', {common: {enabled: false}}, function (err, obj) {
        callback && callback(err, obj);
    });
}

function checkJavascriptAdapter(callback) {
    checkRunnningInDebugmode(function (isDebug) {
        if (isDebug) return callback && callback('already running in debug mode');
        stopJavascriptAdapter(function (err, obj) {
            startJavascriptAdapterInDebugMode(callback);
        });
    });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function normalizeConfig(config) {
    config.rootDir = config.rootDir.remove(/[\\/]$/);
    if (config.port === undefined) config.port = 21;
    if (config.useGlobalScriptAsPrefix === undefined) config.useGlobalScriptAsPrefix = true;
    if (config.restartScript === undefined) config.restartScript = true;
    if (config.disableWrite === undefined) config.disableWrite = false;
}


function main() {

    soef.switchToDebug(true);

    normalizeConfig(adapter.config);
    if (!adapter.config.rootDir) return;

    //startJavascriptAdapterInDebugMode();

    rootDir = adapter.config.rootDir;

    //checkJavascriptAdapter(function (runningPort) {
    scripts = Scripts();
    start();

    adapter.subscribeStates('*');
    adapter.subscribeForeignObjects('script.js.*');
    //});
}
