/*

Android
- In app: callback
- Uit app: callback
- App uit: niets
- App uit + open: niets
- App uit + Click: callback (in alloy.js!)

iOS
- In app: callback
- Uit app: niets
- Uit app + tap: callback
- App uit: niets
- App uit + open: niets
- App uit + Click: callback

*/


// Classic Titanium compatibility
var _ = _ || require((typeof ENV_TEST === 'boolean') ? 'alloy' : 'underscore')._,
    OS_IOS = Ti.Platform.name === 'iPhone OS',
    OS_ANDROID = (!OS_IOS && Ti.Platform.name === 'android');

// Actual module we're going to extend
var urbanairship = require('ti.urbanairship');

// General callback
var callback = null;

// Options
var sound = true,
    debug = (typeof ENV_PRODUCTION === 'boolean' ? !ENV_PRODUCTION : false),
    compatibility = false;

// Android-only vars
if (OS_ANDROID) {
    var pendingTags = null,
        pendingAlias = null,
        hashes = [],
        vibrate = true;
}

// iOS-only vars
if (OS_IOS) {
    var alert = true,
        badge = true;
}

urbanairship.register = function(config) {
    var that = this;

    if (config) {

        if (debug || config.debug !== false) {
            logger('INIT', config);
        }

        _.each(config, function(val, key) {

            switch (key) {

                // callback
                case 'callback':
                    callback = val;
                    break;

                    // debug
                case 'debug':
                    debug = !! val;
                    break;

                    // compatibility
                case 'compatibility':
                    compatibility = !! val;

                    if (typeof config.showOnAppClick === 'undefined') {
                        that.showOnAppClick = compatibility;
                    }

                    break;

                // iOS-only so maybe better always use config file
                case 'options':

                    if (OS_IOS) {
                        that.options = val;
                    }

                    break;

                    // Smart methods

                case 'tags':
                    that.setTags(val);
                    break;

                case 'alias':
                    that.setAlias(val);
                    break;

                    // Used for enabling push options

                case 'sound':
                    sound = !! val;
                    break;

                case 'vibrate':

                    if (OS_ANDROID) {
                        vibrate = !! val;
                    }

                    break;

                case 'badge':

                    if (OS_IOS) {
                        badge = !! val;
                    }

                    break;

                case 'alert':

                    if (OS_IOS) {
                        alert = !! val;
                    }

                    break;

                    // Allows to set pretty much any property or method
                default:

                    if (typeof that[key] !== 'undefined') {

                        if (_.isFunction(that[key])) {
                            that[key](val);
                            logger('calling ' + key, val);

                        } else {
                            that[key] = val;
                            logger('setting ' + key, val);
                        }
                    }

                    break;
            }
        });
    }

    that.enable();
};

urbanairship.setTags = function(tags) {

    // We accept a single string as well
    if (typeof tags === 'string') {
        tags = [tags];
    }

    // We need to be flying on Android
    if (OS_ANDROID && !this.isFlying) {
        pendingTags = pendingTags;
        return;
    }

    this.tags = tags;
};

urbanairship.addTags = function(tags) {

    // We accept a single string as well
    if (typeof tags === 'string') {
        tags = [tags];
    }

    // We need to be flying on Android
    if (OS_ANDROID && !this.isFlying) {
        pendingTags = _.union(pendingTags || [], tags);
        return;
    }

    this.tags = _.union(this.tags || [], tags);
};

urbanairship.setAlias = function(alias) {

    // We need to be flying on Android
    if (OS_ANDROID && !this.isFlying) {
        pendingAlias = alias;
        return;
    }

    this.alias = alias;
};

urbanairship.enable = function() {
    var that = this;

    if (OS_IOS) {
        var types = [];

        if (badge) {
            types.push(Ti.Network.NOTIFICATION_TYPE_BADGE);
        }

        if (alert) {
            types.push(Ti.Network.NOTIFICATION_TYPE_ALERT);
        }

        if (sound) {
            types.push(Ti.Network.NOTIFICATION_TYPE_SOUND);
        }

        Ti.Network.registerForPushNotifications({
            types: types,

            success: function(e) {
                logger('SUCCESS', e);

                that.registerDevice(e.deviceToken);

                e.type = 'success';

                // Android-like args
                e.valid = e.success;

                caller(e);
            },

            error: function(e) {
                logger('ERROR', e);

                e.type = 'error';

                // Android-like args
                e.valid = e.success;

                caller(e);
            },

            callback: function(e) {
                logger('CALLBACK', e);

                that.handleNotification(e.data);

                e.type = 'callback';

                // Android-like args
                e.clicked = e.inBackground;
                e.message = e.data.aps.alert;
                e.payload = e.data.aps;

                caller(e);
            }
        });
    }

    if (OS_ANDROID) {
        that.pushEnabled = true;
    }
};

urbanairship.disable = function() {

    if (OS_IOS) {
        this.unregisterDevice();
    }

    if (OS_ANDROID) {
        this.pushEnabled = false;
    }
};

if (OS_ANDROID) {

    urbanairship.addEventListener(urbanairship.EVENT_URBAN_AIRSHIP_SUCCESS, function(e) {
        logger('SUCCESS', e);

        if (pendingAlias !== null) {
            urbanairship.alias = pendingAlias;
            pendingAlias = null;
        }

        if (pendingTags !== null) {
            urbanairship.tags = pendingTags;
            pendingTags = null;
        }

        e.type = 'success';

        // iOS-like args
        e.success = e.valid;

        caller(e);
    });

    urbanairship.addEventListener(urbanairship.EVENT_URBAN_AIRSHIP_ERROR, function(e) {
        logger('ERROR', e);

        e.type = 'error';

        // iOS-like args
        e.success = e.valid;

        caller(e);
    });

    urbanairship.addEventListener(urbanairship.EVENT_URBAN_AIRSHIP_CALLBACK, function(e) {
        logger('CALLBACK', e);

        // Make sure we don't call the same notification twice
        if (compatibility) {
            var hash = Ti.Utils.sha1(JSON.stringify([e.payload,e.message]));

            if (hashes.indexOf(hash) !== -1) {
                return;
            }

            hashes.push(hash);
        }

        e.type = 'callback';

        // Convert payload via JSON to object
        if (e.payload) {
            try {
                var json = e.payload.replace(/\{/g, '{"').replace(/=/g, '":"').replace(/, /g, '","').replace(/\}/g, '"}');
                e.payload = JSON.parse(json);
            } catch (err) {
                logger('CALLBACK PAYLOAD', err, 'error');
                e.payload = {};
            }
        }

        // iOS-like args
        e.inBackground = null;
        e.data = e.payload || {};
        e.data.alert = e.message;
        e.data.aps = e.data;

        caller(e);
    });
}

function logger(label, data, level) {

    if (!level) {
        level = 'debug';
    }

    if (level !== 'debug' || debug) {
        Ti.API[level]('[URBANAIRPORT] ' + label + (data ? ': ' + JSON.stringify(data, null, '\t') : ''));
    }
}

function caller(e) {

    if (_.isFunction(callback)) {
        callback(e);
    }
}

module.exports = urbanairship;