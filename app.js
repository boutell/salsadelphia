var bodyParser = require('body-parser');
var expressSession = require('express-session');
var connectFlash = require('connect-flash');
var cookieParser = require('cookie-parser');
var express = require('express');
var mongodb = require('mongodb');
var nunjucks = require('nunjucks');
var moment = require('moment');
var _ = require('lodash');
var sanitize = require('./sanitize.js');
var passport = require('passport');
var FacebookStrategy = require('passport-facebook').Strategy;
var searchify = require('./searchify.js');
var async = require('async');
var nodemailer = require('nodemailer');
var sendmailTransport = require('nodemailer-sendmail-transport');
var fs = require('fs');
var mailer = nodemailer.createTransport(sendmailTransport({}));
var local = require('./data/local.js');
var admin = local.facebook.admin;

RegExp.quote = require('regexp-quote');

var app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({}));
app.use(cookieParser());
app.use(connectFlash());
app.use(expressSession({ secret: local.sessionSecret, resave: true, saveUninitialized: false }));

// app.use(function(req, res, next) {
//   console.log(req.url);
//   return next();
// });

var fields = {
  name: 'string',
  venue: 'string',
  address: 'string',
  date: 'date',
  time: 'time',
  repeat: 'boolean',
  days: 'calendar',
  details: 'string',
  cancellations: 'dates'
};

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});

passport.use(new FacebookStrategy({
    clientID: local.facebook.appId,
    clientSecret: local.facebook.appSecret,
    callbackURL: local.facebook.callback
  },
  function(accessToken, refreshToken, profile, done) {
    // asynchronous verification, for effect...
    process.nextTick(function () {
      return done(null, profile);
    });
  }
));

app.use(passport.initialize());

// Passport sessions remember that the user is logged in
app.use(passport.session());

app.use(express.static(__dirname + '/public'));

var model = {};
var collections = [ 'events', 'whitelist', 'audit' ];

var perPage = 50;

var env = nunjucks.configure('views', {
  express: app
});

env.addFilter('nlbr', function(s) {
  return s.replace(/\n/g, '<br />\n');
});

app.get('/', function(req, res) {
  var now = new Date();
  var today = moment(now).format('YYYY-MM-DD');

  return model.events.find({ active: true }).toArray(function(err, events) {
    if (err) {
      return fail(req, res);
    }

    events = filterCanceled(filterFuture(repeatEvents(events), today));
    sortEvents(events);

    var info = locals(req, {
      events: events,
      user: req.user
    });
    return res.render('index.html', info);
  });
});

app.get('/new', ensureAuthenticated, function(req, res) {

  var info = locals(req, { event: {}, action: '/new' });

  return res.render('edit.html', info);

});

app.post('/new', ensureAuthenticated, function(req, res) {

  var event = {};
  sanitizeEvent(req, req.body, event);
  contribute(req, event);
  event.createdAt = new Date();

  return async.series({
    whitelist: function(callback) {
      if (req.admin) {
        event.active = true;
        return setImmediate(callback);
      }
      return model.whitelist.findOne({ _id: req.user.id }, function(err, whitelisted) {
        if (err) {
          return callback(err);
        }
        if (whitelisted) {
          event.active = true;
        } else {
          event.pending = true;
        }
        return callback(null);
      });
    },
    insert: function(callback) {
      audit({ subject: req.user, verb: 'added', object: event });
      event._id = guid();
      return model.events.insert(event, callback);
    }
  }, function(err) {
    if (err) {
      req.flash('message', 'An error occurred. Sorry.');
      return res.redirect('/');
    }
    if (event.pending) {
      notifyModerator();
      req.flash('message', 'Thank you! Your submission will be reviewed first before it appears.');
    } else {
      req.flash('message', 'Thank you!');
    }
    return res.redirect('/');
  });
});

