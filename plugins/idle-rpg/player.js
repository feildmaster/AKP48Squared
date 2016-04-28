var item_types = ["helm", "shirt", "pants", "shoes", "gloves", "weapon", "shield", "ring", "amulet", "charm"];

module.exports = function (config, db) {
  function IdlePlayer() { 
    var name, pass, clazz; // player name, password, class
    var online = false; // Is the user online?
    var level, next, idled; // Current level, time until next level, total time idled
    var penalties = 0;
    var lastLogin; // last login time
    var isAdmin = false; // Is admin?
    var items = {}; // Current equipment
    Object.keys(item_types).forEach(function(type) {
      items[type] = 0;
    });
    this.users = []; // Keep a record of identified users
    
    // *** Method declarations
    function update(time) {
      // Is owner online and idling?
      if (!online) return false;
      next -= time;
      idled += time;
      if (next <= 0) {
        level++;
        next += Math.round(config.base * (config.step ^ level));
        return true;
      }
      return false;
    }
    
    function isAdmin() {
      return isAdmin;
    }
    
    function setAdmin(value) {
      // Force true/false
      isAdmin = value ? true : false;
    }
    
    function isOnline() {
      return online;
    }
    
    function getName() {
      return name;
    }
    
    function getClass() {
      return clazz;
    }
    
    function getItemCount() {
      var count = 0;
      Object.keys(items).forEach(key => count += items[key]);
      return count;
    }
    
    function isPassword(password) {
      return password === pass;
    }
    
    // Mark as online
    function login(userhost) {
      // Already online?
      if (online) {
        return false;
      }
      online = true;
      lastLogin = time;
      return true;
    }
    
    function logout() {
      online = false;
    }
    
    // Penalize a user for X base * variable amount
    function penalize(time) {
      time *= (config.pStep ^ level);
      var limit = config.penaltyLimit;
      if (limit) time = Math.min(time, limit);
      next += time;
      penalties += time;
      return time;
    }
    
    function _load(data) {
      if (data.$name) name = data.$name;
      if (data.$pass) pass = data.$pass;
      if (data.$class) $class = data.$class;
      if (data.$online) online = data.$online;
      if (data.$level) level = data.$level;
      if (data.$next) next = data.$next;
      if (data.$idled) idled = data.$idled;
      if (data.$penalties) penalties = data.$penalties;
      if (data.$lastLogin) lastLogin = data.$lastLogin;
      if (data.$isAdmin) isAdmin = data.$isAdmin;
      if (data.$items) {
        // Loop through item keys, only set what exists
        var $items = JSON.parse(data.$items);
        for (var item in Object.keys($items)) {
          if (items.hasOwnProperty(item)) items[item] = $items[item];
        }
      }
      return this;
    }
    
    function save() {
      return {
        $name: name,
        $pass: pass,
        $class: $class,
        $online: online,
        $level: level,
        $next: next,
        $idled: idled,
        $penalties: penalties,
        $lastLogin: lastLogin,
        $isAdmin: isAdmin,
        $items: JSON.stringify(items)
      };
    }
  }
  
  IdlePlayer.createPlayer = function (data) {
    return new IdlePlayer()._load(data);
  };
  
  return IdlePlayer;
};
