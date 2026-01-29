const util = require("util");
const db = require("../db");

module.exports = {
  query(sql, params = []) {
    return util.promisify(db.query).call(db, sql, params);
  },
  begin() {
    return util.promisify(db.beginTransaction).call(db);
  },
  commit() {
    return util.promisify(db.commit).call(db);
  },
  rollback() {
    return util.promisify(db.rollback).call(db);
  },
};