app.get('/autocomplete-venue', ensureAuthenticated, function(req, res) {
  var term = sanitize.string(req.query.term);
  var re = searchify(term);
  var q = { venue: re, active: true };
  return model.events.find(q).toArray(function(err, events) {
    if (err) {
      res.statusCode = 500;
      return res.send('error');
    }
    var seen = {};
    return res.send(
      _.map(
        _.filter(
          events,
          function(e) {
            if (_.has(seen, e.venue)) {
              return false;
            }
            seen[e.venue] = true;
            return true;
          }
        ),
        function(e) {
          return {
            label: e.venue,
            value: e.venue,
            address: e.address
          };
        }
      )
    );
  });
});

app.post('/upcoming', ensureAuthenticated, function(req, res) {
  var repeat = sanitize.boolean(req.body.repeat);
  var days = sanitize.calendar(req.body.days);
  var event = {
    repeat: repeat,
    days: days
  };
  var events = repeatEvents([ event ]);
  return res.send({
    status: 'ok',
    dates: _.map(_.pluck(events, 'date'), function(date) {
      return {
        value: date,
        label: moment(date).format('ddd MMM Do')
      };
    })
  });
});

app.get('/change', ensureAuthenticated, function(req, res) {
  var id = sanitize.string(req.query.id);
  var date = sanitize.date(req.query.date);
  return model.events.findOne({ _id: id }, function(err, event) {
    if (err) {
      return fail(req, res);
    }
    if (!event) {
      req.flash('message', 'That event has been removed.');
      return res.redirect('/');
    }
    var info = locals(req, {
      event: event,
      date: date
    });
    return res.render('change.html', info);
  });
});

app.get('/edit', ensureAuthenticated, function(req, res) {
  var now = new Date();
  var today = moment(now).format('YYYY-MM-DD');
  var id = sanitize.string(req.query.id);
  return model.events.findOne({ _id: id }, function(err, event) {
    if (err) {
      return fail(req, res);
    }
    if (!event) {
      req.flash('message', 'That event has been removed.');
      return res.redirect('/');
    }
    var info = locals(req, {
      event: event,
      action: '/edit?id=' + event._id
    });
    return res.render('edit.html', info);
  });
});

app.get('/cancel', ensureAuthenticated, function(req, res) {
  var event;
  var id = sanitize.string(req.query.id);
  var date = sanitize.date(req.query.date);
  var whitelisted = false;
  return async.series({
    whitelist: function(callback) {
      if (req.admin) {
        whitelisted = true;
        return setImmediate(callback);
      }
      return model.whitelist.findOne({ _id: req.user.id }, function(err, _whitelisted) {
        if (err) {
          return callback(err);
        }
        whitelisted = !!_whitelisted;
        return callback(null);
      });
    },
    update: function(callback) {
      audit({ subject: req.user, verb: 'cancelled', object: id });
      if (whitelisted) {
        return model.events.update({ _id: id }, { $addToSet: { cancellations: date } }, callback);
      } else {
        // Little bit of a hassle, we have to create a draft at
        // this point if there isn't one already
        var event;
        return async.series({
          get: function(callback) {
            return model.events.findOne({ _id: id }, function(err, _event) {
              if (err) {
                return callback(err);
              }
              event = _event;
              if (!event) {
                req.flash('message', 'That event has already been removed.');
                return res.redirect('/');
              }
              return callback(null);
            });
          },
          draft: function(callback) {
            notifyModerator();
            if (!event.draft) {
              event.draft = _.pick(event, _.keys(fields));
            }
            event.draft.cancellations = (event.draft.cancellations || []).concat(date);
            return model.events.update({ _id: id }, event, callback);
          }
        }, callback);
      }
    }
  }, function(err) {
    if (err) {
      console.log(err);
      return fail(req, res);
    }
    if (whitelisted) {
      req.flash('message', 'Thank you!');
    } else {
      req.flash('message', 'Thank you! Your edit will be reviewed and approved.');
    }
    return res.redirect('/');
  });
});

