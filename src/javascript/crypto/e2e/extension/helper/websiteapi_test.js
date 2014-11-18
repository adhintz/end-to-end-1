/**
 * @license
 * Copyright 2014 Google Inc. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Tests for the wrapper of the gmonkey API.
 */

/** @suppress {extraProvide} */
goog.provide('e2e.ext.WebsiteApiTest');

goog.require('e2e.ext.WebsiteApi');
goog.require('goog.testing.AsyncTestCase');
goog.require('goog.testing.PropertyReplacer');
goog.require('goog.testing.asserts');
goog.require('goog.testing.jsunit');
goog.setTestOnly();

var api = null;
var asyncTestCase = goog.testing.AsyncTestCase.createAndInstall(document.title);
var draft = null;
var e2eapi = null;
var stubs = new goog.testing.PropertyReplacer();
var RECIPIENTS = ['test@example.com' , 't2@example.com', 'cc@example.com'];
var TEST_CONTENT = 'TEST';

function setUp() {
  e2eapi = new e2e.ext.WebsiteApi();
  stubs.setPath('chrome.runtime.getURL', function(filename) {
    return './' + filename;
  });
  document.documentElement.id = 'test_id';
  draft = {
    to: [{address: 'test@example.com'},
      {name: 'we <ird>>\'>, <a@a.com>, n<ess', address: 't2@example.com'},
      {name: 'inv\"<alid <invalid@example.com>'},
      {address: 'fails#e2e.regexp.vali@dation.com'}],
    cc: [{address: 'cc@example.com'}],

    body: 'some text<br>with new<br>lines',
    getToEmails: function() { return this.to; },
    setToEmails: function(value) { this.to = value; },
    getCcEmails: function() { return this.cc; },
    setCcEmails: function(value) { this.cc = value; },
    getPlainTextBody: function() { return this.body.replace(/\<br\>/g, '\n'); },
    setBody: function(value) { this.body = value; }
  };
  api = {
    getContentElement: function() { return document.documentElement; },
    getPlainTextContent: function() { return TEST_CONTENT; },
    getCurrentMessage: function() { return api; },
    getMainWindow: function() { return api; },
    getOpenDraftMessages: function() { return [draft]; },
    getActiveMessage: function() { return api; }
  };
  stubs.setPath('gmonkey.load', function(version, callback) {
    callback(api);
  });
}

function tearDown() {
  stubs.reset();
}

function testIsAvailableOnGmail() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');

  e2eapi.isApiAvailable_(function(isAvailable) {
    assertTrue(isAvailable);
    asyncTestCase.continueTesting();
  });
}

function testIsAvailableWithoutStub() {
  stubs.replace(e2e.ext.WebsiteApi.prototype, 'supportsApi_', function() {
    return true;});
  stubs.replace(e2e.ext.WebsiteApi.prototype, 'bootstrapChannel_', function(
      callback) {
        e2eapi.apiAvailable_ = true;
        callback(e2eapi.apiAvailable_);
      });

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');

  e2eapi.isApiAvailable_(function(isAvailable) {
    assertTrue(isAvailable);
    asyncTestCase.continueTesting();
  });
}

function testBootstrap() {
  stubs.replace(e2e.ext.WebsiteApi.prototype, 'supportsApi_', function() {
    return true;});
  stubs.replace(e2e.ext.WebsiteApi.prototype, 'sendBootstrap_', function(port) {
    // Reply to bootstrap.
    port.postMessage({
      api: 'e2e-init',
      version: 1,
      available: true
    });
  });

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.bootstrapChannel_(function(available) {
    assertEquals(true, available);
    asyncTestCase.continueTesting();
    stubs.reset();
  });
}

