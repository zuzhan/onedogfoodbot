var Token = function () {
    var tokenStorage = {};

    this.AddToken = function (senderId, token) {
      if (senderId && token) {
        tokenStorage[senderId] = token;
        return true;
      }
      return false;
    };

    this.GetToken = function (senderId) {
      if (tokenStorage[senderId]) {
        return tokenStorage[senderId];
      }
      return false;
    };

    this.AlreadyLoggedIn = function (senderId) {
      if (tokenStorage[senderId] && tokenStorage[senderId]["access_token"]) {
        return true;
      }
      return false;
    }
};
module.exports = new Token();
