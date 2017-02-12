var Token = function () {
    var tokenStorage = {};
    var defaultSections = {};
    var favouritePages = {};

    this.setDefaultSectionId = function (senderId, sectionId) {
      if (senderId && sectionId) {
        defaultSections[senderId] = sectionId;
        return true;
      }
      return false;
    };

    this.getDefaultSectionId = function (senderId) {
      if (defaultSections[senderId]) {
        return defaultSections[senderId];
      }
      return false;
    };

    this.addFavouritePageId = function (senderId, pageId) {
      if (senderId && pageId) {
        if (!favouritePages[senderId]) {
          favouritePages[senderId] = [];
        }
        if (favouritePages[senderId].length >= 10) {
          favouritePages[senderId].pop();
        }
        favouritePages[senderId].unshift(pageId);
        return true;
      }
      return false;
    } 

    this.getFavouritePageIds = function (senderId) {
      return favouritePages[senderId];
    }

    this.GetToken = function (senderId) {
      if (tokenStorage[senderId]) {
        return tokenStorage[senderId];
      }
      return false;
    };

    this.AddToken = function (senderId, token) {
      if (senderId && token) {
        tokenStorage[senderId] = token;
        return true;
      }
      return false;
    };

    this.AlreadyLoggedIn = function (senderId) {
      if (tokenStorage[senderId] && tokenStorage[senderId].access_token) {
        return true;
      }
      return false;
    }

    this.GetAcessToken = function (senderId) {
      if (tokenStorage[senderId] && tokenStorage[senderId].access_token) {
        return tokenStorage[senderId].access_token;
      }
      return undefined;
    }
};
module.exports = new Token();
