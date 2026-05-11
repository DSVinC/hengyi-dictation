/**
 * 恒一听写系统 - 每日统计模块
 *
 * 功能：
 * - record(subject, correct, total)：记录一次听写的正确/总数
 * - getAll()：返回完整数据对象
 * - 同日累加：若当天该科目已有记录，correct += newCorrect, total += newTotal
 *
 * 存储模式：
 * - localStorage 作为主要存储
 * - data/daily-stats.json 作为同步目标
 */
(function() {
  const DAILY_STATS_STORAGE_KEY = 'hengyi-daily-stats';
  const DAILY_STATS_FILE = 'data/daily-stats.json';

  // 兼容浏览器和 Node.js 环境
  const _global = typeof window !== 'undefined' ? window : globalThis;

  // ============================================
  // 私有工具函数
  // ============================================

  /**
   * 获取当前日期（YYYY-MM-DD 格式，本地时区）
   */
  function getLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 从 localStorage 加载数据
   */
  function loadFromStorage() {
    const data = localStorage.getItem(DAILY_STATS_STORAGE_KEY);
    if (!data) return {};
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('[DailyStats] 解析 localStorage 数据失败:', e);
      return {};
    }
  }

  /**
   * 保存数据到 localStorage
   */
  function saveToStorage(stats) {
    localStorage.setItem(DAILY_STATS_STORAGE_KEY, JSON.stringify(stats));
  }

  /**
   * 触发 GitHub 同步（如果存在）
   */
  function triggerSync() {
    if (typeof debouncedSyncDailyStats === 'function') {
      debouncedSyncDailyStats();
    }
  }

  // ============================================
  // 公共 API
  // ============================================

  _global.DailyStats = {
    /**
     * 初始化：从 JSON 文件加载数据到 localStorage
     * 页面加载时调用一次
     */
    async init() {
      try {
        const response = await fetch(DAILY_STATS_FILE);
        if (response.ok) {
          const fileData = await response.json();
          const localData = loadFromStorage();

          // 合并数据：本地数据优先（因为可能更新）
          const merged = { ...fileData, ...localData };
          saveToStorage(merged);
          console.log('[DailyStats] 初始化完成，从文件加载数据');
        } else {
          console.log('[DailyStats] 文件不存在或加载失败，使用空数据');
        }
      } catch (e) {
        console.error('[DailyStats] 初始化失败:', e);
      }
    },

    /**
     * 记录一次听写统计
     * @param {string} subject - 科目："chinese" | "english"
     * @param {number} correct - 正确数
     * @param {number} total - 总数
     */
    record(subject, correct, total) {
      // 参数校验
      if (subject !== 'chinese' && subject !== 'english') {
        console.error('[DailyStats] 科目必须是 "chinese" 或 "english"');
        return;
      }
      if (typeof correct !== 'number' || typeof total !== 'number') {
        console.error('[DailyStats] correct 和 total 必须是数字');
        return;
      }
      if (correct < 0 || total < 0) {
        console.error('[DailyStats] correct 和 total 不能为负数');
        return;
      }

      const date = getLocalDateString();
      const stats = loadFromStorage();

      // 初始化日期数据
      if (!stats[date]) {
        stats[date] = {};
      }

      // 初始化科目数据或累加
      if (!stats[date][subject]) {
        stats[date][subject] = { correct: 0, total: 0 };
      }

      stats[date][subject].correct += correct;
      stats[date][subject].total += total;

      saveToStorage(stats);
      triggerSync();

      console.log(`[DailyStats] 记录: ${date} ${subject} correct=${correct}, total=${total}, 累计 correct=${stats[date][subject].correct}, total=${stats[date][subject].total}`);
    },

    /**
     * 获取所有统计数据
     * @returns {Object} 完整统计数据对象
     */
    getAll() {
      return loadFromStorage();
    },

    /**
     * 获取指定日期的统计数据
     * @param {string} date - 日期（YYYY-MM-DD 格式）
     * @returns {Object|null} 该日期的统计数据
     */
    getByDate(date) {
      const stats = loadFromStorage();
      return stats[date] || null;
    },

    /**
     * 获取今天的统计数据
     * @returns {Object|null} 今天的统计数据
     */
    getToday() {
      return this.getByDate(getLocalDateString());
    },

    /**
     * 清除所有数据（用于测试）
     */
    clear() {
      localStorage.removeItem(DAILY_STATS_STORAGE_KEY);
      console.log('[DailyStats] 数据已清除');
    },

    /**
     * 导出为 JSON 字符串（用于 GitHub 同步）
     */
    exportForSync() {
      const stats = this.getAll();
      return JSON.stringify(stats, null, 2);
    },

    /**
     * 从远程同步数据合并到本地
     * @param {Object} remoteStats - 远程统计数据
     */
    mergeFromRemote(remoteStats) {
      if (!remoteStats) return;
      const local = this.getAll();
      const merged = { ...remoteStats, ...local }; // 本地数据优先（更新）
      saveToStorage(merged);
      console.log('[DailyStats] 合并远程数据完成');
    }
  };
})();
