/*
 * Link2AE - main.js
 *
 * Panel logic. Runs in the CEP 6 (AE CC 2017) Chromium 41 / IO.js context.
 * Written in ES5 for maximum compatibility with the old runtime.
 *
 * Responsibilities:
 *   - Wire up the UI (URL input, buttons, history).
 *   - Use the Node-based downloader (Link2AEDownloader) to fetch images.
 *   - Call into ExtendScript (hostscript.jsx) via CSInterface.evalScript to
 *     import downloaded images into the AE Project Panel.
 *   - Persist a small history list to disk so it survives panel reloads.
 */

(function () {
    "use strict";

    var cs = new CSInterface();
    var dl = window.Link2AEDownloader;

    // Whether Node.js is available. If not, downloads will report a clear error.
    var nodeAvailable = !!(dl && dl.nodeReady && typeof dl.downloadImage === "function");

    // -----------------------------------------------------------------
    // DOM references
    // -----------------------------------------------------------------
    var els = {
        urlInput: document.getElementById("url-input"),
        btnDownload: document.getElementById("btn-download"),
        btnDownloadImport: document.getElementById("btn-download-import"),
        btnClear: document.getElementById("btn-clear"),
        btnOpenCache: document.getElementById("btn-open-cache"),
        btnClearHistory: document.getElementById("btn-clear-history"),
        progressBar: document.getElementById("progress-bar"),
        statusText: document.getElementById("status-text"),
        historyList: document.getElementById("history-list"),
        historyEmpty: document.getElementById("history-empty")
    };

    // -----------------------------------------------------------------
    // Small state
    // -----------------------------------------------------------------
    var isBusy = false;          // prevents concurrent downloads
    var history = [];            // array of history entry objects
    var fs = null;               // node fs, loaded lazily
    var path = null;             // node path, loaded lazily
    var historyFilePath = null;  // where we persist history

    // -----------------------------------------------------------------
    // Node helpers (loaded lazily; safe if Node is unavailable)
    // -----------------------------------------------------------------
    function tryLoadNode() {
        if (fs) {
            return true;
        }
        try {
            if (typeof require === "function") {
                fs = require("fs");
                path = require("path");
            }
        } catch (e) {
            fs = null;
            path = null;
        }
        return !!fs;
    }

    // -----------------------------------------------------------------
    // Status helpers
    // -----------------------------------------------------------------
    function setStatus(message, kind) {
        els.statusText.textContent = message;
        els.statusText.className = "status-text" + (kind ? " is-" + kind : "");
    }

    function setProgress(percent) {
        var p = Math.max(0, Math.min(100, percent || 0));
        els.progressBar.style.width = p + "%";
    }

    function setBusy(busy) {
        isBusy = busy;
        els.btnDownload.disabled = busy;
        els.btnDownloadImport.disabled = busy;
        els.btnClear.disabled = busy;
    }

    // -----------------------------------------------------------------
    // History persistence
    // -----------------------------------------------------------------
    // We store the history JSON next to the cache folder:
    //   ~/Link2AE/history.json
    // This keeps history available even after AE restarts.

    function getHistoryFilePath() {
        if (historyFilePath) {
            return historyFilePath;
        }
        var cacheDir = dl.getCacheDir();
        // cacheDir is like ~/Link2AE/cache ; parent is ~/Link2AE
        var parent = path.dirname(cacheDir);
        historyFilePath = path.join(parent, "history.json");
        return historyFilePath;
    }

    function loadHistory() {
        if (!tryLoadNode()) {
            return;
        }
        try {
            var file = getHistoryFilePath();
            if (fs.existsSync(file)) {
                var raw = fs.readFileSync(file, "utf8");
                var parsed = JSON.parse(raw);
                if (parsed && Object.prototype.toString.call(parsed) === "[object Array]") {
                    history = parsed;
                }
            }
        } catch (e) {
            history = [];
        }
    }

    function saveHistory() {
        if (!tryLoadNode()) {
            return;
        }
        try {
            var file = getHistoryFilePath();
            var dir = path.dirname(file);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
            }
            fs.writeFileSync(file, JSON.stringify(history), "utf8");
        } catch (e) {
            // Persistence is best-effort; do not break the UI if it fails.
        }
    }

    function addHistoryEntry(entry) {
        history.unshift(entry);
        // Cap history so it does not grow unbounded.
        if (history.length > 100) {
            history.length = 100;
        }
        saveHistory();
        renderHistory();
    }

    function updateHistoryEntry(id, patch) {
        for (var i = 0; i < history.length; i++) {
            if (history[i].id === id) {
                for (var key in patch) {
                    if (Object.prototype.hasOwnProperty.call(patch, key)) {
                        history[i][key] = patch[key];
                    }
                }
                break;
            }
        }
        saveHistory();
        renderHistory();
    }

    function removeHistoryEntry(id, deleteFile) {
        var keep = [];
        var removed = null;
        for (var i = 0; i < history.length; i++) {
            if (history[i].id === id) {
                removed = history[i];
            } else {
                keep.push(history[i]);
            }
        }
        history = keep;

        // Only delete the physical file if the user explicitly asked for it.
        if (deleteFile && removed && removed.filePath && tryLoadNode()) {
            try {
                if (fs.existsSync(removed.filePath)) {
                    fs.unlinkSync(removed.filePath);
                }
            } catch (e) { /* ignore */ }
        }
        saveHistory();
        renderHistory();
    }

    function clearHistory() {
        // Removing history must NOT delete files (per requirements).
        history = [];
        saveHistory();
        renderHistory();
        setStatus("Riwayat dibersihkan. File tetap ada di folder cache.", "ok");
    }

    // -----------------------------------------------------------------
    // History rendering
    // -----------------------------------------------------------------

    function makeId() {
        return "h_" + Date.now().toString(36) + "_" +
               Math.floor(Math.random() * 1e6).toString(36);
    }

    function statusBadge(entry) {
        if (entry.importStatus === "ok") {
            return '<span class="badge badge-ok">Imported</span>';
        }
        if (entry.importStatus === "err") {
            return '<span class="badge badge-err">Error</span>';
        }
        return '<span class="badge badge-pending">Downloaded</span>';
    }

    function renderHistory() {
        els.historyList.innerHTML = "";

        if (!history || history.length === 0) {
            els.historyEmpty.style.display = "block";
            return;
        }
        els.historyEmpty.style.display = "none";

        for (var i = 0; i < history.length; i++) {
            (function (entry) {
                var li = document.createElement("li");
                li.className = "history-item";
                li.setAttribute("data-id", entry.id);

                // Thumbnail (best-effort). We build a file:// URL for the cached
                // image; AE's Chromium can load it because the panel has file
                // access. If it fails to load we keep the fallback icon.
                var thumbHtml = "";
                if (entry.filePath) {
                    var fileUrl = "file:///" + encodeURI(entry.filePath.replace(/\\/g, "/"));
                    thumbHtml = '<img src="' + fileUrl + '" alt="" ' +
                                'onerror="this.style.display=\'none\'">';
                }

                var meta =
                    '<div class="history-thumb">' + thumbHtml + '</div>' +
                    '<div class="history-meta">' +
                        '<div class="history-name" title="' + escapeHtml(entry.fileName) + '">' +
                            escapeHtml(entry.fileName) +
                        '</div>' +
                        '<div class="history-sub">' +
                            '<span>' + escapeHtml(String(entry.extension || "").toUpperCase()) + '</span>' +
                            '<span>&middot;</span>' +
                            '<span>' + escapeHtml(entry.size || "") + '</span>' +
                            statusBadge(entry) +
                        '</div>' +
                    '</div>';

                var actions =
                    '<div class="history-actions">' +
                        miniBtn("import", entry.id, "Impor ke Project Panel",
                            '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M5 20h14v-2H5v2zM12 2 6 10h4v6h4v-6h4L12 2z"/></svg>') +
                        miniBtn("folder", entry.id, "Buka folder",
                            '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>') +
                        miniBtn("remove", entry.id, "Hapus dari riwayat",
                            '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
                            "mini-btn danger") +
                    '</div>';

                li.innerHTML = meta + actions;
                els.historyList.appendChild(li);
            })(history[i]);
        }
    }

    function miniBtn(action, id, title, svg, extraClass) {
        return '<button class="' + (extraClass || "mini-btn") + '" data-action="' + action +
               '" data-id="' + id + '" title="' + title + '">' + svg + '</button>';
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) {
            return "";
        }
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // -----------------------------------------------------------------
    // Import bridge (panel -> ExtendScript)
    // -----------------------------------------------------------------

    // Escapes a single path into a safe JSX double-quoted string literal.
    // We escape backslashes, double quotes, and control characters. This avoids
    // code injection through a crafted file name/path.
    function jsxStringLiteral(str) {
        var s = String(str === null || str === undefined ? "" : str);
        var out = "";
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            var code = s.charCodeAt(i);
            if (ch === "\\") {
                out += "\\\\";
            } else if (ch === '"') {
                out += '\\"';
            } else if (ch === "\n") {
                out += "\\n";
            } else if (ch === "\r") {
                out += "\\r";
            } else if (ch === "\t") {
                out += "\\t";
            } else if (code < 32) {
                // Escape any remaining control characters.
                out += "\\u" + ("0000" + code.toString(16)).slice(-4);
            } else {
                out += ch;
            }
        }
        return '"' + out + '"';
    }

    /**
     * Imports one or more file paths into the AE Project Panel.
     * @param filePaths  Array of absolute file path strings.
     * @param onResult   function(summaryText, perFileResults).
     */
    function importPathsToAE(filePaths, onResult) {
        if (!filePaths || filePaths.length === 0) {
            setStatus("Tidak ada file untuk diimpor.", "warn");
            return;
        }

        // Build: importImagesToAE("path1","path2",...)
        var args = [];
        for (var i = 0; i < filePaths.length; i++) {
            args.push(jsxStringLiteral(filePaths[i]));
        }
        var script = "importImagesToAE(" + args.join(",") + ")";

        setStatus("Mengimpor ke Project Panel...", "busy");

        cs.evalScript(script, function (result) {
            // result is the string returned by hostscript.jsx, or
            // EvalScript_ErrMessage if the ExtendScript call failed.
            if (result === EvalScript_ErrMessage || result === undefined || result === null) {
                setStatus("Gagal memanggil ExtendScript di After Effects.", "err");
                if (onResult) {
                    onResult("EvalScript error", []);
                }
                return;
            }

            var perFile = parseImportResult(result);
            var okCount = 0, dupCount = 0, errCount = 0;
            var messages = [];
            for (var j = 0; j < perFile.length; j++) {
                var r = perFile[j];
                if (r.status === "ok") { okCount++; }
                else if (r.status === "dup") { dupCount++; }
                else { errCount++; messages.push(r.name + ": " + r.message); }
            }

            var summary;
            if (errCount > 0 && okCount === 0 && dupCount === 0) {
                summary = "Import gagal. " + (messages.join(" | ") || result);
                setStatus(summary, "err");
            } else if (errCount > 0) {
                summary = "Sebagian berhasil diimpor. " + (messages.join(" | "));
                setStatus(summary, "warn");
            } else if (okCount > 0 && dupCount > 0) {
                summary = "Diimpor: " + okCount + ", sudah ada: " + dupCount + ".";
                setStatus(summary, "ok");
            } else if (okCount > 0) {
                summary = "Berhasil impor " + okCount + " gambar ke Project Panel.";
                setStatus(summary, "ok");
            } else {
                summary = "Tidak ada perubahan (semua sudah diimpor).";
                setStatus(summary, "warn");
            }

            if (onResult) {
                onResult(summary, perFile);
            }
        });
    }

    // Parses the tab-delimited result records returned by hostscript.jsx.
    function parseImportResult(raw) {
        var results = [];
        var lines = String(raw).split("\n");
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line) {
                continue;
            }
            var parts = line.split("\t");
            results.push({
                status: parts[0] || "err",
                name: parts[1] || "",
                message: parts[2] || ""
            });
        }
        return results;
    }

    // -----------------------------------------------------------------
    // Download orchestration
    // -----------------------------------------------------------------

    function handleDownload(withImport) {
        if (isBusy) {
            return;
        }
        if (!nodeAvailable) {
            setStatus("Node.js tidak tersedia. Pastikan ekstensi dimuat dengan benar di AE 2017.", "err");
            return;
        }

        var url = els.urlInput.value;
        if (!url || url.trim().length === 0) {
            setStatus("Masukkan URL gambar terlebih dahulu.", "warn");
            return;
        }

        // Quick client-side validation for clearer, faster feedback.
        var preCheck = dl.validateUrl(url);
        if (!preCheck.ok) {
            setStatus(preCheck.error, "err");
            return;
        }

        setBusy(true);
        setProgress(0);
        setStatus("Mempersiapkan download...", "busy");

        var entryId = makeId();

        dl.downloadImage(url, {
            onProgress: function (percent) {
                setProgress(percent);
                if (percent > 0 && percent < 100) {
                    setStatus("Mengunduh... " + percent + "%", "busy");
                }
            },
            onStatus: function (msg) {
                setStatus(msg, "busy");
            }
        }, function (err, result) {
            if (err) {
                setBusy(false);
                setProgress(0);
                setStatus("Gagal: " + err.message, "err");
                return;
            }

            // Success: record history entry.
            var entry = {
                id: entryId,
                url: result.url,
                filePath: result.filePath,
                fileName: result.fileName,
                extension: result.extension,
                size: dl.formatBytes(result.bytes),
                importStatus: withImport ? "pending" : "none",
                createdAt: new Date().toISOString()
            };
            addHistoryEntry(entry);

            setProgress(100);

            if (withImport) {
                setStatus("Download selesai. Mengimpor ke Project Panel...", "busy");
                importPathsToAE([result.filePath], function (summary, perFile) {
                    setBusy(false);
                    // Reflect import status in history.
                    if (perFile && perFile.length > 0 && perFile[0].status === "ok") {
                        updateHistoryEntry(entryId, { importStatus: "ok" });
                    } else if (perFile && perFile.length > 0 && perFile[0].status === "dup") {
                        updateHistoryEntry(entryId, { importStatus: "ok" });
                    } else if (perFile && perFile.length > 0) {
                        updateHistoryEntry(entryId, { importStatus: "err" });
                    }
                });
            } else {
                setBusy(false);
                setStatus("Tersimpan: " + result.fileName + " (" + dl.formatBytes(result.bytes) + ")", "ok");
                // Auto-clear the input for the next URL for convenience.
                els.urlInput.value = "";
                els.urlInput.focus();
            }
        });
    }

    // -----------------------------------------------------------------
    // Open cache folder / a file's folder in the OS file explorer
    // -----------------------------------------------------------------
    function openFolder(dirPath) {
        if (!tryLoadNode()) {
            return;
        }
        try {
            var child_process = require("child_process");
            if (process.platform === "win32") {
                child_process.exec('explorer "' + dirPath.replace(/"/g, "") + '"');
            } else if (process.platform === "darwin") {
                child_process.exec('open "' + dirPath.replace(/"/g, "") + '"');
            } else {
                child_process.exec('xdg-open "' + dirPath.replace(/"/g, "") + '"');
            }
        } catch (e) {
            setStatus("Gagal membuka folder: " + e.message, "err");
        }
    }

    function openCacheFolder() {
        try {
            var dir = dl.ensureCacheDir();
            openFolder(dir);
        } catch (e) {
            setStatus("Gagal menyiapkan folder cache.", "err");
        }
    }

    function openFolderForEntry(entry) {
        if (!entry || !entry.filePath || !tryLoadNode()) {
            return;
        }
        var dir = path.dirname(entry.filePath);
        // On Windows, we can select the file directly in Explorer.
        if (process.platform === "win32") {
            try {
                var child_process = require("child_process");
                var clean = entry.filePath.replace(/"/g, "");
                child_process.exec('explorer /select,"' + clean + '"');
                return;
            } catch (e) { /* fall back to folder */ }
        }
        openFolder(dir);
    }

    // -----------------------------------------------------------------
    // Import an existing history item
    // -----------------------------------------------------------------
    function importFromHistory(entry) {
        if (!entry || !entry.filePath) {
            return;
        }
        setStatus("Mengimpor " + entry.fileName + "...", "busy");
        importPathsToAE([entry.filePath], function (summary, perFile) {
            var st = "err";
            if (perFile && perFile.length > 0) {
                if (perFile[0].status === "ok" || perFile[0].status === "dup") {
                    st = "ok";
                } else {
                    st = "err";
                }
            }
            updateHistoryEntry(entry.id, { importStatus: st });
        });
    }

    // -----------------------------------------------------------------
    // Event wiring
    // -----------------------------------------------------------------
    function findEntry(id) {
        for (var i = 0; i < history.length; i++) {
            if (history[i].id === id) {
                return history[i];
            }
        }
        return null;
    }

    function wireEvents() {
        els.btnDownload.addEventListener("click", function () {
            handleDownload(false);
        });

        els.btnDownloadImport.addEventListener("click", function () {
            handleDownload(true);
        });

        els.btnClear.addEventListener("click", function () {
            els.urlInput.value = "";
            setProgress(0);
            setStatus("Siap. Tempel URL gambar lalu tekan Download.");
            els.urlInput.focus();
        });

        els.btnOpenCache.addEventListener("click", function () {
            openCacheFolder();
        });

        els.btnClearHistory.addEventListener("click", function () {
            clearHistory();
        });

        // Enter key in the URL field starts a plain download.
        els.urlInput.addEventListener("keydown", function (e) {
            var key = e.key || e.keyCode;
            if (key === "Enter" || key === 13) {
                if (e.preventDefault) {
                    e.preventDefault();
                }
                handleDownload(false);
            }
        });

        // Delegated click handling for history item action buttons.
        els.historyList.addEventListener("click", function (e) {
            var target = e.target;
            // Walk up to the button if a child (svg/path) was clicked.
            while (target && target !== els.historyList &&
                   !(target.getAttribute && target.getAttribute("data-action"))) {
                target = target.parentNode;
            }
            if (!target || target === els.historyList) {
                return;
            }
            var action = target.getAttribute("data-action");
            var id = target.getAttribute("data-id");
            var entry = findEntry(id);
            if (!entry) {
                return;
            }
            if (action === "import") {
                importFromHistory(entry);
            } else if (action === "folder") {
                openFolderForEntry(entry);
            } else if (action === "remove") {
                // Removing from history keeps the file by default.
                removeHistoryEntry(id, false);
                setStatus("Dihapus dari riwayat. File tetap ada di cache.", "ok");
            }
        });
    }

    // -----------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------
    function init() {
        if (!nodeAvailable) {
            setStatus("Peringatan: Node.js tidak terdeteksi. Unduhan mungkin tidak berfungsi.", "warn");
        }
        tryLoadNode();
        loadHistory();
        renderHistory();
        wireEvents();
        setProgress(0);
    }

    // Kick off when the DOM is ready. In CEP the script is at the end of the
    // body, so the DOM is already available; guard anyway.
    if (document.readyState === "complete" || document.readyState === "interactive") {
        init();
    } else if (document.addEventListener) {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();






