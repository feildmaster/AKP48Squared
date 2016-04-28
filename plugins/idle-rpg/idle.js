'use strict';
// Imports
const MessageHandlerPlugin = require('../../lib/MessageHandlerPlugin');
const DB = require("./sqlite");
const $s = require("./simple-seconds");

// *** Helper functions
// Check if `text` is a channel
function isChannel(text) {
  return /^[#&+!][^\x07\x2C\s]{0,50}$/.test(text);
}

// Pad a string to given length with given padding
function pad(text, length, padding) {
  length = length || 2;
  padding = padding || " ";
  while (text.length < length) {
    text = padding + text;
  }
  return text;
}

function interval(func, wait, times, _this) {
  var inner = function (t) {
    return function () {
      if (typeof t !== "undefined" && t-- > 0) {
        return;
      }
      setTimeout(inner, wait);
      try {
        func.call(_this);
      } catch (e) {
        t = 0; // Don't call again
        throw e; // Throw orriginal error
      }
    };
  }(times);
  setTimeout(inner, wait);
}

// Logging methods
var debug = function (message) {_log("debug", message);},
  error = function (message) {_log("error", message);},
  info = function (message) {_log("info", message);},
  _log = function (level, message) {GLOBAL.logger[level](`IdleRPG: ${message}`);};

// *** Constant values
var config = { // Perhaps allow options to be mutable with config/commands
  enabled: false,
  base: 600,
  step: 1.16,
  pStep: 1.14,
  penaltyLimit: 0 // Set higher than 0 if you want to put a limit to how much of a penalty someone can get at once
  //, clock: 3 // Buffer time in seconds, 1-60 (may not need/want this)
};

var servers = {
  // ID: instance
};

var chanOpts = {
  "start": "noticeStart", // Displays notice when the game starts (Bot just re/connected) TODO
  "level": "noticeLevelUps", // Display level ups
  "top": "noticeTopPlayers", // Display notice of top players
  "battle": "noticeBattles", // Display notice of battles
  "login": "noticeLogin", // Displays notice that player was created
  "join": "noticeWelcome", // Displays notice that player was created
  "del": "noticeDel", // Displays notice that player was deleted
  "admin": "noticeAdmin", // Admin command outputs (delete old accounts, delete player, )
  "push": "noticePush" // Pushed time to player from admin
};

var channels = {
  // ID_name: options
};

var players = { // Players get loaded as they login
  // ID_nick: IdlePlayer
};

// Pass DB and config
const IdlePlayer = require("./player")(config, DB);

// *** Classes
class IdleRPG extends MessageHandlerPlugin {
	constructor(AKP48, _config) {
		super('IdleRPG', AKP48);
    var self = this;
		self.commands = {};
    if (_config) {
      // Merge values from _config into config
      Object.keys(_config).forEach(function (key) {
        if (config.hasOwnProperty(key)) { config[key] = _config[key]; }
        //else if (key === "oldKey") {config["newKey"] = _config[key]}
      });
    }
    // Always save, in case of a change in config style
    self.saveConfig();
		require('./commands').then(function(res){
      self.commands = res;
    }, function(err){
      error(err);
    });
    
    self._utime = 0;
    self._ltime = 1; // When we are setup we set ltime to current time
    
    AKP48.on("serverConnect", function(id, instance) {
      // Delayed first-time-setup
      if (self._ltime === 1) {
        self._ltime = $s.time();
        // Load channels when we get a server instance
        DB.loadChannels(function (data) {
          if (data.error) return error(`Error loading channel data: ${data.error}`);
          else debug(`Loading channels: ${data.rows.length}`);
          data.rows.forEach(function (row) {
            debug(`Loading channel: ${row.channel}`);
            var options = self.getChannelOptions(row.channel);
            Object.keys(row.options).forEach(function(o) {
              if (options.hasOwnProperty(o)) options[o] = row.options[o] ? true : false; // Force boolean
            });
          });
        });
      }
      
      if (instance.pluginName !== "IRC") return;
      var IRC = instance._client;
      servers[id] = instance; // Store servers, otherwise we can't send game updates
      
      var send = self._sendMessage;
      
      IRC.on("notice", function(nick, to, text, message) {
        if (!config.enabled) return;
        // If channel, and channel is participating in the game
        if (!isChannel(to) || !self.getChannelOptions(`${id}_${to}`).enabled) return;
        var uid = `${id}_${oldNick}`;
        var player = self.findPlayer(uid);
        // If player
        if (!player) return;
        // Penalize based off of text.length
        var penalty = player.penalize(text.length);
        send(instance, nick, `For the discraceful act of sending a message in ${to}, you have been penalized ${penalty} seconds.`);
      });
      IRC.on("nick", function(oldNick, newNick, chans) {
        if (!config.enabled) return;
        // Nick applies server-wide, so if oldNick is a player we penalize them
        var uid = `${id}_${oldNick}`;
        // We don't use the findPlayer method here, because we might store empty nicks if they haven't logged in yet
        var player;
        if (players.hasOwnProperty(uid)) {
          // Insert new player
          players[`${id}_${newNick}`] = player = players[uid];
          // Delete the old player
          delete players[uid];
        }
        if (!player) return;
        var penalty = player.penalize(30);
        send(instance, newNick, `You have been penalized ${penalty} seconds for nick changing.`);
      });
      IRC.on("part", function(channel, nick) {
        if (!config.enabled) return;
        // If channel is playing the game
        if (!self.getChannelOptions(`${id}_${channel}`).enabled) return;
        var uid = `${id}_${nick}`;
        var player = self.findPlayer(uid);
        if (!player) return;
        // Penalize nick if is player
        var penalty = player.penalize(200);
        send(instance, nick, `You have been penalized ${penalty} seconds for parting ${channel}.`);
      });
      IRC.on("kick", function(channel, nick) {
        if (!config.enabled) return;
        // If channel is playing the game
        if (!self.getChannelOptions(`${id}_${channel}`).enabled) return;
        var uid = `${id}_${nick}`;
        // Penalize nick if is player
        var penalty = player.penalize(250);
        send(instance, nick, `You have been penalized ${penalty} seconds for getting kicked from ${channel}.`);
      });
      IRC.on("quit", function(nick) {
        if (!config.enabled) return;
        var uid = `${id}_${nick}`;
        var player = self.findPlayer(uid);
        if (!player) return;
        // Penalize nick if is player
        var penalty = player.penalize(20);
        player.logout();
      });
    });
    
    // Update every second
    interval(self.update, 1);
	}
}

IdleRPG.prototype.handleMessage = function(message, context, resolve) {
  if (!this.processContext(context)) return resolve();
  if (context.isPM) return resolve(this._handleCommand(message, context)); // We don't penalize for PM's... even if we don't do anything
  // Disabled in channel, player doesn't exist
  if (!context.irpgEnabled || !context.player) return resolve();
  // Penalize based off of message length
  var penalty = context.player.penalize(message.length);
  // Send message to player
  this._sendMessage(context.instance, context.user, `For the discraceful act of sending a message in ${context.to}, you have been penalized ${penalty} seconds.`);
  resolve();
};

IdleRPG.prototype.handleCommand = function(message, context, resolve) {
  if (this.processContext(context)) this._handleCommand(message, context);
  resolve();
};

IdleRPG.prototype._handleCommand = function(message, context) {
  var text = message.split(" ")
  // Check if it's the IDLE command
  if (!["idle-rpg", "idle", "irpg"].includes(text.shift().toLowerCase())) return;
  
  var command = text.shift();
  if (!command) return; // No command? TODO: maybe default to help?
  
  context.irpgText = text.join(" ");
  context.irpgCommand = command;
  
  Object.keys(this.commands).forEach(function(key) {
    var cmd = this.commands[key];
    if (!config.enabled && !cmd.admin) return; // Game isn't enabled, and it's not an admin command?
    if (!context.irpgEnabled && !(cmd.bypass || cmd.admin)) return; // Game isn't enabled in channel, and command doesn't bypass?
    debug(`Checking ${key} command for ${command}.`);
    if (!cmd.names.includes(command.toLowerCase())) return;
    if (cmd.perms) {
      if (!context.permissions || !Array.isArray(context.permissions)) {
        return debug(`Command ${command} requires permissions and none were found.`);
      }
      if (!Array.isArray(cmd.perms)) cmd.perms = [cmd.perms]; // Make it an array
      var block = true;
      for (var i = 0; i < cmd.perms.length; i++) {
        if (context.permissions.includes(cmd.perms[i])) {
          block = false;
          break;
        }
      }
      if (block) {
        return debug(`Command ${command} requires permissions and none were found.`);
      }
    }
    // Passed all checks, run the command
    if (cmd.process) cmd.process(context);
  }, this);
};

IdleRPG.prototype.getChannelOptions = function(channel) {
  if (!this.channelExists(channel)) {
    channels[channel] = {
      enabled: false, // Do not default to enabled. This must be explicitly set!
    };
    Object.keys(chanOpts).forEach(function(key) {
      channels[channel][chanOpts[key]] = true;
    });
  }
  
  return channels[channel];
};

IdleRPG.prototype.getConfig = function() {
  return config;
};

IdleRPG.prototype.channelExists = function (channel) {
  return channels.hasOwnProperty(channel);
};

// TODO: DB checks and methods
IdleRPG.prototype.playerLoaded = function(userhost) {
  return players.hasOwnProperty(userhost);
};

IdleRPG.prototype.findPlayer = function(userhost) {
  if (this.playerLoaded(userhost)) {
    var player = players[userhost];
    // TODO: Check if any nicks are online
    if (player && player.isOnline()) return player;
  }
  return false;
};

IdleRPG.prototype.unload = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.save(function (saved) {
      // Close the database, then resolve
      DB.close(function (error) {
        if(true) { // For now, always save
          resolve(true);
        } else {
          reject(`Database Error: ${saved}`);
        }
      });
    });
  });
};

