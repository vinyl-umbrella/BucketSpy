// Popup script for BucketSpy
class PopupController {
  constructor() {
    this.currentTabId = null;
    this.init();
  }

  async init() {
    // Get current active tab ID
    await this.getCurrentTabId();
    this.loadStatus();
    this.loadRequests();
    this.bindEvents();
  }

  async getCurrentTabId() {
    try {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });

      if (tabs.length > 0) {
        this.currentTabId = tabs[0].id;
      }
    } catch (error) {
      console.error('Failed to get current tab ID:', error);
    }
  }

  bindEvents() {
    // Clear button - clear only current tab's requests
    document.getElementById('clearBtn').addEventListener('click', () => {
      this.clearRequests();
    });

    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  async loadStatus() {
    try {
      const response = await this.sendMessage({ action: 'getSettings' });
      const statusElement = document.getElementById('status');
      const statusText = document.getElementById('statusText');

      if (response.isEnabled) {
        statusElement.className = 'status enabled';
        statusText.textContent = 'Enabled - Monitoring S3 Requests';
      } else {
        statusElement.className = 'status disabled';
        statusText.textContent = 'Disabled - Monitoring Stopped';
      }
    } catch (error) {
      console.error('Failed to load status:', error);
    }
  }

  async loadRequests() {
    try {
      const message = { action: 'getRequests' };
      if (this.currentTabId) {
        message.tabId = this.currentTabId;
      }

      const response = await this.sendMessage(message);
      const requests = response.requests || [];
      this.displayRequests(requests);
      this.displayBuckets(requests);
    } catch (error) {
      console.error('Failed to load requests:', error);
      this.displayRequests([]);
      this.displayBuckets([]);
    }
  }

  displayRequests(requests) {
    const countElement = document.getElementById('count');
    const listElement = document.getElementById('requestList');

    countElement.textContent = requests.length;

    if (requests.length === 0) {
      listElement.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <div>No S3 Requests Detected in Current Tab</div>
          <div style="margin-top: 8px; font-size: 10px;">
            Access S3 resources in this tab to see them here
          </div>
        </div>
      `;
      return;
    }

    // Sort requests by timestamp (newest first)
    const sortedRequests = requests.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const requestsHtml = sortedRequests
      .map((request) => this.createRequestItemHtml(request))
      .join('');

    listElement.innerHTML = requestsHtml;
  }

  extractBuckets(requests) {
    const buckets = new Map();

    requests.forEach((request) => {
      const urlParts = this.parseS3Url(request.url);
      if (urlParts.bucket) {
        const bucketKey = `${urlParts.bucket}-${urlParts.region}`;
        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, {
            name: urlParts.bucket,
            region: urlParts.region,
            requestCount: 0,
            methods: new Set(),
            firstSeen: request.timestamp,
          });
        }

        const bucket = buckets.get(bucketKey);
        bucket.requestCount++;
        bucket.methods.add(request.method);

        // Update first seen to earliest timestamp
        if (new Date(request.timestamp) < new Date(bucket.firstSeen)) {
          bucket.firstSeen = request.timestamp;
        }
      }
    });

    // Convert to array and sort by first seen (newest first)
    return Array.from(buckets.values())
      .map((bucket) => ({
        ...bucket,
        methods: Array.from(bucket.methods),
      }))
      .sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
  }

  displayBuckets(requests) {
    const buckets = this.extractBuckets(requests);
    const bucketSection = document.getElementById('bucketSection');
    const bucketCountElement = document.getElementById('bucketCount');
    const bucketListElement = document.getElementById('bucketList');

    bucketCountElement.textContent = buckets.length;

    if (buckets.length === 0) {
      bucketSection.style.display = 'none';
      return;
    }

    bucketSection.style.display = 'block';

    const bucketsHtml = buckets.map((bucket) => this.createBucketItemHtml(bucket)).join('');

    bucketListElement.innerHTML = bucketsHtml;
  }

  createBucketItemHtml(bucket) {
    const requestsText =
      bucket.requestCount === 1 ? '1 request' : `${bucket.requestCount} requests`;

    return `
      <div class="bucket-item">
        <div class="bucket-name">📦 ${bucket.name}</div>
        <div class="bucket-info">
          <div class="bucket-region">${bucket.region}</div>
          <div class="bucket-requests">${requestsText}</div>
        </div>
      </div>
    `;
  }

  createRequestItemHtml(request) {
    const urlParts = this.parseS3Url(request.url);
    const bucketDisplay = urlParts.bucket ? urlParts.bucket : '';
    const keyDisplay = urlParts.key ? ` / ${urlParts.key}` : '';
    const urlContent = `${bucketDisplay}${keyDisplay}`;

    const isClickable = request.method === 'GET';
    const objectLink = `
      <${isClickable ? `a href="${request.url}" target="_blank" rel="noopener noreferrer"` : 'div'}>
      <div class="request-url" title="${request.url}">${urlContent}</div></${isClickable ? 'a' : 'div'}>
    `;

    return `
      <div class="request-item">
        <div>
          <span class="request-method">${request.method}</span>
          ${objectLink}
        </div>
      </div>
    `;
  }

  parseS3Url(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Parse bucket and region from hostname: bucket.s3-region.amazonaws.com
      const match = hostname.match(/^([^.]+)\.s3-([^.]+)\.amazonaws\.com$/);

      if (match) {
        const bucket = match[1];
        const region = match[2];
        const key = urlObj.pathname.substring(1); // Remove leading slash

        return {
          bucket,
          region,
          key: key || null,
        };
      }

      return { bucket: null, region: null, key: null };
    } catch (_error) {
      return { bucket: null, region: null, key: null };
    }
  }

  async clearRequests() {
    try {
      const message = { action: 'clearRequests' };
      if (this.currentTabId) {
        message.tabId = this.currentTabId;
      }

      await this.sendMessage(message);
      this.loadRequests(); // Reload to show empty state for both requests and buckets
    } catch (error) {
      console.error('Failed to clear requests:', error);
    }
  }

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
