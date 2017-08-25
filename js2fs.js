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
    reGlobalScriptMagic = new RegExp ('^[\\s|\\S]*' + GLOBALSCRIPT_MAGIC.replace(/\-/g, '\\-') + '.*?\\r?\\n([\\s|\\S]*)')

;

let noext, killext, ignoreObjectChange, scripts;
let reRootDir, logFilter, copyLog;
let logTimer = soef.Timer();

noext = killext = function (fn) {
    return fn.noext(); //fn.replace(/\.[^.]*?$/, '');
};
function justPathname(fn) {
    //return fn.replace(/(.*)\\.*?$/, '$1');
    return fn.justPathname();
}
String.prototype.fullFn = function (fn) {
    if (!fn) return adapter.config.rootDir.fullFn(this);
    //if (/^\\\\|^.\:\\/.test(fn) || fn.substring(0,1) === '/') return fn;
    //if (path.isAbsolute(fn)) return fn;
    if (fn.substring(adapter.config.rootDir) === 0) return fn;
    return path.normalize(path.join(this, fn)); // (this + '\\' + fn).replace(/[\\]{2,}/g, '\\');
};
String.prototype.remove = function (regex) {
    return this.replace(regex, '');
};
String.prototype.noext = function () {
    //return this.replace(/\.[^.]*?$/, '');
    let fn = this;
    let ext = path.extname(fn);
    if (ext.length > 0) {
        fn = fn.substring(0,fn.length-ext.length);
    }
    return fn; //fn.replace(/\.[^.]*?$/, '');
};
String.prototype.justPathname = function () {
    //return this.replace(/(.*)\\.*?$/, '$1');
    //return this.replace(/\\[^\\]*?$/, '');
    if (this.noext() === this) return this;
    return path.dirname(this);
};
String.prototype.withoutRoot = function () {
    if (this.indexOf(reRootDir) === 0) return this.substring(reRootDir.length);
    //return this.replace(reRootDir, '');
    return this;
};
String.prototype.toFn = String.prototype.toFilename = String.prototype.id2fn = function () {
    let ext = reSettings.test(this) ? '.json' : '.js';
    let fn = this.remove(reScriptJsDot);
    let fnArr = fn.split('.');
    fn = pathJoinArr(fnArr); //.replace(/\./g, '\\');
    //let ret = adapter.config.rootDir.fullFn(this.remove(reScriptJsDot).replace(/\./g, '\\'));
    //ret += '.js';
    return adapter.config.rootDir.fullFn(fn + ext);
};

Date.prototype.getUnixTime = Date.prototype.getCTime = function () {
    //return parseInt(this.getTime() / 1000);
    return ~~(this.getTime() / 1000);
};

function pathJoinArr(arr) {
    let res = '';
    arr.forEach(function(element) {
        res = path.join(res, element);
    });
    return res;
}

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

function saveToFile(id, source, mtime) {
    let fn = id.toFn();
    adapter.log.debug('saveToFile: ' + fn);
    writeFile(fn, source, mtime);
}

