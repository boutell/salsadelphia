// Largely borrowed from Apostrophe.

var moment = require('moment');
var _ = require('lodash');

var sanitize = module.exports = {
  string: function(s, def) {
    if (!s) {
      s = '';
    }
    s = s.toString();
    return s.trim();
  },

  // Accept a user-entered string in YYYY-MM-DD, MM/DD, MM/DD/YY, or MM/DD/YYYY format
  // (tolerates missing leading zeroes on MM and DD). Also accepts a Date object.
  // Returns YYYY-MM-DD.
  //
  // The current year is assumed when MM/DD is used. If there is no explicit default
  // any unparseable date is returned as today's date.

  date: function(date, def) {
    var components;

    date = sanitize.string(date);

    function returnDefault() {
      if (def === undefined) {
        def = moment().format('YYYY-MM-DD');
      }
      return def;
    }

    if (date.match(/\//)) {
      components = date.split('/');
      if (components.length === 2) {
        // Convert mm/dd to yyyy-mm-dd
        return padInteger(new Date().getYear() + 1900, 4) + '-' + padInteger(components[0], 2) + '-' + padInteger(components[1], 2);
      } else if (components.length === 3) {
        // Convert mm/dd/yyyy to yyyy-mm-dd
        if (components[2] < 100) {
          components[2] += 1000;
        }
        return padInteger(components[2], 4) + '-' + padInteger(components[0], 2) + '-' + padInteger(components[1], 2);
      } else {
        return returnDefault();
      }
    } else if (date.match(/\-/)) {
      components = date.split('-');
      if (components.length === 2) {
        // Convert mm-dd to yyyy-mm-dd
        return padInteger(new Date().getYear() + 1900, 4) + '-' + padInteger(components[0], 2) + '-' + padInteger(components[1], 2);
      } else if (components.length === 3) {
        // Convert yyyy-mm-dd (with questionable padding) to yyyy-mm-dd
        return padInteger(components[0], 4) + '-' + padInteger(components[1], 2) + '-' + padInteger(components[2], 2);
      } else {
        return returnDefault();
      }
    }
    try {
      date = new Date(date);
      if (isNaN(date.getTime())) {
        return returnDefault();
      }
      return padInteger(date.getYear() + 1900, 4) + '-' + padInteger(date.getMonth() + 1, 2) + '-' + padInteger(date.getDay(), 2);
    } catch (e) {
      return returnDefault();
    }
  },

  dates: function(a) {
    if (!(a && Array.isArray(a))) {
      return [];
    }
    var result = _.uniq(_.map(a, function(s) {
      return sanitize.date(s);
    }));
    result.sort();
    return result;
  },

  // Given a date object, return a date string in Apostrophe's preferred sortable, comparable, JSON-able format,
  // which is YYYY-MM-DD. If `date` is undefined the current date is used.
  formatDate: function(date) {
    return moment(date).format('YYYY-MM-DD');
  },

  // Accepts a user-entered string in 12-hour or 24-hour time and returns a string
  // in 24-hour time. This method is tolerant of syntax such as `4pm`; minutes and
  // seconds are optional.
  //
  // If `def` is not set the default is the current time.

  time: function(time, def) {
    time = sanitize.string(time, '');
    time = time.toLowerCase();
    time = time.trim();
    var components = time.match(/^(\d+)(:(\d+))?(:(\d+))?\s*(am|pm)?$/);
    if (components) {
      var hours = parseInt(components[1], 10);
      var minutes = (components[3] !== undefined) ? parseInt(components[3], 10) : 0;
      var seconds = (components[5] !== undefined) ? parseInt(components[5], 10) : 0;
      var ampm = components[6];
      if ((hours === 12) && (ampm === 'am')) {
        hours -= 12;
      } else if ((hours === 12) && (ampm === 'pm')) {
        // Leave it be
      } else if (ampm === 'pm') {
        hours += 12;
      }
      if ((hours === 24) || (hours === '24')) {
        hours = 0;
      }
      return padInteger(hours, 2) + ':' + padInteger(minutes, 2) + ':' + padInteger(seconds, 2);
    } else {
      if (def !== undefined) {
        return def;
      }
      return moment().format('HH:mm');
    }
  },

  // Requires a time in HH:MM or HH:MM:ss format. Returns
  // an object with hours, minutes and seconds properties.
  // See apos.sanitizeTime for an easy way to get a time into the
  // appropriate input format.

  parseTime: function(time) {
    var components = time.match(/^(\d\d):(\d\d)(:(\d\d))$/);
    return {
      hours: time[1],
      minutes: time[2],
      seconds: time[3] || 0
    };
  },

  // Given a JavaScript Date object, return a time string in
  // Apostrophe's preferred sortable, comparable, JSON-able format:
  // 24-hour time, with seconds.
  //
  // If `date` is missing the current time is used.

  formatTime: function(date) {
    return moment(date).format('HH:mm:ss');
  },

  boolean: function(b) {
    return !!b;
  },

  calendar: function(_days) {
    var days = [];
    var week, weekday;
    for (week = 0; (week <= 5); week++) {
      days[week] = [];
      for (weekday = 0; (weekday <= 6); weekday++) {
        if (_days && _days['w' + week] && _days['w' + week]['d' + weekday]) {
          days[week][weekday] = true;
        } else {
          days[week][weekday] = false;
        }
      }
    }
    return days;
  }

};

function padInteger(i, places) {
  var s = i + '';
  while (s.length < places) {
    s = '0' + s;
  }
  return s;
};

