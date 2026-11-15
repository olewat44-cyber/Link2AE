/*
 * Link2AE V2 - pinterest.js
 * Pinterest URL Resolver for Link2AE extension (AE CC 2017 / CEP 6).
 *
 * Runs inside the CEP panel using Node.js (http/https) so we avoid browser CORS.
 * ES5-only syntax (no let/const/arrow/template literal) for IO.js 1.2.0 compat.
 *
 * Supported URL shapes:
 *   - https://pin.it/xxxx              (short link -> follow redirect)
 *   - https://www.pinterest.com/pin/xx (pin page -> parse Open Graph)
 *   - Direct Pinterest CDN image URL   (use as-is)
 *
 * Limitations:
 *   - No login, no CAPTCHA bypass, no private content.
 *   - Pinterest may block/return 403; we report a clear error.
 *   - Not every Pinterest URL yields a usable image URL.
 */

(function (global) {
    "use strict";

    var http, https, urlModule;

    try {
        if (typeof require === "function") {
            http = require("http");
            https = require("https");
            urlModule = require("url");
        }
    } catch (e) {
        http = null;
        https = null;
        urlModule = null;
    }

    var nodeReady = !!(http && https && urlModule);

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    var MAX_REDIRECTS = 8;
    var TIMEOUT_MS = 20000;
    var MAX_HTML_BYTES = 2 * 1024 * 1024;

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function isPinterestUrl(url) {
        if (typeof url !== "string" || url.length === 0) {
            return false;
        }
        var lower = url.toLowerCase();
        return (
            lower.indexOf("pinterest.com") !== -1 ||
            lower.indexOf("pin.it") !== -1 ||
            lower.indexOf("pinimg.com") !== -1
        );
    }

    function isPinItShortUrl(url) {
        var lower = (url || "").toLowerCase();
        return lower.indexOf("pin.it") !== -1;
    }

    function isPinterestPinPage(url) {
        var lower = (url || "").toLowerCase();
        return lower.indexOf("pinterest.com/pin/") !== -1;
    }

    function isDirectPinterestImage(url) {
        var lower = (url || "").toLowerCase();
        return lower.indexOf("pinimg.com") !== -1 &&
               (lower.indexOf(".jpg") !== -1 ||
                lower.indexOf(".jpeg") !== -1 ||
                lower.indexOf(".png") !== -1 ||
                lower.indexOf(".webp") !== -1);
    }

    function guessExtFromUrl(url) {
        var u = (url || "").toLowerCase();
        if (u.indexOf(".webp") !== -1) return "webp";
        if (u.indexOf(".jpeg") !== -1) return "jpeg";
        if (u.indexOf(".jpg") !== -1) return "jpg";
        if (u.indexOf(".png") !== -1) return "png";
        return "jpg";
    }

    function regexFirst(text, pattern) {
        var m = pattern.exec(text || "");
        return m ? m[1] : null;
    }

    // ---------------------------------------------------------------------
    // HTTP GET
    // ---------------------------------------------------------------------

    function httpGet(options, onResponse, onError) {
        var lib = (options.protocol || "https:") === "https:" ? https : http;
        if (!lib) {
            onError(new Error("Node.js http/https tidak tersedia."));
            return;
        }

        var req = lib.request(options, function (res) {
            onResponse(res);
        });

        req.setTimeout(TIMEOUT_MS, function () {
            req.abort();
            onError(new Error("Timeout setelah " + (TIMEOUT_MS / 1000) + " detik."));
        });

        req.on("error", function (e) {
            onError(e);
        });

        req.end();
    }

    // ---------------------------------------------------------------------
    // Resolve pin.it short URL -> final URL
    // ---------------------------------------------------------------------

    function resolveShortUrl(url, done) {
        var parsed = urlModule.parse(url);
        var opts = {
            protocol: parsed.protocol || "https:",
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: parsed.path || "/",
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "close"
            }
        };

        var redirects = 0;

        function follow(res) {
            var location = res.headers.location || res.headers["Location"];
            if (location) {
                redirects++;
                if (redirects > MAX_REDIRECTS) {
                    done(new Error("Terlalu banyak redirect (pin.it)."));
                    return;
                }
                var next = urlModule.resolve(url, location);
                done(null, { finalUrl: next, resolved: true });
                return;
            }

            var chunks = [];
            var received = 0;
            res.on("data", function (c) {
                chunks.push(c);
                received += c.length;
                if (received > MAX_HTML_BYTES) {
                    res.destroy();
                }
            });
            res.on("end", function () {
                var html = Buffer.concat(chunks).toString("utf8");
                done(null, { finalUrl: url, html: html, resolved: false });
            });
            res.on("error", function (e) {
                done(e);
            });
        }

        httpGet(opts, follow, function (e) {
            done(e);
        });
    }

    // ---------------------------------------------------------------------
    // Fetch Pinterest pin page HTML
    // ---------------------------------------------------------------------

    function fetchPinPage(url, done) {
        var parsed = urlModule.parse(url);
        var opts = {
            protocol: parsed.protocol || "https:",
            hostname: parsed.hostname || "www.pinterest.com",
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: parsed.path || "/",
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "close"
            }
        };

        httpGet(opts, function (res) {
            var status = res.statusCode || 0;
            if (status === 403) {
                done(new Error("Pinterest menolak akses (HTTP 403). Coba URL gambar langsung."));
                return;
            }
            if (status === 404) {
                done(new Error("Pin tidak ditemukan (HTTP 404)."));
                return;
            }
            if (status >= 500) {
                done(new Error("Pinterest server error (HTTP " + status + ")."));
                return;
            }
            if (status !== 200 && status !== 0) {
                done(new Error("Respon Pinterest tidak terduga (HTTP " + status + ")."));
                return;
            }

            var chunks = [];
            var received = 0;
            res.on("data", function (c) {
                chunks.push(c);
                received += c.length;
                if (received > MAX_HTML_BYTES) {
                    res.destroy();
                }
            });
            res.on("end", function () {
                var html = Buffer.concat(chunks).toString("utf8");
                done(null, { html: html, status: status });
            });
            res.on("error", function (e) {
                done(e);
            });
        }, function (e) {
            done(e);
        });
    }

    // ---------------------------------------------------------------------
    // Extract og:image and other candidate image URLs from HTML
    // ---------------------------------------------------------------------

    function extractImageCandidates(html) {
        var candidates = [];
        var seen = {};

        if (typeof html !== "string" || html.length === 0) {
            return candidates;
        }

        var ogImageRegex = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi;
        var m;
        while ((m = ogImageRegex.exec(html)) !== null) {
            var u = m[1];
            if (u && !seen[u]) {
                seen[u] = true;
                candidates.push({ url: u, source: "og:image", width: 0, height: 0 });
            }
        }

        var twitterImageRegex = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi;
        while ((m = twitterImageRegex.exec(html)) !== null) {
            var u2 = m[1];
            if (u2 && !seen[u2]) {
                seen[u2] = true;
                candidates.push({ url: u2, source: "twitter:image", width: 0, height: 0 });
            }
        }

        var pinImgRegex = /"url"\s*:\s*"([^"]*pinimg\.com[^"]*?\.(?:jpg|jpeg|png|webp))"/gi;
        while ((m = pinImgRegex.exec(html)) !== null) {
            var u3 = m[1].replace(/\\u0026/g, "&").replace(/\\\\\//g, "/");
            if (u3 && !seen[u3]) {
                seen[u3] = true;
                candidates.push({ url: u3, source: "pinimg json", width: 0, height: 0 });
            }
        }

        var sizeRegex = /"(\d+x\d+)"\s*:\s*"([^"]*pinimg\.com[^"]*)"/gi;
        while ((m = sizeRegex.exec(html)) !== null) {
            var sizeKey = m[1];
            var u4 = m[2].replace(/\\u0026/g, "&").replace(/\\\\\//g, "/");
            var sizeParts = sizeKey.split("x");
            var w = parseInt(sizeParts[0], 10) || 0;
            var h = parseInt(sizeParts[1], 10) || 0;
            if (u4 && !seen[u4]) {
                seen[u4] = true;
                candidates.push({ url: u4, source: "pinimg size " + sizeKey, width: w, height: h });
            }
        }

        return candidates;
    }

    // ---------------------------------------------------------------------
    // Pick the best candidate: highest resolution, prefer larger dimensions
    // ---------------------------------------------------------------------

    function pickBestCandidate(candidates) {
        if (candidates.length === 0) {
            return null;
        }
        var best = candidates[0];
        var bestScore = (best.width || 0) * (best.height || 0);
        for (var i = 1; i < candidates.length; i++) {
            var c = candidates[i];
            var score = (c.width || 0) * (c.height || 0);
            if (score > bestScore || (score === bestScore && c.url.length > best.url.length)) {
                best = c;
                bestScore = score;
            }
        }
        return best;
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    var api = {
        nodeReady: nodeReady,

        isPinterestUrl: isPinterestUrl,
        isPinItShortUrl: isPinItShortUrl,
        isPinterestPinPage: isPinterestPinPage,
        isDirectPinterestImage: isDirectPinterestImage,

        resolve: function (input, done) {
            if (!nodeReady) {
                done(new Error("Node.js tidak tersedia di host ini."));
                return;
            }
            if (!input || typeof input.url !== "string" || input.url.length === 0) {
                done(new Error("URL kosong."));
                return;
            }

            var url = input.url;

            if (isDirectPinterestImage(url)) {
                done(null, {
                    finalUrl: url,
                    imageUrl: url,
                    imageExt: guessExtFromUrl(url),
                    source: "direct",
                    candidates: [{ url: url, source: "direct", width: 0, height: 0 }],
                    resolved: false
                });
                return;
            }

            if (isPinItShortUrl(url)) {
                resolveShortUrl(url, function (err, result) {
                    if (err) {
                        done(err);
                        return;
                    }
                    if (result.resolved) {
                        api.resolve({ url: result.finalUrl }, function (err2, result2) {
                            if (err2) {
                                done(null, {
                                    finalUrl: result.finalUrl,
                                    imageUrl: null,
                                    imageExt: guessExtFromUrl(result.finalUrl),
                                    source: "redirect-only",
                                    candidates: [],
                                    resolved: true,
                                    redirectNote: "Terjadi redirect ke " + result.finalUrl + ". Metadata gambar tidak tersedia."
                                });
                                return;
                            }
                            result2.resolved = true;
                            result2.finalUrl = result.finalUrl;
                            done(null, result2);
                        });
                        return;
                    }
                    if (result.html) {
                        extractFromHtml(result.html, url, done);
                    } else {
                        done(new Error("Tidak dapat mengarahkan pin.it ke URL tujuan."));
                    }
                });
                return;
            }

            if (isPinterestPinPage(url)) {
                fetchPinPage(url, function (err, result) {
                    if (err) {
                        done(err);
                        return;
                    }
                    extractFromHtml(result.html, url, done);
                });
                return;
            }

            done(null, {
                finalUrl: url,
                imageUrl: url,
                imageExt: guessExtFromUrl(url),
                source: "direct-attempt",
                candidates: [{ url: url, source: "direct-attempt", width: 0, height: 0 }],
                resolved: false
            });
        },

        guessExtFromUrl: guessExtFromUrl
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.Link2AEPinterest = api;

})(typeof window !== "undefined" ? window : this);

// ---------------------------------------------------------------------
// Shared helper (hoisted for internal use)
// ---------------------------------------------------------------------
function extractFromHtml(html, originalUrl, done) {
    var candidates = extractImageCandidates(html);
    var best = pickBestCandidate(candidates);

    if (best) {
        var u = best.url.toLowerCase();
        var ext = "jpg";
        if (u.indexOf(".webp") !== -1) ext = "webp";
        else if (u.indexOf(".jpeg") !== -1) ext = "jpeg";
        else if (u.indexOf(".jpg") !== -1) ext = "jpg";
        else if (u.indexOf(".png") !== -1) ext = "png";

        done(null, {
            finalUrl: originalUrl,
            imageUrl: best.url,
            imageExt: ext,
            source: best.source || "unknown",
            candidates: candidates,
            resolved: false,
            width: best.width || 0,
            height: best.height || 0
        });
    } else {
        done(new Error("Tidak ditemukan URL gambar dari halaman Pinterest. Pin mungkin privat atau dibatasi."));
    }
}
