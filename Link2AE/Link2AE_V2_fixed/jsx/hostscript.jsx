/*
 * Link2AE - hostscript.jsx
 *
 * ExtendScript (JSX) that runs inside After Effects CC 2017. It is loaded via
 * the manifest's <ScriptPath> and called from the panel through
 * CSInterface.evalScript().
 *
 * Responsibilities:
 *   - Import one or more already-downloaded image files into the Project Panel
 *     using ImportOptions + app.project.importFile().
 *   - Never create timeline layers automatically.
 *   - Never delete or overwrite the user's project.
 *   - Avoid importing the same file twice within the current AE session.
 *   - Report a per-file result string back to the panel.
 *
 * NOTE: ExtendScript is ES3-era JavaScript. Avoid ES5+ features (no
 * Array.prototype.forEach/map/filter, no JSON.parse on untrusted input without
 * care, no trailing commas). This file is intentionally conservative.
 */

// Persist the set of already-imported absolute paths for this AE session so we
// do not import the same file twice. Stored on the global object, so it lives
// as long as the ExtendScript engine is alive for this host process.
if (typeof Link2AE_importedPaths === "undefined") {
    Link2AE_importedPaths = {};
}

/**
 * Escapes a string so it can be logged/embedded safely. Not used for building
 * code, only for diagnostics.
 */
function Link2AE_safe(s) {
    if (s === null || s === undefined) {
        return "";
    }
    s = "" + s;
    s = s.replace(/\\/g, "/");
    s = s.replace(/[\r\n\t]/g, " ");
    return s;
}

/**
 * Returns true if a file has already been imported during this session.
 */
function Link2AE_alreadyImported(fsName) {
    return Link2AE_importedPaths[fsName] === true;
}

/**
 * Marks a file as imported for this session.
 */
function Link2AE_markImported(fsName) {
    Link2AE_importedPaths[fsName] = true;
}

/**
 * Checks whether an AE project currently exists and is usable for import.
 * In After Effects, app.project always points to a project (an untitled, empty
 * project exists when nothing has been opened). We therefore only need to make
 * sure it is not null. We DO NOT create or close projects here, to avoid ever
 * discarding the user's work.
 */
function Link2AE_projectIsUsable() {
    try {
        return (app && app.project && app.project !== null);
    } catch (e) {
        return false;
    }
}

/**
 * Imports a single file into the AE Project Panel.
 * Returns a result object:
 *   { status: "ok"|"dup"|"err", name, message }
 */
function Link2AE_importOne(filePath) {
    var result = { status: "err", name: "", message: "" };

    var fileObj;
    try {
        fileObj = new File(filePath);
    } catch (e) {
        result.message = "Gagal membuat objek File: " + Link2AE_safe(e.message);
        return result;
    }

    if (!fileObj.exists) {
        result.name = Link2AE_safe(fileObj.name);
        result.message = "File tidak ada di disk.";
        return result;
    }

    var fsName = "";
    try {
        fsName = fileObj.fsName; // absolute path
    } catch (e) {
        fsName = filePath;
    }
    result.name = Link2AE_safe(fileObj.name);

    // Avoid duplicate imports within this session.
    if (Link2AE_alreadyImported(fsName)) {
        result.status = "dup";
        result.message = "Sudah diimpor sebelumnya.";
        return result;
    }

    var importOptions;
    try {
        importOptions = new ImportOptions(fileObj);
        // Import as footage (do NOT force sequence). This works for still
        // images and animated GIFs alike.
        importOptions.sequence = false;
    } catch (e) {
        result.message = "Gagal menyiapkan ImportOptions: " + Link2AE_safe(e.message);
        return result;
    }

    var footage;
    try {
        footage = app.project.importFile(importOptions);
    } catch (e) {
        // A common cause is an unsupported format (e.g. WebP in AE 2017).
        result.message = "importFile gagal: " + Link2AE_safe(e.message);
        return result;
    }

    if (!footage) {
        result.message = "After Effects tidak dapat mengimpor file ini " +
                         "(format mungkin tidak didukung di AE 2017).";
        return result;
    }

    Link2AE_markImported(fsName);
    result.status = "ok";
    result.message = "Berhasil diimpor ke Project Panel.";
    return result;
}

/**
 * Main entry point called from the panel.
 * Accepts one or more file path strings as arguments (via `arguments`).
 * Returns a single result string with one record per file, separated by
 * newlines. Each record is:
 *   status<TAB>fileName<TAB>message
 * where status is one of: ok, dup, err, setup
 */
function importImagesToAE() {
    var records = [];

    // Guard: ensure we have a usable project before touching importFile.
    if (!Link2AE_projectIsUsable()) {
        return "setup\t-\tTidak ada project yang aktif. Buka atau buat project di After Effects, lalu coba lagi.";
    }

    app.beginUndoGroup("Link2AE: Import Images");

    for (var i = 0; i < arguments.length; i++) {
        var filePath = arguments[i];
        if (typeof filePath !== "string" || filePath.length === 0) {
            continue;
        }
        var r;
        try {
            r = Link2AE_importOne(filePath);
        } catch (e) {
            r = { status: "err", name: "", message: "Exception: " + Link2AE_safe(e.message) };
        }
        records.push(r.status + "\t" + r.name + "\t" + r.message);
    }

    try {
        app.endUndoGroup();
    } catch (e) {
        // Some builds throw if the undo group is empty; ignore.
    }

    return records.join("\n");
}
