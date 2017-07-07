var coffee = require('coffee-script');
var convert = require('convert-source-map');
var path = require('path');
var through = require('through2');
var md5 = require('md5');
var fs = require('fs-jetpack');
var COFFEE_CACHE_DIR = process.env.COFFEE_CACHE_DIR ? path.resolve(process.env.COFFEE_CACHE_DIR) : path.join(__dirname,'.cache');
fs.dir(COFFEE_CACHE_DIR);

var filePattern = /\.((lit)?coffee|coffee\.md)$/;

function isCoffee (file) {
    return filePattern.test(file);
}

function isLiterate (file) {
    return (/\.(litcoffee|coffee\.md)$/).test(file);
}

function ParseError(error, src, file) {
    /* Creates a ParseError from a CoffeeScript SyntaxError
       modeled after substack's syntax-error module */
    SyntaxError.call(this);

    this.message = error.message;

    this.line = error.location.first_line + 1; // cs linenums are 0-indexed
    this.column = error.location.first_column + 1; // same with columns

    var markerLen = 2;
    if(error.location.first_line === error.location.last_line) {
        markerLen += error.location.last_column - error.location.first_column;
    }
    this.annotated = [
        file + ':' + this.line,
        src.split('\n')[this.line - 1],
        Array(this.column).join(' ') + Array(markerLen).join('^'),
        'ParseError: ' + this.message
    ].join('\n');
}

ParseError.prototype = Object.create(SyntaxError.prototype);

ParseError.prototype.toString = function () {
    return this.annotated;
};

ParseError.prototype.inspect = function () {
    return this.annotated;
};

function compile(filename, source, options, callback) {
    var compiled, hash, cachedFile, cachedMap, cachedContent;
    try {
        hash = md5(source);
        cachedFile = path.join(COFFEE_CACHE_DIR, hash+'.js');
        cachedMap = path.join(COFFEE_CACHE_DIR, hash+'-map.js');
        
        if (fs.exists(cachedFile) && (!options.sourceMap || fs.exists(cachedMap))) {
            cachedContent = fs.read(cachedFile)
            
            if (options.sourceMap) {
                compiled = {
                    js: cachedContent,
                    v3SourceMap: fs.read(cachedMap)
                };
            } else {
                compiled = cachedContent;
            }
        } else {
            compiled = coffee.compile(source, {
                sourceMap: options.sourceMap,
                inline: true,
                bare: options.bare,
                header: options.header,
                literate: isLiterate(filename)
            });
            
            if (options.sourceMap) {
                fs.write(cachedFile, compiled.js);
                fs.write(cachedMap, compiled.v3SourceMap);
            } else {
                fs.write(cachedFile, compiled);
            }
        }
    } catch (e) {
        var error = e;
        if (e.location) {
            error = new ParseError(e, source, filename);
        }
        callback(error);
        return;
    }

    if (options.sourceMap) {
        var map = convert.fromJSON(compiled.v3SourceMap);
        var basename = path.basename(filename);
        map.setProperty('file', basename.replace(filePattern, '.js'));
        map.setProperty('sources', [basename]);
        map.setProperty('sourcesContent', [source]);
        callback(null, compiled.js + '\n' + map.toComment() + '\n');
    } else {
        callback(null, compiled + '\n');
    }

}

function coffeeify(filename, options) {
    if (!isCoffee(filename)) return through();

    if (typeof options === 'undefined' || options === null) options = {};

    var compileOptions = {
        sourceMap: (options._flags && options._flags.debug),
        bare: true,
        header: false
    };

    for (var i = 0, keys = Object.keys(compileOptions); i < keys.length; i++) {
        var key = keys[i], option = options[key];
        if (typeof option !== 'undefined' && option !== null) {
            if (option === 'false' || option === 'no' || option === '0') {
                option = false;
            }
            compileOptions[key] = !!option;
        }
    }

    var chunks = [];
    function transform(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
    }

    function flush(callback) {
        var stream = this;
        var source = Buffer.concat(chunks).toString();
        compile(filename, source, compileOptions, function(error, result) {
            if (!error) stream.push(result);
            callback(error);
        });
    }

    return through(transform, flush);
}

coffeeify.compile = compile;
coffeeify.isCoffee = isCoffee;
coffeeify.isLiterate = isLiterate;

module.exports = coffeeify;