IdleRPG.prototype.processContext = function(context) {
  // Check if IRC connection TODO: ALL the connections!
  if (context.instanceType !== "irc") return;
  // Check if IRC channel is participating in game (private messages need special handling)
  if (isChannel(context.to)) {
    var gameChannel = context.instanceId + context.to;
    context.irpgEnabled = this.getChannelOptions(gameChannel).enabled;
    context.irpgChannel = gameChannel;
    context.isPM = false;
  } else {
    // PM? let it slide
    context.irpgEnabled = true;
    context.isPM = true;
  }
  
  var send = this._sendMessage;
  // Replies to sender if PM, channel if not
  context.reply = function (message, target) {
    target = target || this.isPM ? context.nick : context.to; // If no target is specified, target the user
    send(this.instance, target, message);
  };
  
  // Check if sender is a player
  context.player = this.findPlayer(`${context.instanceId}_${context.nick}`); // Players get stored by ServerID+nick...
  context.irpg = this;
  return true;
};

// Return human readable time
IdleRPG.prototype.duration = function(time) {
  if (!/^\d+$/.test(time)) {
    return `NaN (${time})`;
  }
  var days = Math.floor(time/$s.oneDay),
    day = days == 1 ? "day" : "days",
    hours = pad(Math.floor(time%$s.oneDay/$s.oneHour), 2, "0"),
    minutes = pad(Math.floor(time%$s.oneHour/$s.oneMinute), 2, "0"),
    seconds = pad(Math.floor(time%$s.oneMinute), 2, "0");
  return `${days} ${day}, ${hours}:${minutes}:${seconds}`;
};

