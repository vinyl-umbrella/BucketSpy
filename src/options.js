// Options page script for BucketSpy
class OptionsController {
  constructor() {
    this.init();
  }

  init() {
    this.loadSettings();
    this.bindEvents();
  }

  bindEvents() {
    // Monitor toggle
    document.getElementById('enableMonitoring').addEventListener('change', (e) => {
      this.saveSetting('isEnabled', e.target.checked);
    });

    // Badge toggle
    document.getElementById('showBadge').addEventListener('change', (e) => {
      this.saveSetting('showBadge', e.target.checked);
    });
  }

  async loadSettings() {
    try {
      const settings = await this.getStorageData(['isEnabled', 'showBadge']);

      // Set default values if not set
      const isEnabled = settings.isEnabled !== false; // Default to true
      const showBadge = settings.showBadge !== false; // Default to true

      document.getElementById('enableMonitoring').checked = isEnabled;
      document.getElementById('showBadge').checked = showBadge;
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.showMessage('Failed to load settings', 'error');
    }
  }

  async saveSetting(key, value) {
    try {
      await this.setStorageData({ [key]: value });
      this.showMessage('Setting saved successfully', 'success');

      // Send message to background script about the change
      chrome.runtime.sendMessage({
        action: 'settingChanged',
        key: key,
        value: value,
      });
    } catch (error) {
      console.error('Failed to save setting:', error);
      this.showMessage('Failed to save setting', 'error');
    }
  }

  getStorageData(keys) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, resolve);
    });
  }

  setStorageData(data) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(data, resolve);
    });
  }

  showMessage(message, type = 'success') {
    const messageElement = document.getElementById('statusMessage');

    messageElement.innerHTML = `
      <div class="status-message ${type}">
        ${message}
      </div>
    `;

    // Clear message after 3 seconds
    setTimeout(() => {
      messageElement.innerHTML = '';
    }, 3000);
  }
}

// Initialize options when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new OptionsController();
});