function deleteFile(id) {
    let dn, fn = id.toFn();
    adapter.log.debug('deleteFile: ' + fn);
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
    adapter.log.debug('onObjectChange: ' + id + ' object=' + object);

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
    saveToFile(id, object.common.source, mtime);
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
                let fn = o.id.remove(reScriptJsDot);
                let fnArr = fn.split('.');
                return path.sep + pathJoinArr(fnArr) + ext(o);
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
            adapter.log.debug('get mtime: ' + stat.mtime.getUnixTime());
            common.mtime = stat.mtime.getUnixTime();
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
        let id = fn2id(path);//path.replace(/^[\\\/](.*)\..+?$/, '$1').replace(/\\/g, '.');
        let name = id.remove(reScriptJsDot); //'script.js.' + normalizedName(name);
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
        adapter.log.debug('found Object for fn ' + fn + ': ' + JSON.stringify(obj));

        source = source.toString();
        if (!obj || obj.isSettings === 'create') {  // create new file
            return this.create (fn, source, mtime, callback);
        }

        if (!obj.common || obj.common.source === source) return callback && callback();

        // if (/^insertGlobalScript![\s]*/.test(source)) {
        //     source = source.remove(/^insertGlobalScript![\s]*/);
        //     adapter.log.debug('changed: insertGlobalScript! ' + fn);
        //     writeFile(fn.fullFn(), self.globalScript + source);
        //     return;
        //     //(adapter.config.useGlobalScriptAsPrefix && !obj.isGlobal && !obj.isSettings ? scripts.globalScript : '') + obj.value.common.source
        //
        //     if (obj.common.source === source) return callback && callback();
        // }


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

        let oldEnabled = false; // INIT??
        let id = obj.id;
        if (id.indexOf(path.sep) >= 0) {
            adapter.log.error('invalid id: ' + id);
            return;
        }
        soef.modifyObject(id, function (o) {
            o.common.source = source;
            //obj.common.source = source;
            if (mtime) o.common.mtime = mtime;
                else getmtime(fn, o.common);
            if (adapter.config.restartScript) {
                oldEnabled = o.common.enabled;
                o.common.enabled = false;
            }
        }, function (err, o) {
            if (!oldEnabled) return callback && callback (null);
            self.enable(id, true, function (err, o) {
                callback && callback (null);
            });
        });
    };

    this.enable = function enableScript(id, val, callback) {
        soef.modifyObject(id, {common: {enabled: val}}, callback);
    };

    this.restart = function restartScript(id, callback) {
        self.enable(id, false, function (err, obj) {
            if (err) return callback && callback(err);
            setTimeout(function () {
                self.enable(id, true, callback);
            });
        });
    };

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
    let id = fn.noext().split(path.sep).join('.');
    if (id.substring(0,1) === '.') id = id.substring(1);
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
    let filePath = justPathname(fn);
    adapter.log.debug('writeFile: ' + fn);
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
        //fs.writeFileSync (fn, data);
    } catch (e) {
    }
}

function getFileObject(fn) {
    let obj = { };
    let stat = soef.lstatSync(fn);
    obj.source = soef.readFileSync(fn);
    if (obj.source) obj.source = obj.source.toString();
    obj.mtime = stat.mtime.getUnixTime();
    adapter.log.debug('mtime of FileObject ' + stat.mtime);
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
    // get ignore() {
    //     if (this.cnt) {
    //         this.cnt -= 1;
    //         return true;
    //     }
    //     return false;
    // },
    // set ignore(fn) {
    //     this.cnt += 1;
    // },
    ignore: function(fn) {
        this.cnt += 1;
        adapter.log.debug('watcher: ignore cnt=' + this.cnt);
        this.timer.set(function () {
            this.cnt = 0;
            adapter.log.debug('watcher: reset ignore cnt');
        }.bind(this), 1000);
        //this.list.push(fn);
    },
    run: function () {
        let self = this;
        this.close();
        //this.handle = fs.watch(adapter.config.rootDir, { recursive: true }, function (eventType, filename) {
        this.handle = chokidar.watch(adapter.config.rootDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true
        }). on('all', function (eventType, filename, details) {
            if (self.cnt) {
                self.cnt -= 1;
                adapter.log.debug('watch: event ignored! cnt=' + self.cnt + ' - ' + eventType + ' - ' + filename);
                return;
            }

            if (eventType === 'addDir') {
                adapter.log.debug('watch: ' + eventType + ' - ' + filename + ' type ignored');
                return;
            }
            //jetbrians temp filename: \global\Global_global.js___jb_tmp___
            if (!filename || !/\.js$|\.json$/.test(filename)) {
                adapter.log.debug('watch: ' + eventType + ' - ' + filename + ' ignored');
                return;
            }
            adapter.log.debug('watch: ' + eventType + ' - ' + filename);

            let fullfn = filename;
            if (filename.indexOf(adapter.config.rootDir) === 0) filename = filename.substring(adapter.config.rootDir.length);
            if (filename[0] !== path.sep) filename = path.sep + filename;
            let file = getFileObject(fullfn);
            if (!file || file.source === false) {
                //return scripts.delete(filename);
            } else {
                let obj = scripts.fn2obj(filename);
                if (obj && eventType === 'add') {
                    adapter.log.debug('watch: ' + eventType + ' - ' + filename + ' ignored, because already exists');
                    return;
                }
                let cmdRes = file.source.match(/^[\/\s]*!!([\S]*)/);
                let cmd = '';
                if (cmdRes && cmdRes[1]) cmd = cmdRes[1];
                let ar = cmd.match(/^(.*?)=(.*?)$/);
                if (ar && ar[1]) cmd = ar[1];
                switch (cmd) {
                    case 'log':
                        logFilter = ar[2];
                        if (logFilter === 'this' || logFilter === 'self') logFilter = filename.noext();//replace(/\\(.*?).js$/, '$1');
                        logTimer.set(copyLog, 500);
                        return;
                    case 'enable':
                        soef.modifyObject(obj.id, { common: { enabled: true }});
                        return;
                    case 'disable':
                        soef.modifyObject(obj.id, { common: { enabled: false }});
                        return;
                    case 'debug':
                    case 'insertGlobalScript':
                        //file.source = file.source.remove(/^insertGlobalScript![\s]*/);
                        file.source = file.source.remove(/^[^\n^\r]*[\n\r]*/);
                        adapter.log.debug('changed: insertGlobalScript! ' + filename);
                        writeFile(filename.fullFn(), scripts.globalScript + file.source);
                        return;
                    //(adapter.config.useGlobalScriptAsPrefix && !obj.isGlobal && !obj.isSettings ? scripts.globalScript : '') + obj.value.common.source

                    case 'reload':
                        if (!obj) return;
                        adapter.getForeignObject(obj.id, function (err, o) {
                            if (err || !o) return;
                            obj.common = o.common;
                            writeFile(filename.fullFn(), o.common.source, o.common.mtime);
                        });
                        break;

                    default:
                        adapter.log.debug('file changed ' + filename);
                        scripts.change(filename, file.source, file.mtime);
                        break;
                }
            }
        });
    },
    restart: this.run
};


