node-youtube-resumable-upload
=============================

Upload large videos to youtube via Google's 'resumable upload' API:
follows https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

Benchmarked with an 800mb video - this module bypasses the filesize restrictions on node's `fs.readFileSync()` (used by the official googleapis node client for uploading) by using `fs.createReadStream()` and then piping the stream to Youtube's servers.


How to Use
==========

Requires OAuth2 tokens from google - packages such as `googleapis` (the official nodejs client), `Passport` and `google-auth-cli` can be used.

Install with `npm install node-youtube-resumable-upload`

The module emits the video metadata that Google responds with on a successful upload, or emits an error if something goes wrong. If monitoring is enabled (it is by default), the number of bytes uploaded is emitted every 5 seconds. 

Look at test/test.js for a use-case example, but this is the gist of it:

```javascript
var ResumableUpload = require('node-youtube-resumable-upload');
var resumableUpload = new ResumableUpload(); //create new ResumableUpload
resumableUpload.tokens = tokens; //Google OAuth2 tokens
resumableUpload.filepath = './video.mp4';
resumableUpload.metadata = metadata; //include the snippet and status for the video
resumableUpload.monitor = true;
resumableUpload.retry = 3; // Maximum retries when upload failed.
resumableUpload.initUpload();
resumeableUpload.on('progress', function(progress) {
	console.log(progress);
});
resumableUpload.on('success', function(success) {
	console.log(success);
});
resumableUpload.on('error', function(error) {
	console.log(error);
});
```

