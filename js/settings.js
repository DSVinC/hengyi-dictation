/**
 * 恒一听写系统 - 设置页面
 * 功能：管理 GitHub 同步设置
 */
(function() {
  const SETTINGS_KEY = 'hengyi-settings';
  
  // 默认设置
  const defaultSettings = {
    githubToken: '',
    syncEnabled: false
  };
  
  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : { ...defaultSettings };
    } catch {
      return { ...defaultSettings };
    }
  }
  
  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  
  // 暴露全局函数
  window.Settings = {
    get: getSettings,
    save: saveSettings,
    
    // 获取 GitHub token（供其他模块调用）
    getGitHubToken() {
      const s = getSettings();
      return s.githubToken || '';
    },
    
    // 检查是否启用同步
    isSyncEnabled() {
      const s = getSettings();
      return s.syncEnabled && s.githubToken;
    },
    
    // 启用同步
    enableSync(token) {
      if (!token || token.length < 10) {
        alert('请输入有效的 GitHub Token');
        return false;
      }
      saveSettings({ githubToken: token, syncEnabled: true });
      return true;
    },
    
    // 禁用同步
    disableSync() {
      saveSettings({ githubToken: '', syncEnabled: false });
    }
  };
})();