IdleRPG.prototype.update = function() {
  if (!config.enabled) return;
  // Do we have any players online?
  var online = Object.keys(players).filter(key => players[key].isOnline()).length;
  if (online === 0) return;
  
  var self = this;
  // We haven't joined any channels
  if (self._ltime === 1) return;
  var nTime = $s.time();
  var uTime = nTime - self._ltime;
  var msgs = [];
  // Report the top (3) players every 10 hours
  if (self._utime % $s.inHours(10) === 0) {
    self.getTopPlayers(function (players) {
      msgs.push("Top Players:");
      var i = 0;
      players.forEach(function (player) {
        i++;
        var name = player.getName(),
          clazz = player.getClass(),
          level = player.getLevel();
        msgs.push(`#${i}: ${name}, the level ${level} ${clazz}!`);
      });
      if (i === 0) msgs.push("No players found!");
      self.sendMessages(msgs, "top");
    });
  }
  
  // Update players
  Object.keys(players).forEach(function(key) {
    var player = players[key];
    if (player.update(uTime)) self.doLevelUp(player);
  });
  self._utime += uTime;
  self._ltime = nTime;
};

// Oh my god sending messages (out of context) is a headache!
IdleRPG.prototype.sendMessages = function (messages, type, filter) {
  var force = type === "force";
  if (type && chanOpts.hasOwnProperty(type)) type = chanOpts[type];
  else type = false;
  if (!Array.isArray(messages)) {
    messages = [messages];
  }
  var chans = Object.keys(channels).filter(key => channels[key].enabled); // Send to all (enabled) channels
  if (!force && type) {
    chans = chans.filter(key => channels[key][type]); // Send to type enabled channels
  }
  if (filter) {
    chans = chans.filter(key => {
      var value = filter.call(null, channels[key]);
      return typeof value === undefined || value ? true : false; // If it's undefined or truthy we keep it
    });
  }
  
  var self = this;
  chans.forEach(function (chan) {
    var server = chan.substring(0, chan.indexOf("_"));
    var channel = chan.substring(chan.indexOf("_") + 1)
    if (!servers.hasOwnProperty(server)) return;
    server = servers[server];
    messages.forEach(function (msg) {
      self._sendMessage(server, channel, msg);
    });
  }); 
};