function start() {
    adapter.log.debug('start:');
    ignoreObjectChange = true;
    scripts.read(function () {
        files.length = 0;
        readAll (adapter.config.rootDir);
        let fids = {};
        files.forEach ((o) => {
            fids[o.id] = o;
            let obj = scripts.fn2obj (o.fn);
            if (!obj || obj.common.mtime < o.mtime) {
                //scripts.create();
                return;
            }
            if (obj.common.mtime > o.mtime) {
            }
        });
        Object.keys (scripts.fns).forEach ((o) => {
        });
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
    });
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
    config.rootDir = config.rootDir; //.remove(/\\$/);
    if (config.port === undefined) config.port = 21;
    if (config.useGlobalScriptAsPrefix === undefined) config.useGlobalScriptAsPrefix = true;
    if (config.restartScript === undefined) config.restartScript = true;
    if (config.disableWrite === undefined) config.disableWrite = false;
}


function watchLog () {
    if (!adapter.config.ioBrokerRootdir) return;
    let date = new Date();
    let fn = path.join(adapter.config.ioBrokerRootdir, 'log', soef.sprintf('iobroker.%d-%02d-%02d.log', date.getFullYear(), date.getMonth()+1, date.getDate()));

    fs.watchFile(fn, (curr, prev) => {
        copyLog();
    });

    copyLog = function () {
        adapter.log.debug('copyLog: fn=' + fn);
        try {
            let stat = fs.lstatSync(fn);
            let f = fs.openSync(fn, 'r', 0o666);
            let buf = new Buffer(40000);
            let pos = stat.size > buf.length ? stat.size - buf.length : 0;
            fs.readSync(f, buf, 0, buf.length, pos);
            let ar = buf.toString().split('\r\n');
            for (let i = ar.length - 1; i >= 0; i--) {
                if (ar[i].indexOf('javascript.0 script.js') < 0 || (logFilter && ar[i].indexOf(logFilter) < 0)) {
                    ar.splice(i, 1);
                    continue;
                }
                let a = ar[i].match(/^20[\d]{2,2}-[\d]{2,2}-[\d]{2,2} (.*?) - .*?(warn|info|error).*?javascript\.0 script\.js\.(.*?): (.*)/);
                ar[i] = soef.sprintf('%s%-7s%-30.30s %s', a[1], a[2], a[3], a[4]);
            }
            ar = ar.reverse();
            fs.writeFileSync(adapter.config.rootDir + '/iobroker.log', ar.join('\r\n'));
            adapter.log.info(ar[0]);

        } catch (e) {
            let i = e;
        }
    };
}


function main() {

    soef.switchToDebug(true);

    normalizeConfig(adapter.config);
    watchLog();
    if (!adapter.config.rootDir) return;

    //startJavascriptAdapterInDebugMode();

    reRootDir = adapter.config.rootDir; //.replace(/\\/g, '\\\\').replace(/\:/g, '\:') + '\\\\', '');

    //checkJavascriptAdapter(function (runningPort) {
    scripts = Scripts();
    start();

    adapter.subscribeStates('*');
    adapter.subscribeForeignObjects('script.js.*');
    //});
}
