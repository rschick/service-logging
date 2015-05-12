var assert = require('assert'),
  bunyan = require('bunyan'),
  express = require('express'),
  request = require('supertest-as-promised'),
  logging = require('./');

function createRingBuffer() {
  return new bunyan.RingBuffer({limit: 100});
}

function setupServer(ringBuffer, opts) {
  opts = opts || {};
  var app = express();
  var loggingContext = logging({
    name: 'logger',
    environment: 'dev',
    serializers: opts.serializers,
    streams: [{type: 'raw', stream: ringBuffer}],
    version: opts.version
  });
  app.use(loggingContext.attachLoggerToReq);
  app.use(
    loggingContext.attachRequestIdToReq({
      warnIfMissingRequestId: opts.warnIfMissingRequestId
    })
  );
  app.use(loggingContext.logResponses);
  app.get('/', function(req, res) {
    res.end();
  });
  app.get('/error', function(req, res, next) {
    next(new Error('Error!'));
  });
  app.use(loggingContext.logErrors);
  return app;
}

describe('logging', function() {
  it('should log responses', function() {
    var ringBuffer = createRingBuffer();
    return request(setupServer(ringBuffer)).get('/')
      .then(function() {
        var logs = ringBuffer.records;
        assert.equal(logs.length, 1, 'Should be one record');
        assert.equal(logs[0].msg, 'Response finished');
      });
  });

  it('should log errors', function() {
    var ringBuffer = createRingBuffer();
    return request(setupServer(ringBuffer)).get('/error')
      .then(function() {
        var logs = ringBuffer.records;
        assert.equal(logs.length, 2, 'Should be two records');
        assert.equal(logs[0].msg, 'Error');
        assert.equal(logs[1].msg, 'Response finished');
        assert.ok(logs[1].requestId === logs[0].requestId);
      });
  });

  it('should log version if provided', function() {
    var ringBuffer = createRingBuffer();
    var version = {foo: 'bar'};
    return request(setupServer(ringBuffer, {version: version})).get('/')
      .then(function() {
        assert.deepEqual(ringBuffer.records[0].version, version);
      });
  });

  it('should warn if missing request id if configured to do so', function() {
    var ringBuffer = createRingBuffer();
    return request(setupServer(ringBuffer, {warnIfMissingRequestId: true}))
      .get('/')
      .then(function() {
        var firstRecord = ringBuffer.records[0];
        assert.equal(firstRecord.msg, 'X-Request-ID header not present');
        assert.ok(firstRecord.requestId);
      });
  });

  it('should not warn if request id is present', function() {
    var ringBuffer = createRingBuffer();
    return request(setupServer(ringBuffer, {warnIfMissingRequestId: true}))
      .get('/')
      .set('X-Request-ID', 'junk')
      .then(function() {
        var firstRecord = ringBuffer.records[0];
        assert.notEqual(firstRecord.msg, 'X-Request-ID header not present');
      });
  });

  it('should add additional specified serializers', function() {
    var ringBuffer = createRingBuffer();
    return request(setupServer(ringBuffer, {serializers: {req: function() {
      return 'bar';
    }}})).get('/')
      .then(function() {
        assert.ok(ringBuffer.records[0].req, 'bar');
      });
  });
});