// Send supplied message on specified server, to specified target
IdleRPG.prototype._sendMessage = function(server, target, message) {
  if (!server) return debug("Tried to send message without a server");
  if (!target) return debug("Tried to send message without a target");
  if (!message) return debug("Tried to send message without a message");
  server._client.say(target, "IdleRPG: " + message); // Prefix all messages with IdleRPG so they know what the message is about.
  this._AKP48.sentMessage(target, message, {myNick: server._client.nick, instanceId: server._id});
};

IdleRPG.prototype.doLevelUp = function(user) {
  // Give a notice to channels that don't have announcements blocked
  // Find an item
  // Battle
};

IdleRPG.prototype.save = function(callback) {
  debug("Saving config");
  this.saveConfig();
  debug(`Saving ${Object.keys(channels).length} channels`);
  // saveChannels.then(savePlayers.then(callback(error);));
  DB.saveChannels(channels);
  var $players = Object.keys(players);
  var finishedWithoutError = true;
  debug(`Saving ${$players.length} players`);
  /*(function saveNextPlayer() {
    if ($players) {
      var player = players[$players.shift()];
      if (!player) return saveNextPlayer(); // Don't have a player object? Go to next player
      DB.savePlayer(player, function (data) {
        if (data.error) {
          error(data.error);
          finishedWithoutError = false;
        }
        saveNextPlayer();
      });
    } else callback(finishedWithoutError);
  })();*/
  callback(true);
};

IdleRPG.prototype.saveConfig = function() {
  this._AKP48.saveConfig(config, "idle-rpg");
};

IdleRPG.prototype.getTopPlayers = function(count, callback) {
  if (typeof count === "function") {
    callback = count;
    count = null;
  }
  if (typeof callback !== "function") return;
  // Save current player data
  this.save(function (saved) {
    // After saving get the top players
    DB.getTopPlayers(count, function (data) {
      if (data.error) return error(data.error);
      // If there's no error, let's callback to home with the top players :D
      callback(makePlayersFromData(data.rows));
    });
  });
  
};

function makePlayersFromData(data) {
  var arr = [];
  // Create users, what happens with these users is up to the caller
  return arr;
}

function random(low, high) {
  if (typeof high === "undefined") {
    high = low;
    low = 0;
  }
  return Math.floor(Math.random() * (high - low) + low);
}

module.exports = IdleRPG;