app.get('/remove', ensureAuthenticated, function(req, res) {
  var event;
  var id = sanitize.string(req.query.id);
  var date = sanitize.date(req.query.date);
  var whitelisted = false;
  return async.series({
    whitelist: function(callback) {
      if (req.admin) {
        whitelisted = true;
        return setImmediate(callback);
      }
      return model.whitelist.findOne({ _id: req.user.id }, function(err, _whitelisted) {
        if (err) {
          return callback(err);
        }
        whitelisted = !!_whitelisted;
        return callback(null);
      });
    },
    update: function(callback) {
      audit({ subject: req.user, verb: 'removed', object: id });
      if (whitelisted) {
        return model.events.remove({ _id: id }, callback);
      } else {
        notifyModerator();
        return model.events.update({ _id: id }, { $set: { remove: true } }, callback);
      }
    }
  }, function(err) {
    if (err) {
      console.log(err);
      return fail(req, res);
    }
    if (whitelisted) {
      req.flash('message', 'Thank you!');
    } else {
      req.flash('message', 'Thank you! Your edit will be reviewed and approved.');
    }
    return res.redirect('/');
  });
});

app.post('/edit', ensureAuthenticated, function(req, res) {
  var event;
  var id = sanitize.string(req.query.id);
  var whitelisted = false;
  return async.series({
    whitelist: function(callback) {
      if (req.admin) {
        whitelisted = true;
        return setImmediate(callback);
      }
      return model.whitelist.findOne({ _id: req.user.id }, function(err, _whitelisted) {
        if (err) {
          return callback(err);
        }
        whitelisted = !!_whitelisted;
        return callback(null);
      });
    },
    find: function(callback) {
      return model.events.findOne({ _id: id }, function(err, _event) {
        if (err) {
          return callback(err);
        }
        if (!_event) {
          req.flash('message', 'That event has already been removed.');
          return res.redirect('/');
        }
        event = _event;
        if (whitelisted) {
          delete event.draft;
          sanitizeEvent(req, req.body, event);
        } else {
          notifyModerator();
          event.draft = event.draft || {};
          sanitizeEvent(req, req.body, event.draft);
        }
        audit({ subject: req.user, verb: 'edited', object: event });
        contribute(req, event);
        return callback(null);
      });
    },
    update: function(callback) {
      if (req.body.remove) {
        return setImmediate(callback);
      }
      return model.events.update({ _id: id }, event, callback);
    }
  }, function(err) {
    if (err) {
      console.log(err);
      return fail(req, res);
    }
    if (whitelisted) {
      req.flash('message', 'Thank you!');
    } else {
      req.flash('message', 'Thank you! Your edit will be reviewed and approved.');
    }
    return res.redirect('/');
  });
});

app.get('/moderate', ensureAdmin, function(req, res) {
  return model.events.find({ $or: [ { pending: true }, { draft: { $exists: 1 } }, { remove: true } ] }).sort({ createdAt: 1 }).limit(1).toArray(function(err, events) {
    if (err) {
      return fail(req, res);
    }
    if (!events.length) {
      req.flash('message', 'All caught up!');
      return res.redirect('/');
    }
    var info = locals(req, {
      event: events[0],
      action: '/moderate?id=' + events[0]._id,
      moderating: true
    });
    if (info.event.draft) {
      info.event.original = _.omit(info.event, 'draft');
      _.extend(info.event, info.event.draft);
      delete info.event.draft;
    }
    return res.render('edit.html', info);
  });
});

