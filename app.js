var appy = require('appy');
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

var mailer = nodemailer.createTransport(sendmailTransport({}));

var local = require('./data/local.js');

var admin = local.facebook.admin;

RegExp.quote = require('regexp-quote');

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

appy.bootstrap({
  passport: passport,
  // Hardcode some users. Will also look for users in the users collection by default
  auth: {
    strategy: 'local',
    options: {
      users: {
        admin: {
          username: 'admin',
          password: 'demo'
        }
      }
    }
  },
  // An alternative: Twitter auth
  // auth: {
  //   strategy: 'twitter',
  //   options: {
  //     consumerKey: 'xxxx',
  //     consumerSecret: 'xxxx',
  //     callbackURL: 'http://my.example.com:3000/twitter-auth'
  //   }
  // },

  // Serve static files
  static: __dirname + '/public',

  // Lock all URLs beginning with this prefix to require login. You can lock
  // an array of prefixes if you wish . Prefixes must be followed by / or . or
  // be matched exactly. To lock everything except the login mechanism itself,
  // use locked: true
  // locked: '/new',

  // If you're using locked: true you can make exceptions here
  // unlocked: [ '/welcome' ]

  // Choose your own please
  sessionSecret: 'uiy786ftuybugftguy',

  sessions: {
    // You can pass options directly to connect-mongo here to customize sessions
  },

  // Redirects to this host if accessed by another name
  // (canonicalization). This is pretty hard to undo once
  // the browser gets the redirect, so use it in production only
  // host: 'my.example.com:3000',

  // Database configuration
  db: {
    // MongoDB URL to connect to
    uri: 'mongodb://localhost:27017/salsadelphia',

    // These collections become available as appy.posts, etc.
    collections: [ 'events', 'whitelist', 'audit' ]

    // If I need indexes I specify that collection in more detail:
    // [ { name: 'posts', index: { fields: { { title: 1 } }, unique: true } } ]
    // Or more than one index:
    // [ { name: 'posts', indexes: [ { fields: { { title: 1 } } }, ... ] } ]
  },

  // This is where your code goes! Add routes, do anything else you want to do,
  // then call appy.listen

  ready: function(app, db) {
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

      return appy.events.find({ active: true }).toArray(function(err, events) {
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
          if (admin) {
            event.active = true;
            return setImmediate(callback);
          }
          return appy.whitelist.findOne({ _id: req.user.id }, function(err, whitelisted) {
            if (err) {
              return callback(err);
            }
            if (whitelisted) {
              event.active = true;
            } else {
              event.pending = true;
            }
          }, callback);
        },
        insert: function(callback) {
          audit({ subject: req.user, verb: 'added', object: event });
          event._id = guid();
          return appy.events.insert(event, callback);
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
      return appy.events.find(q).toArray(function(err, events) {
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
      return appy.events.findOne({ _id: id }, function(err, event) {
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
      return appy.events.findOne({ _id: id }, function(err, event) {
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
          if (admin) {
            whitelisted = true;
            return setImmediate(callback);
          }
          return appy.whitelist.findOne({ _id: req.user.id }, function(err, _whitelisted) {
            if (err) {
              return callback(err);
            }
            whitelisted= !!_whitelisted;
            return callback(null);
          }, callback);
        },
        update: function(callback) {
          audit({ subject: req.user, verb: 'cancelled', object: id });
          if (whitelisted) {
            return appy.events.update({ _id: id }, { $addToSet: { cancellations: date } }, callback);
          } else {
            notifyModerator();
            // Little bit of a hassle, we have to create a draft at
            // this point if there isn't one already
            var event;
            return async.series({
              get: function(callback) {
                return appy.events.findOne({ _id: id }, function(err, _event) {
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
                if (!event.draft) {
                  event.draft = _.pick(event, _.keys(fields));
                }
                event.draft.cancellations = (event.draft.cancellations || []).concat(date);
                return appy.events.update({ _id: id }, event, callback);
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
          if (admin) {
            whitelisted = true;
            return setImmediate(callback);
          }
          return appy.whitelist.findOne({ _id: req.user.id }, function(err, _whitelisted) {
            if (err) {
              return callback(err);
            }
            whitelisted= !!_whitelisted;
            return callback(null);
          }, callback);
        },
        update: function(callback) {
          audit({ subject: req.user, verb: 'removed', object: id });
          if (whitelisted) {
            return appy.events.remove({ _id: id }, callback);
          } else {
            notifyModerator();
            return appy.events.update({ _id: id }, { $set: { remove: true } }, callback);
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
          if (admin) {
            whitelisted = true;
            return setImmediate(callback);
          }
          return appy.whitelist.findOne({ _id: req.user.id }, function(err, _whitelisted) {
            if (err) {
              return callback(err);
            }
            whitelisted= !!_whitelisted;
            return callback(null);
          }, callback);
        },
        find: function(callback) {
          return appy.events.findOne({ _id: id }, function(err, _event) {
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
          return appy.events.update({ _id: id }, event, callback);
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
      return appy.events.find({ $or: [ { pending: true }, { draft: { $exists: 1 } }, { remove: true } ] }).sort({ createdAt: 1 }).limit(1).toArray(function(err, events) {
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
            return appy.events.update({ _id: req.query.id }, { $unset: { draft: 1, remove: 1 } }, callback);
          } else if (req.body.remove) {
            return appy.events.remove({ _id: req.query.id }, callback);
          } else {
            return appy.events.findOne({ _id: req.query.id }, function(err, _event) {
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
          return appy.events.update({ _id: req.query.id }, event, callback);
        },
        whitelist: function(callback) {
          if (!event) {
            return setImmediate(callback);
          }
          var ids = _.pluck(event.editors || [], 'id');
          return async.eachSeries(ids, function(item, callback) {
            return appy.whitelist.update({ _id: item }, { _id: item }, { upsert: true }, callback);
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

    appy.listen();
  }
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  req.session.afterLogin = req.url;
  return res.redirect('/auth/facebook');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated()) {
    if (req.user.id === admin) {
      return next();
    }
    return res.redirect('/');
  }
  req.session.afterLogin = req.query.url;
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

var fs = require('fs');

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
  return appy.audit.insert(info, function(err) {
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
