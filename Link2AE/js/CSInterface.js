/*
 * Link2AE - CSInterface.js
 * A lightweight, self-contained adaptation of Adobe's official CEP
 * CSInterface library (v6.1.0) for After Effects CC 2017 (CEP 6).
 *
 * Why a local copy instead of the official file:
 *   - The official v6.1.0 file calls jQuery ($.parseXML) in two methods.
 *     We do not bundle jQuery (kept deliberately lightweight), so this copy
 *     uses the native DOMParser instead. Everything else follows Adobe's API.
 *   - No modern (ES6+) syntax is used, so it runs in the IO.js / CEF 3
 *     Chromium 41 runtime shipped with CEP 6.
 *
 * Copyright 2013 Adobe Systems Incorporated (original), adapted for Link2AE.
 */

/** Stores constants for the window types supported by the CSXS infrastructure. */
function CSXSWindowType() {}
CSXSWindowType._PANEL = "Panel";
CSXSWindowType._MODELESS = "Modeless";
CSXSWindowType._MODAL_DIALOG = "ModalDialog";

/** EvalScript error message. */
EvalScript_ErrMessage = "EvalScript error.";

/** Version helper. */
function Version(major, minor, micro, special) {
    this.major = major;
    this.minor = minor;
    this.micro = micro;
    this.special = special;
}
Version.MAX_NUM = 999999999;

/** Event that is broadcast when the application is activated. */
CSEvent_APPLICATION_ACTIVATE = "com.adobe.csxs.events.ApplicationActivate";

/** Stores constants for the virtual platform file system. */
function SystemPath() {}
SystemPath.USER_DATA = "userData";
SystemPath.COMMON_FILES = "commonFiles";
SystemPath.EXTENSION = "extension";
SystemPath.HOST_APPLICATION = "hostApplication";

/** Standard CSEvent constructor. */
function CSEvent(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope;
    this.appId = appId;
    this.extensionId = extensionId;
}

/**
 * CSInterface - the entry point to the CEP infrastructure.
 */
function CSInterface() {}

CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

/** @return the matching system version for a SystemPath object. */
CSInterface.prototype.getSystemPath = function (pathType) {
    var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
    var OSVersion = this.getOSInformation();
    if (OSVersion.indexOf("Windows") >= 0) {
        path = path.replace("file:///", "");
    } else if (OSVersion.indexOf("Mac") >= 0) {
        path = path.replace("file://", "");
    }
    return path;
};

/** @return the operating system information string. */
CSInterface.prototype.getOSInformation = function () {
    var userAgent = navigator.userAgent;
    if ((navigator.platform === "Win32") || (navigator.platform === "Windows")) {
        if (navigator.userAgent.indexOf("Windows") > -1) {
            userAgent = "Windows " + (navigator.userAgent.match(/Windows NT \d+\.\d+/) || ["Windows"])[0];
        } else {
            userAgent = "Windows";
        }
    } else if ((navigator.platform === "MacIntel") || (navigator.platform === "Macintosh")) {
        userAgent = (navigator.userAgent.match(/Mac OS X \d+[_.]\d+[_.]\d+/) || ["Macintosh"])[0];
    }
    return userAgent;
};

/** @return the version of the CEP API. */
CSInterface.prototype.getApiVersion = function () {
    var apiVersion = window.__adobe_cep__.getCurrentApiVersion();
    return apiVersion;
};

/**
 * Evaluates a JavaScript (ExtendScript) script in the host application.
 *
 * @param script    The ExtendScript string.
 * @param callback  Optional. Receives the result of execution. On failure it
 *                  receives the error message EvalScript_ErrMessage.
 */
CSInterface.prototype.evalScript = function (script, callback) {
    if (callback === null || callback === undefined) {
        callback = function (result) {};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

/** @return the extension's unique identifier. */
CSInterface.prototype.getExtensionID = function () {
    return window.__adobe_cep__.getExtensionId();
};

/** @return a HostEnvironment object parsed from the host. */
CSInterface.prototype.getHostEnvironment = function () {
    var envObj = JSON.parse(window.__adobe_cep__.getHostEnvironment());
    return envObj;
};

/** Closes this extension. */
CSInterface.prototype.closeExtension = function () {
    window.__adobe_cep__.closeExtension();
};

/**
 * Triggers a CEP event.
 * @param event A CSEvent object.
 */
CSInterface.prototype.dispatchEvent = function (event) {
    if (typeof event.data === "undefined") {
        event.data = "";
    }
    window.__adobe_cep__.dispatchEvent(event);
};

/**
 * Registers an interest in some CEP events.
 * @param type     Event type string.
 * @param listener Listener function receiving the event object.
 * @param obj      Optional "this" context.
 */
CSInterface.prototype.addEventListener = function (type, listener, obj) {
    window.__adobe_cep__.addEventListener(type, listener, obj);
};

/**
 * Removes a registered interest in CEP events.
 * @param type     Event type string.
 * @param listener The previously registered listener.
 * @param obj      Optional "this" context.
 */
CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    window.__adobe_cep__.removeEventListener(type, listener, obj);
};

/** @return the resource URL for a path relative to the extension root. */
CSInterface.prototype.getResourceURL = function (path) {
    return encodeURI(window.__adobe_cep__.getResource(path));
};

/**
 * @return the host application's unique identifier (e.g. "AEFT").
 * Uses native DOMParser (no jQuery dependency).
 */
CSInterface.prototype.getApplicationID = function () {
    var NS = "http://ns.adobe.com/AdobeCEP/4.0";
    var hostEnv = window.__adobe_cep__.getHostEnvironment();
    var xml = new DOMParser().parseFromString(hostEnv, "text/xml");
    var envList = xml.getElementsByTagNameNS(NS, "Environment")[0];
    return envList.getElementsByTagName("appId")[0].firstChild.nodeValue;
};

/**
 * Resizes the content of the extension window.
 * @param width  The new width.
 * @param height The new height.
 */
CSInterface.prototype.resizeContent = function (width, height) {
    window.__adobe_cep__.resizeContent(width, height);
};

/**
 * Opens a URL in the default system browser.
 * @param url The URL to open.
 */
CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    return window.cep.util.openURLInDefaultBrowser(url);
};