app.post('/moderate', ensureAdmin, function(req, res) {
  var event;
  return async.series({
    findRejectOrRemove: function(callback) {
      if (req.body.reject) {
        return model.events.update({ _id: req.query.id }, { $unset: { draft: 1, remove: 1 } }, callback);
      } else if (req.body.remove) {
        return model.events.remove({ _id: req.query.id }, callback);
      } else {
        return model.events.findOne({ _id: req.query.id }, function(err, _event) {
          if (err) {
            return callback(err);
          }
          event = _event;
          sanitizeEvent(req, req.body, _event);
          delete event.pending;
          delete event.draft;
          delete event.remove;
          event.active = true;
          return callback(null);
        });
      }
    },
    update: function(callback) {
      if (!event) {
        return setImmediate(callback);
      }
      return model.events.update({ _id: req.query.id }, event, callback);
    },
    whitelist: function(callback) {
      if (!event) {
        return setImmediate(callback);
      }
      var ids = _.pluck(event.editors || [], 'id');
      return async.eachSeries(ids, function(item, callback) {
        return model.whitelist.update({ _id: item }, { _id: item }, { upsert: true }, callback);
      }, callback);
    }
  }, function(err) {
    if (err) {
      return fail(req, res);
    }
    // Go get another to moderate
    return res.redirect('/moderate');
  });
});

// GET /auth/facebook
//   Use passport.authenticate() as route middleware to authenticate the
//   request.  The first step in Facebook authentication will involve
//   redirecting the user to facebook.com.  After authorization, Facebook will
//   redirect the user back to this application at /auth/facebook/callback
app.get('/auth/facebook',
  passport.authenticate('facebook'),
  function(req, res) {
    // The request will be redirected to Facebook for authentication, so this
    // function will not be called.
});

// GET /auth/facebook/callback
//   Use passport.authenticate() as route middleware to authenticate the
//   request.  If authentication fails, the user will be redirected back to the
//   login page.  Otherwise, the primary route function function will be called,
//   which, in this example, will redirect the user to the home page.
app.get('/auth/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/login' }),
  function(req, res) {
    var after = req.session.afterLogin;
    if (after) {
      delete req.session.afterLogin;
      return res.redirect(after);
    }
    return res.redirect('/');
  }
);

return async.series({
  modelConnect: function(callback) {
    return mongodb.MongoClient.connect(
      local.db || 'mongodb://localhost:27017/salsadelphia',
      function(err, dbArg) {
        if (err) {
          return callback(err);
        }
        model.db = dbArg;
        return callback(null);
      }
    );
  },
  modelCollections: function(callback) {
    return async.eachSeries(collections, function(item, callback) {
      return model.db.collection(item, function(err, collection) {
        if (err) {
          return callback(err);
        }
        model[item] = collection;
        return callback(null);
      });
    }, callback);
  }
}, function(err) {
  if (err) {
    console.error('database connection error:');
    console.error(err);
    process.exit(1);
  }
  listen();
});

function listen() {
  var port = 3000;
  try {
    port = parseInt(fs.readFileSync('data/port'));
  } catch (e) {
    console.log('no port file, defaulting to port 3000');
  }

  return app.listen(port, function(err) {
    if (err) {
      console.error('Oops, port ' + port + ' not available. Are you running another app?');
      process.exit(1);
    } else {
      console.log('Listening on port ' + port + '.');
    }
  });
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    req.admin = (req.user && req.user.id === admin);
    return next();
  }
  if (req.method === 'GET') {
    req.session.afterLogin = req.url;
  }
  return res.redirect('/auth/facebook');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated()) {
    if (req.user.id === admin) {
      return next();
    }
    return res.redirect('/');
  }
  req.session.afterLogin = req.url;
  return res.redirect('/auth/facebook');
}

function locals(req, o) {
  var n = {
    dates: dates(),
    times: times(),
    moment: function(d, format) {
      return moment(d).format(format);
    },
    admin: req.user && (req.user.id === admin),
    weekdays: [
      'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
    ],
    message: req.flash('message')
  };
  if (o) {
    _.extend(n, o);
  }
  return n;
}

function dates() {
  var now = new Date();
  var dates = [];
  for (i = 0; (i < 60); i++) {
    dates.push(new Date(now.getTime() + i * 86400 * 1000));
  }
  return dates;
};