function testStubNotInjectedTwice() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  var calls = 0;
  var orig = document.documentElement.appendChild;
  stubs.replace(document.documentElement, 'appendChild', function() {
    calls++;
    orig.apply(document.documentElement, arguments);
  });
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.createConnection_(function(available) {
    assertTrue(available);
    e2eapi.createConnection_(function(available) {
      assertEquals(1, calls);
      assertTrue(available);
      asyncTestCase.continueTesting();
    });
  });
}

function testBootstrapWithNotAvailableResponse() {
  stubs.replace(e2e.ext.WebsiteApi.prototype, 'supportsApi_', function() {
    return true;});
  stubs.replace(e2e.ext.WebsiteApi.prototype, 'sendBootstrap_', function(port) {
    // Reply to bootstrap.
    port.postMessage({
      api: 'e2e-init',
      version: 1,
      available: false
    });
  });

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.bootstrapChannel_(function(available) {
    assertEquals(false, available);
    asyncTestCase.continueTesting();
  });
}

function testRequestResponseFlow() {
  var requestId;
  var handleResponseFunction = function(response) {
    assertEquals('booboo', response);
    assertUndefined(e2eapi.pendingCallbacks_[requestId]);
    asyncTestCase.continueTesting();
  };

  e2eapi.port_ = {
    postMessage: function(request) {
      assertEquals('foo', request.call);
      assertEquals('bar', request.args);
      requestId = request.id;
      assertEquals(handleResponseFunction,
          e2eapi.pendingCallbacks_[requestId].callback);
      assertEquals(fail, e2eapi.pendingCallbacks_[requestId].errback);
      // Simulate response
      assertTrue(e2eapi.processWebsiteResponse_({
        data: {
          requestId: requestId,
          result: 'booboo'
        }
      }));
    }
  };
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.sendWebsiteRequest_('foo', handleResponseFunction, fail, 'bar');
}

function testRequestResponseError() {
  var requestId;
  var handleErrorFunction = function(error) {
    assertTrue(error instanceof Error);
    assertEquals('booboo', error.message);
    assertUndefined(e2eapi.pendingCallbacks_[requestId]);
    asyncTestCase.continueTesting();
  };

  e2eapi.port_ = {
    postMessage: function(request) {
      assertEquals('foo', request.call);
      assertEquals('bar', request.args);
      requestId = request.id;
      assertEquals(fail, e2eapi.pendingCallbacks_[requestId].callback);
      assertEquals(handleErrorFunction,
          e2eapi.pendingCallbacks_[requestId].errback);
      // Simulate response
      assertTrue(e2eapi.processWebsiteResponse_({
        data: {
          requestId: requestId,
          error: 'booboo'
        }
      }));
    }
  };
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.sendWebsiteRequest_('foo', fail, handleErrorFunction, 'bar');
}


function testIgnoreUnrelatedResponses() {
  assertFalse(e2eapi.processWebsiteResponse_({data: {requestId: 'unknown'}}));
}


function testStubInjectedOnGmail() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  assertFalse(e2eapi.stubInjected_);
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');

  e2eapi.isApiAvailable_(function(isAvailable) {
    assertTrue(e2eapi.stubInjected_);
    asyncTestCase.continueTesting();
  });
}

function testIsNotAvailableOutsideGmail() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return false;});

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');

  e2eapi.isApiAvailable_(function(isAvailable) {
    assertFalse(isAvailable);
    asyncTestCase.continueTesting();
  });
}

function testGetCurrentMessageGmail() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.isApiAvailable_(function(available) {
    assertTrue(available);
    e2eapi.getCurrentMessage(function(id, content) {
      assertEquals(document.documentElement.id, id);
      assertEquals(TEST_CONTENT, content);
      asyncTestCase.continueTesting();
    }, function() {fail('Should not call errback.')});
  });
}

function testGetCurrentMessageDom() {
  e2eapi.isAvailable_ = false; // Use DOM api.
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  // getCurrentMessage is unavailable in DOM api.
  e2eapi.getCurrentMessage(function(id, content) {
    assertEquals(undefined, id);
    assertEquals(undefined, content);
    asyncTestCase.continueTesting();
  }, function() {fail('Should not call errback.')});
}

