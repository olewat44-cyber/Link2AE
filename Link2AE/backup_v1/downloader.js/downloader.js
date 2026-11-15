/*
 * Link2AE - downloader.js
 *
 * Downloads an image from an arbitrary HTTP/HTTPS URL and stores it in the
 * Link2AE cache folder inside the user's directory. Runs inside the CEP 6
 * (After Effects CC 2017) panel using Node.js, which is enabled through the
 * manifest's CEFCommandLine flags (--enable-nodejs --mixed-context).
 *
 * IMPORTANT compatibility notes:
 *   - CEP 6.1 ships IO.js 1.2.0 (Node-WebKit 0.12.1). This file therefore
 *     uses ONLY ES5 syntax. No let/const/arrow functions/template literals.
 *   - fs.mkdirSync has NO {recursive:true} option in this runtime, so we
 *     create directories level-by-level.
 *   - Using Node's http/https avoids all browser CORS restrictions, which is
 *     exactly why we prefer it over XHR for a real downloader.
 */

(function (global) {
    "use strict";

    // Load Node modules defensively. If Node.js is not enabled in the CEP host,
    // we still want this file to load so the panel UI can show a helpful message
    // instead of failing to parse.
    var nodeReady = false;
    var http, https, urlModule, fs, path, os;
    try {
        if (typeof require === "function") {
            http = require("http");
            https = require("https");
            urlModule = require("url");
            fs = require("fs");
            path = require("path");
            os = require("os");
            nodeReady = !!(http && https && urlModule && fs && path);
        }
    } catch (e) {
        nodeReady = false;
    }

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    // Maximum allowed download size (bytes). 100 MB is generous for images.
    var MAX_BYTES = 100 * 1024 * 1024;

    // Follow at most this many HTTP redirects before giving up.
    var MAX_REDIRECTS = 5;

    // Per-request timeout in milliseconds.
    var TIMEOUT_MS = 30000;

    // Allowed image extensions.
    var SUPPORTED_EXT = {
        "jpg": true, "jpeg": true, "png": true,
        "gif": true, "bmp": true, "webp": true
    };

    // Maps a Content-Type to a canonical extension.
    var CONTENT_TYPE_EXT = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/bmp": "bmp",
        "image/x-ms-bmp": "bmp",
        "image/webp": "webp"
    };

    // ---------------------------------------------------------------------
    // Cache directory helpers
    // ---------------------------------------------------------------------

    // Returns the user's home directory in a way that works on old IO.js.
    function getHomeDir() {
        // Prefer process.env which always exists in this runtime.
        if (process.env.USERPROFILE && process.env.USERPROFILE.length > 0) {
            return process.env.USERPROFILE; // Windows
        }
        if (process.env.HOME && process.env.HOME.length > 0) {
            return process.env.HOME; // macOS / Linux
        }
        // os.homedir() exists in IO.js 1.2 but guard just in case.
        try {
            if (typeof os !== "undefined" && os.homedir) {
                return os.homedir();
            }
        } catch (e) { /* ignore */ }
        return ".";
    }

    // Returns the Link2AE cache directory path (does not necessarily exist yet).
    function getCacheDir() {
        return path.join(getHomeDir(), "Link2AE", "cache");
    }

    // Recursively create a directory (ES5, no recursive option available).
    function mkdirpSync(dir) {
        if (fs.existsSync(dir)) {
            return;
        }
        var parent = path.dirname(dir);
        if (parent && parent !== dir) {
            mkdirpSync(parent);
        }
        try {
            fs.mkdirSync(dir);
        } catch (e) {
            if (!fs.existsSync(dir)) {
                throw e;
            }
        }
    }

    // Ensures the cache directory exists and returns it.
    function ensureCacheDir() {
        var dir = getCacheDir();
        mkdirpSync(dir);
        return dir;
    }

    // ---------------------------------------------------------------------
    // URL validation and parsing
    // ---------------------------------------------------------------------

    /**
     * Validates and normalizes a URL string.
     * Returns { ok: true, url: parsedUrlObject } or { ok: false, error: "..." }.
     * Only http and https protocols are allowed.
     */
    function validateUrl(rawUrl) {
        if (typeof rawUrl !== "string") {
            return { ok: false, error: "URL harus berupa teks." };
        }
        var trimmed = rawUrl.trim();
        if (trimmed.length === 0) {
            return { ok: false, error: "URL kosong. Masukkan URL gambar." };
        }
        if (/\s/.test(trimmed)) {
            return { ok: false, error: "URL tidak boleh mengandung spasi." };
        }

        var parsed = urlModule.parse(trimmed);
        if (!parsed.protocol || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
            return { ok: false, error: "Hanya protokol HTTP dan HTTPS yang diizinkan." };
        }
        if (!parsed.hostname) {
            return { ok: false, error: "URL tidak memiliki host yang valid." };
        }
        return { ok: true, url: parsed, original: trimmed };
    }

    // Derives a file extension (lowercased, no dot) from a URL path.
    function extFromUrlPath(parsed) {
        if (!parsed || !parsed.pathname) {
            return null;
        }
        // Strip query string (already separated) and take the basename.
        var base = path.basename(parsed.pathname);
        var dot = base.lastIndexOf(".");
        if (dot === -1 || dot === base.length - 1) {
            return null;
        }
        var ext = base.slice(dot + 1).toLowerCase();
        // Some servers append junk after the ext (e.g. .jpg:large). Keep only
        // a clean alphanumeric token of reasonable length.
        var match = ext.match(/^[a-z0-9]{1,5}/);
        if (!match) {
            return null;
        }
        ext = match[0];
        return SUPPORTED_EXT[ext] ? ext : null;
    }

    // Maps a Content-Type header value to an extension, or null.
    function extFromContentType(contentType) {
        if (!contentType) {
            return null;
        }
        var ct = contentType.split(";")[0].trim().toLowerCase();
        if (CONTENT_TYPE_EXT[ct]) {
            return CONTENT_TYPE_EXT[ct];
        }
        // Accept any image/* type only if we can map it; otherwise null.
        return null;
    }

    // ---------------------------------------------------------------------
    // Safe filename generation
    // ---------------------------------------------------------------------

    // Removes anything that is unsafe for a filename. Prevents path traversal
    // (no slashes, no dots-only) and control characters.
    function sanitizeBase(name) {
        if (typeof name !== "string") {
            name = "";
        }
        // Take only the last path segment and strip dangerous characters.
        name = name.replace(/\\/g, "/");
        name = name.split("/").pop();
        name = name.replace(/[^a-zA-Z0-9._-]/g, "_");
        // Prevent leading dots and dot-only names.
        name = name.replace(/^\.+/, "");
        if (name.length === 0) {
            name = "image";
        }
        return name;
    }

    // Builds a unique filename in the cache dir using timestamp + random.
    function buildUniqueName(dir, baseName, ext) {
        var d = new Date();
        var pad = function (n, w) {
            var s = String(n);
            while (s.length < w) { s = "0" + s; }
            return s;
        };
        var stamp = "" + d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) +
                    "_" + pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2);
        var rnd = Math.floor(Math.random() * 100000);
        var randStr = pad(rnd, 5);

        var cleanBase = sanitizeBase(baseName);
        // Drop an existing extension from the base so we don't get name.jpg.jpg
        var dot = cleanBase.lastIndexOf(".");
        if (dot > 0) {
            cleanBase = cleanBase.slice(0, dot);
        }

        var candidate = cleanBase + "_" + stamp + "_" + randStr + "." + ext;
        var full = path.join(dir, candidate);

        // Extremely unlikely collision, but guarantee uniqueness anyway.
        var counter = 1;
        while (fs.existsSync(full)) {
            candidate = cleanBase + "_" + stamp + "_" + randStr + "_" + counter + "." + ext;
            full = path.join(dir, candidate);
            counter++;
            if (counter > 1000) { break; }
        }
        return full;
    }

    // ---------------------------------------------------------------------
    // Core download engine
    // ---------------------------------------------------------------------

    /**
     * Downloads a single image URL to the cache directory.
     *
     * @param rawUrl   The image URL (may include a query string).
     * @param options  {
     *   onProgress: function(percent 0-100, receivedBytes, totalBytes),
     *   onStatus:   function(message)
     * }
     * @param done     function(err, result). result = {
     *   url, filePath, fileName, extension, bytes, contentType
     * } on success; err is an Error with a friendly .message on failure.
     */
    function downloadImage(rawUrl, options, done) {
        options = options || {};
        var onProgress = options.onProgress || function () {};
        var onStatus = options.onStatus || function () {};

        var check = validateUrl(rawUrl);
        if (!check.ok) {
            done(new Error(check.error));
            return;
        }

        var parsed = check.url;
        var originalUrl = check.original;

        // Pick an extension. We prefer the Content-Type later, but use the URL
        // path as an initial hint so we can name the temp file.
        var urlExt = extFromUrlPath(parsed);

        onStatus("Menghubungi server...");
        requestWithRedirects(parsed, originalUrl, 0, urlExt, onProgress, onStatus, done);
    }

    // Internal: performs the HTTP(S) request, following redirects.
    function requestWithRedirects(parsed, originalUrl, redirectCount, urlExt,
                                  onProgress, onStatus, done) {
        if (redirectCount > MAX_REDIRECTS) {
            done(new Error("Terlalu banyak redirect (maksimum " + MAX_REDIRECTS + ")."));
            return;
        }

        var isHttps = parsed.protocol === "https:";
        var client = isHttps ? https : http;

        var requestOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: (parsed.path || "/") + (parsed.search || ""),
            method: "GET",
            headers: {
                // A browser-like UA improves compatibility with servers that
                // reject unknown clients.
                "User-Agent": "Link2AE/1.0 (Adobe-AE-CEP)",
                "Accept": "image/*;q=0.9,*/*;q=0.8"
            }
        };

        var req;
        try {
            req = client.request(requestOptions, function (res) {
                handleResponse(res, originalUrl, redirectCount, urlExt,
                               onProgress, onStatus, done);
            });
        } catch (e) {
            done(new Error("Gagal membuat koneksi: " + e.message));
            return;
        }

        req.setTimeout(TIMEOUT_MS, function () {
            req.abort();
            done(new Error("Waktu tunggu habis (timeout) saat menghubungi server."));
        });

        req.on("error", function (e) {
            // Provide clearer messages for common network failures.
            var code = e && e.code ? e.code : "";
            if (code === "ENOTFOUND") {
                done(new Error("Host tidak ditemukan. Periksa URL atau koneksi internet."));
            } else if (code === "ECONNREFUSED") {
                done(new Error("Koneksi ditolak oleh server."));
            } else if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
                done(new Error("Koneksi timeout ke server."));
            } else {
                done(new Error("Kesalahan jaringan: " + (e.message || code)));
            }
        });

        req.end();
    }

    // Internal: handles the HTTP response, streams to a file, follows redirects.
    function handleResponse(res, originalUrl, redirectCount, urlExt,
                            onProgress, onStatus, done) {
        var status = res.statusCode || 0;

        // --- Handle redirects (3xx) ---
        if (status >= 300 && status < 400 && res.headers.location) {
            // Drain the response body before following.
            res.resume();
            var nextUrl = urlModule.resolve(originalUrl, res.headers.location);
            var parsedNext = validateUrl(nextUrl);
            if (!parsedNext.ok) {
                done(new Error("Redirect ke URL yang tidak valid."));
                return;
            }
            requestWithRedirects(parsedNext.url, nextUrl, redirectCount + 1, urlExt,
                                 onProgress, onStatus, done);
            return;
        }

        // --- Handle error statuses with clear messages ---
        if (status === 403) {
            done(new Error("Akses ditolak (HTTP 403). Server menolak permintaan ini."));
            return;
        }
        if (status === 404) {
            done(new Error("File tidak ditemukan (HTTP 404). Periksa kembali URL."));
            return;
        }
        if (status === 401) {
            done(new Error("Tidak terotorisasi (HTTP 401). URL memerlukan autentikasi."));
            return;
        }
        if (status >= 400) {
            done(new Error("Server mengembalikan error HTTP " + status + "."));
            return;
        }
        if (status < 200 || status >= 300) {
            done(new Error("Respons tak terduga dari server (HTTP " + status + ")."));
            return;
        }

        // --- Validate that this is actually an image, not a web page ---
        var contentType = res.headers["content-type"] || "";
        var ctExt = extFromContentType(contentType);
        var lowerCt = contentType.split(";")[0].trim().toLowerCase();

        if (lowerCt.indexOf("text/html") === 0) {
            done(new Error("URL ini mengarah ke halaman web, bukan gambar langsung. " +
                           "Gunakan direct image URL."));
            return;
        }

        var finalExt = ctExt || urlExt;
        if (!finalExt) {
            done(new Error("Format tidak didukung atau tidak dapat dikenali " +
                           "(Content-Type: " + (contentType || "tidak diketahui") + ")."));
            return;
        }

        // --- Enforce max size using Content-Length if present ---
        var declaredLen = parseInt(res.headers["content-length"] || "0", 10);
        if (declaredLen && declaredLen > MAX_BYTES) {
            res.resume();
            done(new Error("File terlalu besar (" + formatBytes(declaredLen) +
                           "). Batas maksimum " + formatBytes(MAX_BYTES) + "."));
            return;
        }

        // --- Stream to disk ---
        var dir;
        try {
            dir = ensureCacheDir();
        } catch (e) {
            done(new Error("Gagal membuat folder cache: " + e.message));
            return;
        }

        var baseFromUrl = parsed_basename(originalUrl);
        var filePath = buildUniqueName(dir, baseFromUrl, finalExt);
        var fileName = path.basename(filePath);

        var fileStream;
        try {
            fileStream = fs.createWriteStream(filePath);
        } catch (e) {
            done(new Error("Gagal menulis file: " + e.message));
            return;
        }

        var received = 0;
        var aborted = false;

        // Guard against servers that stream more than declared.
        res.on("data", function (chunk) {
            if (aborted) {
                return;
            }
            received += chunk.length;
            if (received > MAX_BYTES) {
                aborted = true;
                try { res.destroy(); } catch (e) {}
                try { fileStream.destroy(); } catch (e) {}
                cleanupFile(filePath);
                done(new Error("File melebihi batas ukuran (" + formatBytes(MAX_BYTES) +
                               "). Download dibatalkan."));
                return;
            }
            var percent = 0;
            if (declaredLen && declaredLen > 0) {
                percent = Math.min(99, Math.round((received / declaredLen) * 100));
            }
            onProgress(percent, received, declaredLen || 0);
        });

        res.on("error", function (e) {
            if (aborted) { return; }
            aborted = true;
            try { fileStream.destroy(); } catch (err) {}
            cleanupFile(filePath);
            done(new Error("Koneksi terputus saat mengunduh: " + e.message));
        });

        res.pipe(fileStream);

        fileStream.on("finish", function () {
            if (aborted) { return; }
            onProgress(100, received, declaredLen || received);
            onStatus("Selesai. Menyimpan " + fileName + "...");
            done(null, {
                url: originalUrl,
                filePath: filePath,
                fileName: fileName,
                extension: finalExt,
                bytes: received,
                contentType: contentType
            });
        });

        fileStream.on("error", function (e) {
            if (aborted) { return; }
            aborted = true;
            cleanupFile(filePath);
            done(new Error("Gagal menulis file ke disk: " + e.message));
        });
    }

    // Returns the basename of the path portion of a URL (no query string).
    function parsed_basename(originalUrl) {
        try {
            var p = urlModule.parse(originalUrl);
            return path.basename(p.pathname || "");
        } catch (e) {
            return "image";
        }
    }

    // Best-effort removal of a partially written file.
    function cleanupFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) { /* ignore */ }
    }

    // Human-readable byte size.
    function formatBytes(bytes) {
        if (!bytes || bytes < 0) { return "0 B"; }
        var units = ["B", "KB", "MB", "GB"];
        var i = 0;
        var n = bytes;
        while (n >= 1024 && i < units.length - 1) {
            n = n / 1024;
            i++;
        }
        return (i === 0 ? n : n.toFixed(1)) + " " + units[i];
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    var api = {
        downloadImage: function (rawUrl, options, done) {
            if (!nodeReady) {
                done(new Error("Node.js tidak tersedia di host ini. " +
                               "Pastikan ekstensi dimuat dengan benar di AE 2017."));
                return;
            }
            return downloadImage(rawUrl, options, done);
        },
        getCacheDir: nodeReady ? getCacheDir : function () { return null; },
        ensureCacheDir: nodeReady ? ensureCacheDir : function () { return null; },
        validateUrl: validateUrl,
        formatBytes: formatBytes,
        nodeReady: nodeReady,
        MAX_BYTES: MAX_BYTES
    };

    // Export for CommonJS (Node) and as a global for the panel context.
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.Link2AEDownloader = api;

})(typeof window !== "undefined" ? window : this);




