const db = require("../db");

function ensureTable(cb) {
  const sql = `
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      plan ENUM('BASIC','PREMIUM') NOT NULL DEFAULT 'BASIC',
      status ENUM('ACTIVE','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
      startDate DATETIME NOT NULL DEFAULT NOW(),
      endDate DATETIME NULL,
      autoRenew TINYINT(1) NOT NULL DEFAULT 0,
      CONSTRAINT fk_sub_user FOREIGN KEY (userId) REFERENCES users(id)
    );
  `;
  db.query(sql, cb);
}

async function handleExpiry(row) {
  return row; // no mutation on read
}

const Subscription = {
  getByUser(userId, cb) {
    db.query(`SELECT * FROM subscriptions WHERE userId=? ORDER BY id DESC LIMIT 1`, [userId], (e, rows)=>{
      if (e && e.code === 'ER_NO_SUCH_TABLE') return cb(null, null);
      cb(e, rows && rows[0]);
    });
  },
  create(userId, plan, autoRenew, cb) {
    db.query(
      `INSERT INTO subscriptions (userId, plan, status, autoRenew, endDate) VALUES (?, ?, 'ACTIVE', ?, DATE_ADD(NOW(), INTERVAL 1 MONTH))`,
      [userId, plan, autoRenew ? 1 : 0],
      (e, r) => {
        if (e && e.code === 'ER_NO_SUCH_TABLE') {
          return ensureTable((err2) => {
            if (err2) return cb(err2);
            db.query(
              `INSERT INTO subscriptions (userId, plan, status, autoRenew, endDate) VALUES (?, ?, 'ACTIVE', ?, DATE_ADD(NOW(), INTERVAL 1 MONTH))`,
              [userId, plan, autoRenew ? 1 : 0],
              cb
            );
          });
        }
        cb(e, r);
      }
    );
  },
  cancel(id, cb) {
    db.query(`UPDATE subscriptions SET status='CANCELLED', endDate=NOW(), autoRenew=0 WHERE id=?`, [id], (e, r) => {
      if (e && e.code === 'ER_NO_SUCH_TABLE') {
        return ensureTable((err2) => cb(err2));
      }
      cb(e, r);
    });
  },
  adminAll(cb) {
    db.query(`SELECT s.*, u.username, u.email FROM subscriptions s JOIN users u ON u.id=s.userId ORDER BY s.id DESC`, (e, rows)=>{
      if (e && e.code === 'ER_NO_SUCH_TABLE') return cb(null, []);
      cb(e, rows);
    });
  }
};
module.exports = Subscription;
