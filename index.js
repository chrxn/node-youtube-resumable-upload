var fs      = require('fs');
var request   = require('request');
var mime    = require('mime');
var util    = require('util');
var Promise = require("bluebird");
var debug = require('debug')('youtube-resumable-upload');

if (!String.prototype.startsWith) {
  String.prototype.startsWith = function(search, pos) {
    return this.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
  };
}
// https://stackoverflow.com/a/33159592/2000485
Object.defineProperty(Object.prototype, "getProp", {
    value: function (prop) {
        var key,self = this;
        for (key in self) {
            if (key.toLowerCase() == prop.toLowerCase()) {
                return self[key];
            }
        }
    },
    //this keeps jquery happy
    enumerable: false
});

function resumableUpload() {
  this.byteCount  = 0; //init variables
  this.tokens = {};
  this.file = '';
  this.size = 0;
  this.type = '';
  this.metadata = {};
  this.playlists = [];
  this.retry  = -1;
  this.host = 'www.googleapis.com';
  this.api  = '/upload/youtube/v3/videos';
};

//Init the upload by POSTing google for an upload URL (saved to self.location)
resumableUpload.prototype.upload = function() {
  var self = this;
  return self.getUploadInfo()
    .then(function(){
      return self.startUpload();
    })
    .then(function(){
      debug("should start sending");
      return self.send();
    })
    .then(function(d){
      debug("COMPLETE!",d);
      return d;
    })
    .catch(function(err){
      debug("upload catch",err);
    });
}

resumableUpload.prototype.startUpload = function() {
  var self = this;
  return new Promise(function (resolve, reject) {
    debug("starting upload");
    var options = {
      url:  'https://' + self.host + self.api + '?uploadType=resumable&part=snippet,status,contentDetails',
      headers: {
        'Host':     self.host,
        'Authorization':    'Bearer ' + self.tokens.access_token,
        'Content-Length':   new Buffer(JSON.stringify(self.metadata)).length,
        'Content-Type':   'application/json',
        'X-Upload-Content-Length':  self.size,
        'X-Upload-Content-Type': self.type
      },
      body: JSON.stringify(self.metadata),
      json:true
    };
    //Send request and start upload if success
    request.post(options, function(err, res, body) {
      if (err || !res.headers.location || res.statusCode === 401) {
        debug("Error on start upload",err);
        if ((self.retry > 0) || (self.retry <= -1)) {
          debug("start upload - retrying");
          self.retry--;
          if(res.statusCode === 401){
            return self.refreshTokens()
              .then(function(){
                return self.startUpload()
                .then(function(l){
                  return resolve(l);
                })
                .catch(function(e){
                  return reject(e);
                });
              });
          }
          else{
            return self.startUpload()
            .then(function(l){
              return resolve(l);
            })
            .catch(function(e){
              return reject(e);
            });
          }
        }
        else{
          debug("Status Code: " + res.statusCode + " Error: " + err + " Body: " + body)
          return reject({status:"Failed", message: "Failed to start upload. Exhausted retry attempts. Status Code: " + res.statusCode + " Error: " + err});
        }
      }
      else{
        self.location = res.headers.location;
        debug("start upload finished");
        return resolve(self.location);
      }
    });
  });
}

resumableUpload.prototype.refreshTokens = function(){
  var self = this;
  debug("refreshing tokens");
  return new Promise(function (resolve, reject) {
    var params = {
      client_id: self.tokens.client_id,
      client_secret: self.tokens.client_secret,
      grant_type: "refresh_token",
      refresh_token: self.tokens.refresh_token
    };
    request.post({url:"https://accounts.google.com/o/oauth2/token", form: params, json:true}, function(err, res, body) {
      self.tokens.access_token = body.access_token;
      debug("token refreshed");
      return resolve();
    });
  });
}
resumableUpload.prototype.addVideoToPlaylists = function(video, playlists){
  var self = this;
  return new Promise(function (resolve, reject) {
    var itemsProcessed = [];
    if(!playlists || playlists.length === 0){
      debug("video is not being added to any playlists");
      return resolve(itemsProcessed);
    }
    else{
      playlists.forEach(function(playlistId, index, array){
        self.addVideoToPlaylist(video, playlistId)
        .then(function(result){
          itemsProcessed.push(result);
          if(itemsProcessed.length === array.length) {
            debug("added to playlists",itemsProcessed);
            return resolve(itemsProcessed);
          }
        });
      });
    }
  });
  
}

resumableUpload.prototype.addVideoToPlaylist = function(video, playlistId){
  var self = this;
  return new Promise(function (resolve, reject) {
    var params = {
      snippet:{
          playlistId:playlistId,
          resourceId:
          {
              kind: "youtube#video",
              videoId: video.id
          }
      }
    };
    debug("adding video to playlist", playlistId);
    request.post({
      url:"https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status", 
      headers: {
        'Authorization': 'Bearer ' + self.tokens.access_token,
        'Content-Length': new Buffer(JSON.stringify(params)).length,
        'Content-Type': "application/json; charset=UTF-8"
    },body: params, json:true }, function(err, res, body) { // youtube api does not support form, use body
      var result = {};
      if(err){
        result[playlistId] = {succeeded:false,message:err};
      }
      else{
        result[playlistId] = {succeeded:true,message:body};
      }
      debug("adding to playlist " + playlistId + " result", result[playlistId]);
      return resolve(result);
    });
  });
}