function testNoPortTriggersErrback() {
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.sendWebsiteRequest_('irrelevant', function() {
    fail('Should not call this function.');
  }, function(msg) {
    asyncTestCase.continueTesting();
  });
}

function testUnknownWebsiteApiCall() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.isApiAvailable_(function(available) {
    assertTrue(available);
    e2eapi.sendWebsiteRequest_('nonexistent', fail, function(e) {
      assertTrue(e instanceof Error);
      assertEquals('Unsupported API call.', e.message);
      asyncTestCase.continueTesting();
    });
  });
}

function testGmonkeyNotAvailable() {
  delete gmonkey;
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.isApiAvailable_(function(available) {
    assertFalse(available);
    asyncTestCase.continueTesting();
  });
}

function testGetActiveDraft() {
  var recipients = null;
  var body = null;

  stubs.set(api, 'getContentElement', function() {
    return {innerText: draft.body};
  });
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');

  e2eapi.isApiAvailable_(function(available) {
    assertTrue(available);
    e2eapi.getActiveDraft_(function(recipients, body) {
      assertArrayEquals(RECIPIENTS, recipients);
      assertEquals(draft.body.replace(/\<br\>/g, '\n'), body);
      asyncTestCase.continueTesting();
    }, function(msg) {fail(msg)});
  });
}

function testSetActiveDraft() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.isApiAvailable_(function(available) {
    assertTrue(available);
    e2eapi.setActiveDraft_(['foo@example.com', 'noemail', '<a@>',
      'first,"""last <bar@example.com>'], 'secret message', function(success) {
      assertArrayEquals([
        {address: 'foo@example.com', name: undefined},
        {address: 'bar@example.com', name: undefined}
      ], draft.to);
      assertEquals('secret message', draft.body);
      assertTrue(success);
      asyncTestCase.continueTesting();
    }, fail);
  });
}

function testInputIsEditable() {
  var elem = document.getElementById('testInput');
  assertTrue(e2eapi.isEditable_(elem));
}

function testContentEditableIsEditable() {
  var elem = document.getElementById('testEditable');
  assertTrue(e2eapi.isEditable_(elem));
}

function testGetActiveElement() {
  assertEquals('Failed to get active element', document.body,
      e2eapi.getActiveElement_());
}

function testGetActiveSelection() {
  assertEquals('Failed to get selection', '', e2eapi.getActiveSelection_());
  var el = document.createElement('div');
  var sel = window.getSelection();
  var range = document.createRange();
  el.textContent = 'some text';
  document.body.appendChild(el);
  range.selectNodeContents(el);
  sel.addRange(range);
  assertEquals('Incorrect selection', el.textContent,
      e2eapi.getActiveSelection_());
  document.body.removeChild(el);
}

function testGetSelectedContentPriority() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  stubs.replace(e2eapi, 'getSelectedContentWebsite_', function() {
    asyncTestCase.continueTesting();
  });
  stubs.replace(e2eapi, 'getSelectedContentDom_', fail);
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.isApiAvailable_(function(available) {
    assertTrue(available);
    e2eapi.getSelectedContent(goog.nullFunction, fail);
  });
}

function testUpdateSelectedContentPriority() {
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  stubs.replace(e2eapi, 'setActiveDraft_', function(recipients, value,
      callback, errback) {
        assertArrayEquals(RECIPIENTS, recipients);
        assertEquals('foo', value);
        asyncTestCase.continueTesting();
      });
  stubs.replace(e2eapi, 'updateSelectedContentDom_', fail);
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.isApiAvailable_(function(available) {
    assertTrue(available);
    e2eapi.updateSelectedContent(RECIPIENTS, 'foo', goog.nullFunction,
        goog.nullFunction);
  });
}

