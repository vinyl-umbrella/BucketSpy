// Unified background script for BucketSpy - works with both Chromium and Firefox

// Utility function to promisify chrome.storage.sync.get
function promisifyStorageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, resolve);
  });
}

// Core S3 monitoring logic - simplified for unified browser support
class S3MonitorCore {
  constructor() {
    this.s3Requests = [];
    this.isEnabled = true;
    this.badgeAPI = chrome.action || chrome.browserAction;
  }

  async init() {
    // Load settings from storage
    const result = await promisifyStorageGet(['isEnabled']);
    this.isEnabled = result.isEnabled !== false; // Default to true
    this.updateBadge();

    // Listen for web requests
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.handleRequest(details),
      { urls: ['<all_urls>'] },
      ['requestBody']
    );

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.isEnabled) {
        this.isEnabled = changes.isEnabled.newValue;
        this.updateBadge();
      }
    });

    // Clear requests when tab is closed or refreshed
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.clearRequestsForTab(tabId);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'loading') {
        this.clearRequestsForTab(tabId);
      }
    });

    // Update badge when active tab changes
    chrome.tabs.onActivated.addListener(() => {
      this.updateBadge();
    });

    // Update badge when window focus changes
    chrome.windows.onFocusChanged.addListener(() => {
      this.updateBadge();
    });
  }

  handleRequest(details) {
    if (!this.isEnabled) return;

    const url = details.url;

    // Check if the URL matches S3 pattern: https://*.s3-*.amazonaws.com
    const s3Pattern = /^https:\/\/[^.]+\.s3-[^.]+\.amazonaws\.com/;

    if (s3Pattern.test(url)) {
      const request = {
        id: Date.now() + Math.random(),
        url: url,
        method: details.method,
        timestamp: new Date().toISOString(),
        tabId: details.tabId,
        type: details.type,
      };

      this.s3Requests.push(request);

      // Keep only last 500 requests to prevent memory issues
      if (this.s3Requests.length > 500) {
        this.s3Requests = this.s3Requests.slice(-500);
      }

      this.updateBadge();
    }
  }

  clearRequestsForTab(tabId) {
    const initialLength = this.s3Requests.length;
    this.s3Requests = this.s3Requests.filter((req) => req.tabId !== tabId);

    if (this.s3Requests.length !== initialLength) {
      this.updateBadge();
    }
  }

  updateBadge() {
    if (!this.isEnabled) {
      this.badgeAPI.setBadgeText({ text: '' });
      return;
    }

    // Get current active tab to show relevant count
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const activeTabId = tabs[0].id;
        const tabRequests = this.s3Requests.filter((req) => req.tabId === activeTabId);
        const count = tabRequests.length;
        const badgeText = count > 0 ? count.toString() : '';

        this.badgeAPI.setBadgeText({ text: badgeText });
        this.badgeAPI.setBadgeBackgroundColor({ color: '#1ba1e2' });
      } else {
        // Fallback to total count if no active tab
        const count = this.s3Requests.length;
        const badgeText = count > 0 ? count.toString() : '';

        this.badgeAPI.setBadgeText({ text: badgeText });
        this.badgeAPI.setBadgeBackgroundColor({ color: '#1ba1e2' });
      }
    });
  }

  getRequests() {
    return this.s3Requests;
  }

  clearAllRequests() {
    this.s3Requests = [];
    this.updateBadge();
  }

  async getSettings() {
    const result = await promisifyStorageGet(['isEnabled']);
    return { isEnabled: result.isEnabled !== false };
  }
}

// Initialize the monitor
const s3Monitor = new S3MonitorCore();

// Initialize the monitor
s3Monitor.init().catch(console.error);

// Handle messages from popup - unified for both browsers
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case 'getRequests':
      if (request.tabId) {
        // Filter requests for specific tab
        const tabRequests = s3Monitor.getRequests().filter((req) => req.tabId === request.tabId);
        sendResponse({ requests: tabRequests });
      } else {
        // Return all requests (backward compatibility)
        sendResponse({ requests: s3Monitor.getRequests() });
      }
      break;
    case 'clearRequests':
      if (request.tabId) {
        // Clear requests for specific tab
        s3Monitor.clearRequestsForTab(request.tabId);
      } else {
        // Clear all requests
        s3Monitor.clearAllRequests();
      }
      sendResponse({ success: true });
      break;
    case 'getSettings':
      s3Monitor
        .getSettings()
        .then((settings) => {
          sendResponse(settings);
        })
        .catch((error) => {
          sendResponse({ error: error.message });
        });
      return true; // Will respond asynchronously
    default:
      sendResponse({ error: 'Unknown action' });
  }
});
