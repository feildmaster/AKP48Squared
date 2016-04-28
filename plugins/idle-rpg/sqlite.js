'use strict';
const sqlite = require("sqlite3").verbose();
const SELECT_PLAYER = "SELECT name, pass, class as $class, online, level, next, idled, penalties, lastLogin, isAdmin, items FROM players";

// Export the database itself
var db = new sqlite.Database(require('path').resolve(__dirname, '.database'), setupDatabase);

module.exports = db;
module.exports.getOnlinePlayers = function (callback) {
  if (typeof callback !== "function") return; // This isn't valid, don't process
  
  db.all(`${SELECT_PLAYER} WHERE online = 1`, function (error, rows) {
    // Wrap into a single object
    callback({rows: rows, error: error});
  });
};

module.exports.getTopPlayers = function (limit, callback) {
  if (typeof limit === "function") {
    callback = limit;
    limit = 3;
  } else if (!limit || limit < 1) {
    limit = 3;
  }
  if (typeof callback !== "function") return; // This isn't valid, don't process
  
  // Highest 'level' first, followed by lowest 'next' (means they have more "exp")
  db.all(`${SELECT_PLAYER} ORDER BY level DESC, next ASC LIMIT ${limit}`, function (error, rows) {
    // Wrap into an object
    callback({rows: rows, error: error});
  });
};

module.exports.getPlayer = function (name, callback) {
  if (typeof callback !== "function") return; // This isn't valid, don't process
  
  db.get(`${SELECT_PLAYER} WHERE name = ${name}`, function (error, row) {
    callback({rows: [row], error: error});
  });
};

// Pass player to provide more information without needing to change the signature
module.exports.deletePlayer = function (player, callback) {
  // Callback isn't required here
  db.run("DELETE FROM players WHERE name = ?", player.name, function (error) {
    if (typeof callback !== "function") return; // This isn't valid, don't process
    callback({error: error, deletions: this.changes});
  });
};

module.exports.savePlayer = function (player, callback) {
  // Callback isn't required here
  db.run("INSERT OR REPLACE INTO players VALUES ($name, $pass, $class, $online, $level, $next, $idled, $penalties, $lastLogin, $isAdmin, $items)", player.save(), function (error) {
    if (typeof callback !== "function") return; // This isn't valid, don't process
    callback({error: error, saved: error ? false : this.lastID > 0});
  });
};

module.exports.updatePlayer = function (player, what, callback) {
  // Callback isn't required here
};

module.exports.loadChannels = function (callback) {
  if (typeof callback !== "function") return; // This isn't valid, don't process
  db.all("SELECT channel, options FROM channels", function (error, rows) {
    callback({rows: rows, error: error});
  });
};

module.exports.saveChannels = function (channels) {
  var statement = db.prepare("INSERT OR REPLACE INTO channels VALUES ($channel, $options)");
  Object.keys(channels).forEach(function (key) {
    GLOBAL.logger.debug(`IdleRPG: Saving channel: ${key}`);
    var options = JSON.stringify(channels[key]);
    if (!options) return;
    statement.run({
      $channel: key,
      $options: options
    }, function (error) {
      if (error) GLOBAL.logger.error(`IdleRPG: Error saving ${key}: ${error}`);
    });
  });
};

// *** Setup goes down here
var player_columns = [
  "name TEXT UNIQUE",
  "pass TEXT",
  "class TEXT",
  "online INT",
  "level INT",
  "next INT",
  "idled INT",
  "penalties INT",
  "lastLogin INT",
  "isAdmin INT",
  "items TEXT" // Store all items in a giant blob
];
function setupDatabase(error) {
  if (error) return GLOBAL.logger.error(error);
  GLOBAL.logger.debug("Setting up IdleRPG database");
  var player_def = player_columns.join(", ");
  // Sadly CREATE TABLE doesn't return any way to varify if it created or not
  db.run(`CREATE TABLE IF NOT EXISTS players (${player_def})`, function (error) {if (error) GLOBAL.logger.error(error);});
  setupChannels();
}

function setupChannels(callback) {
  db.run("CREATE TABLE IF NOT EXISTS channels (channel TEXT UNIQUE, options TEXT)", function (error) {
    if (error) return GLOBAL.logger.error(error);
    if (typeof callback === "function") callback();
  });
}