function testGetSelectedContentWebsite() {
  var text = 'some content';
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.isApiAvailable_(function(available) {
    assertTrue(available);
    e2eapi.getSelectedContentWebsite_(function(recipients, content, canInject) {
      assertArrayEquals(RECIPIENTS, recipients);
      assertEquals(draft.body.replace(/\<br\>/g, '\n'), content);
      assertEquals(true, canInject);
      asyncTestCase.continueTesting();
    }, fail);
  });
}

function testGetSelectedContentWithNoDraft() {
  api.getOpenDraftMessages = function() { return [] }; // No active drafts.
  var text = 'some content';
  stubs.setPath('e2e.ext.utils.text.isGmailOrigin', function() {return true;});
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.isApiAvailable_(function(available) {
    assertTrue(available);
    e2eapi.getSelectedContentWebsite_(function(recipients, content, canInject) {
      // No recipients if draft cannot be found.
      assertArrayEquals([], recipients);
      assertEquals(TEST_CONTENT, content);
      assertEquals(true, canInject);
      asyncTestCase.continueTesting();
    }, fail);
  });
}

function testGetSelectedContentDomEditable() {
  var text = 'some content';

  stubs.replace(e2e.ext.WebsiteApi.prototype, 'getActiveElement_', function() {
    var div = document.createElement('div');
    div.innerText = text;
    div.contentEditable = true;
    return div;
  });

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.getSelectedContentDom_(function(recipients, content, canInject) {
    assertArrayEquals([], recipients);
    assertEquals(text, content);
    assertEquals(true, canInject);
    asyncTestCase.continueTesting();
  });
}

function testGetSelectedContentDomInput() {
  var text = 'some content';
  stubs.replace(e2e.ext.WebsiteApi.prototype, 'getActiveElement_', function() {
    var input = document.createElement('input');
    input.value = text;
    return input;
  });

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.getSelectedContentDom_(function(recipients, content, canInject) {
    assertArrayEquals([], recipients);
    assertEquals(text, content);
    assertEquals(true, canInject);
    asyncTestCase.continueTesting();
  }, fail);
}

function testGetSelectedContentDomStatic() {
  var text = 'some content';
  stubs.replace(e2e.ext.WebsiteApi.prototype, 'getActiveElement_', function() {
    var div = document.createElement('div');
    div.innerText = text;
    return div;
  });

  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.getSelectedContentDom_(function(recipients, content, canInject) {
    assertArrayEquals([], recipients);
    assertEquals(text, content);
    assertEquals(false, canInject);
    asyncTestCase.continueTesting();
  }, fail);
}

function testUpdateSelectedContentDomDiv() {
  var testDiv = document.createElement('div');
  stubs.replace(e2eapi, 'getActiveElement_', function() { return testDiv });
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.updateSelectedContentDom_('boo', fail, function(error) {
    // No element was active, should call errback.
    assertTrue(error instanceof Error);
    e2eapi.getSelectedContentDom_(function(_, _, canInject) {
      assertFalse(canInject);
      e2eapi.updateSelectedContentDom_('boo2', function(success) {
        assertTrue(success);
        assertEquals('boo2', testDiv.innerText);
        asyncTestCase.continueTesting();
      }, fail);
    }, fail);
  });
}

function testUpdateSelectedContentDomTextarea() {
  var testEl = document.createElement('textarea');
  stubs.replace(e2eapi, 'getActiveElement_', function() { return testEl; });
  asyncTestCase.waitForAsync('Waiting for the call to api to complete.');
  e2eapi.updateSelectedContentDom_('boo', fail, function(error) {
    // No element was active, should call errback.
    assertTrue(error instanceof Error);
    e2eapi.getSelectedContentDom_(function(_, _, canInject) {
      assertTrue(canInject);
      e2eapi.updateSelectedContentDom_('boo2', function(success) {
        assertTrue(success);
        assertEquals('boo2', testEl.value);
        asyncTestCase.continueTesting();
      }, fail);
    }, fail);
  });
}
