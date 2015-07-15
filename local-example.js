// mkdir data
// cp local-example.js data/local.js
// edit data/local.js

module.exports = {
  facebook: {
    appId: "getyourown",
    appSecret: "getyourown",
    admin: "yourownfacebookid",
    // dev example
    callback: "http://test.salsadelphia.com:3000/auth/facebook/callback"
    // prod example
    // callback: "http://salsadelphia.com/auth/facebook/callback"
  },
  sessionSecret: 'makeupyourown'
};