resumableUpload.prototype.getUploadInfo = function(callback){
  debug("getting upload info");
  var self = this;
  return new Promise(function (resolve, reject) {
    if(typeof self.file === 'string' && (self.file.startsWith('http://')||self.file.startsWith('https://'))){
      debug("Getting upload info via http request");
      request.head({url:self.file},function(err,res,body){
        if(err || !(200 <= res.statusCode && res.statusCode < 400)){
          debug("Error fetching file. Response: " + res.statusCode + " - " + err);
          if ((self.retry > 0) || (self.retry <= -1)) {
              self.retry--;
              return self.getUploadInfo()
              .then(function(r){
                return resolve(r);
              })
              .catch(function(e){
                return reject(e);
              });
          } 
          else {
            debug("Exhausted retry attempts. Error fetching file. Status Code: " + res.statusCode + " Error: " + err);
            return reject({status:"Failed", message: "Get Upload Info - Exhausted retry attempts. Error fetching file. Status Code: " + res.statusCode + " Error: " + err});
          }
        }
        else{
          
          self.size = res.headers.getProp("Content-Length");
          self.type = res.headers.getProp("Content-Type");
          if(self.type === "binary/octet-stream"){
            self.type = "application/octet-stream";
          }
          return resolve();
        }
      });
    }
    else {
      if(typeof self.file === 'string'){
        debug("Getting upload info from file");
        self.size = fs.statSync(self.file).size;
        self.type = mime.lookup(self.file);
      }
      return resolve();
    }
  });
}

//Pipes uploadPipe to self.location (Google's Location header)
resumableUpload.prototype.send = function() {
  debug("sending");
  var self = this;
  return new Promise(function (resolve, reject) {
    var options = {
      url: self.location, //self.location becomes the Google-provided URL to PUT to
      headers: {
        'Authorization':  'Bearer ' + self.tokens.access_token,
        'Content-Length': self.size - self.byteCount,
        'Content-Type': self.type
      }, 
      json:true
    }, uploadPipe;
    try {
      if(typeof self.file === 'string' && (self.file.startsWith('http://') || self.file.startsWith('https://'))){
        debug("streaming upload from url", self.file);
        request.get(self.file).pipe(request.put(options, function(error, response, body) {
          if (!error) {
            debug("adding to playlists");
            return self.addVideoToPlaylists(body, self.playlists)
            .then(function(result){
              debug("Successfully uploaded and added to playlists, resolving success");
              return resolve({status:"Success",video:body,playlists:result});
            });
          }
          else{
            debug("Error streaming upload from url",error);
            if ((self.retry > 0) || (self.retry <= -1)) {
              self.retry--;
              return self.getProgress()
              .then(function(){
                debug("Retrying resumable upload from url");
                return self.send()
                  .then(function(l){
                    return resolve(l);
                  })
                  .catch(function(e){
                    return reject(e);
                  });
              });
            }
            else{
              debug("emitting failed",error);
              return reject({status:"Failed", message: "Exhausted retry attempts. Error: " + error});
            }
          }
        }));
      }
      else{
        // file path
        if(typeof self.file === 'string'){
          //creates file stream, pipes it to self.location
          uploadPipe = fs.createReadStream(self.file, {
            start: self.byteCount,
            end: self.size
          });
        }
        else{ // already a readable stream
          uploadPipe = self.file;
        }
        uploadPipe.pipe(request.put(options, function(error, response, body) {
          if (!error) {
            debug("Uploaded file to youtube");
            return self.addVideoToPlaylists(body, self.playlists)
              .then(function(result){
                debug("Successfully uploaded and added to playlists, resolving success");
                return resolve({status:"Success",video:body,playlists:result});
              });
          }
          else{
            debug("Error uploading from file stream", error);
            if ((self.retry > 0) || (self.retry <= -1)) {
              self.retry--;
              return self.getProgress()
                .then(function(){
                  return self.send()
                    .then(function(l){
                      return resolve(l);
                    })
                    .catch(function(e){
                      return reject(e);
                    });
                });
            }
            else{
              return reject({status:"Failed", message: "Exhausted retry attempts. Error: " + error});
            }
          }
        }));
      }
    }
    catch (e) {
      return reject({status:"Failed", message: e});
    }  
  });
}

resumableUpload.prototype.getProgress = function(handler) {
  var self = this;
  debug("getting progress");
  return new Promise(function (resolve, reject) {
    var options = {
      url: self.location,
      headers: {
        'Authorization':  'Bearer ' + self.tokens.access_token,
        'Content-Length': 0,
        'Content-Range':  'bytes */' + self.size
      }
    };
    request.put(options, function(err, res, b) {
      if (typeof res.headers.range !== 'undefined') {
        self.byteCount = res.headers.range.substring(8); //parse response
      } else {
        self.byteCount = 0;
      }
      return resolve(self.byteCount);
    });
  });
}

module.exports = resumableUpload;