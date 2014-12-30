module.exports = searchify;

var slugify = require('sluggo');

function sortify(s) {
  return slugify(s, { separator: ' ' });
}

function searchify(q, prefix) {
  q = sortify(q);
  if (prefix) {
    q = '^' + q;
  }
  q = q.replace(/ /g, ' .{0,20}?');
  q = new RegExp(q, 'i');
  return q;
};