function times() {
  var now = new Date();
  var dates = [];
  now.setHours(18);
  now.setMinutes(0);
  for (i = 0; (i < 48); i++) {
    dates.push(new Date(now.getTime() + i * 1800 * 1000));
  }
  return dates;
};

function sanitizeEvent(req, data, event) {

  _.each(fields, function(type, name) {
    event[name] = sanitize[type](data[name]);
  });

  event.when = new Date(event.date + ' ' + event.time);
  event.createdAt = event.createdAt || new Date();

  // console.log(event);
}

function contribute(req, event) {
  event.editors = (event.editors || []).concat(_.pick(req.user, [ 'id', 'displayName', 'profileUrl' ]));
}

var guidSource;
var guidBuffer;

// Our "guids" are just 16 digits of random hex
function guid() {
  if (!guidSource) {
    guidSource = fs.openSync('/dev/urandom', 'r');
    guidBuffer = new Buffer(8);
  }
  fs.readSync(guidSource, guidBuffer, 0, 8, 0);
  return guidBuffer.toString('hex');
};

function fail(req, res) {
  return res.render('error.html');
}

// Keep an audit trail of all edits so we can
// reconstruct the database if a whitelisted person
// loses their mind

function audit(info) {
  info.when = new Date();
  return model.audit.insert(info, function(err) {
    if (err) {
      throw 'Audit failed!';
    }
  });
}

function notifyModerator() {
  return mailer.sendMail({
    from: 'boutell@boutell.com',
    to: 'boutell@boutell.com',
    subject: 'Moderation needed on salsadelphia.com',
    html: '<p>An edit has been made by someone who is not whitelisted yet.'
  }, function(err, info) {
    // That's nice
    if (err) {
      console.error(err);
    } else {
      console.log(info);
    }
  });
}

function repeatEvents(events) {
  var _events = [];
  var today = new Date();
  _.each(events, function(event) {
    if (!event.repeat) {
      _events.push(event);
    }
  });
  for (var i = 0; (i <= 60); i++) {
    var nthDay = new Date(today);
    nthDay.setDate(today.getDate() + i);
    var weekday = nthDay.getDay();
    var nth = Math.floor((nthDay.getDate() - 1) / 7);
    _.each(events, function(event) {
      var m;
      if (!event.repeat) {
        return;
      }
      var _event, m;
      if (event.days && event.days[nth] && event.days[nth][weekday]) {
        cloneEvent(event, nthDay);
        return;
      }
      // "Last Tuesday of month" is a special case
      if (event.days && event.days[5] && event.days[5][weekday]) {
        // Roll the katamari to the last day of this month
        var lastDay = new Date(nthDay);
        lastDay.setDate(1);
        lastDay.setMonth(lastDay.getMonth() + 1);
        lastDay.setDate(lastDay.getDate() - 1);
        var diff = lastDay.getDate() - nthDay.getDate();
        if (diff < 7) {
          cloneEvent(event, nthDay);
          return;
        }
      }
      function cloneEvent(event, today) {
        var m;
        _event = _.clone(event);
        m = moment(today);
        _event.date = m.format('YYYY-MM-DD');
        _event.when = moment(_event.date + ' ' + _event.time);
        _events.push(_event);
      }
    });
  }
  return _events;
}

function filterFuture(events, today) {
  return _.filter(events, function(event) {
    return (event.date >= today);
  });
}

function filterCanceled(events) {
  return _.filter(events, function(event) {
    return (!_.contains(event.cancellations || [], event.date));
  });
}

function sortEvents(events) {
  events.sort(function(a, b) {
    var ac = a.date + ':' + a.venue + ':' + a.time;
    var bc = b.date + ':' + b.venue + ':' + b.time;
    if (ac < bc) {
      return -1;
    } else if (ac > bc) {
      return 1;
    } else {
      return 0;
    }
  });
}
