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
  const DAILY_STATS_DEVICE_ID_KEY = 'hengyi-daily-stats-device-id';
  const DAILY_STATS_SCHEMA_VERSION = 2;
  const LEGACY_UPDATED_AT = '1970-01-01T00:00:00.000Z';

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

  function isValidDateKey(key) {
    return /^\d{4}-\d{2}-\d{2}$/.test(key);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function createDeviceId() {
    const random = Math.random().toString(36).slice(2);
    return `device-${Date.now().toString(36)}-${random}`;
  }

  function getDeviceId() {
    let id = localStorage.getItem(DAILY_STATS_DEVICE_ID_KEY);
    if (!id) {
      id = createDeviceId();
      localStorage.setItem(DAILY_STATS_DEVICE_ID_KEY, id);
    }
    return id;
  }

  function emptyV2() {
    return {
      _schemaVersion: DAILY_STATS_SCHEMA_VERSION,
      _legacy: {},
      _devices: {},
      _updatedAt: null
    };
  }

  function normalizeEntry(entry, fallbackUpdatedAt) {
    if (!entry || typeof entry !== 'object') return null;
    const correct = Number(entry.correct);
    const total = Number(entry.total);
    if (!Number.isFinite(correct) || !Number.isFinite(total)) return null;
    return {
      correct,
      total,
      updatedAt: entry.updatedAt || fallbackUpdatedAt || LEGACY_UPDATED_AT
    };
  }

  function putEntry(target, date, subject, entry) {
    if (!isValidDateKey(date)) return;
    if (subject !== 'chinese' && subject !== 'english') return;
    const normalized = normalizeEntry(entry);
    if (!normalized) return;
    if (!target[date]) target[date] = {};
    target[date][subject] = normalized;
  }

  function copyDateStatsInto(target, source, fallbackUpdatedAt) {
    if (!source || typeof source !== 'object') return;
    for (const [date, dayStats] of Object.entries(source)) {
      if (!isValidDateKey(date) || !dayStats || typeof dayStats !== 'object') continue;
      for (const subject of ['chinese', 'english']) {
        if (dayStats[subject]) {
          putEntry(target, date, subject, normalizeEntry(dayStats[subject], fallbackUpdatedAt));
        }
      }
    }
  }

  function normalizeStats(raw) {
    if (!raw || typeof raw !== 'object') return emptyV2();

    const normalized = emptyV2();
    normalized._updatedAt = raw._updatedAt || null;

    if (raw._schemaVersion === DAILY_STATS_SCHEMA_VERSION) {
      copyDateStatsInto(normalized._legacy, raw._legacy || {}, raw._updatedAt);

      const devices = raw._devices || {};
      for (const [deviceId, deviceData] of Object.entries(devices)) {
        const dates = {};
        copyDateStatsInto(dates, deviceData?.dates || {}, deviceData?.updatedAt || raw._updatedAt);
        if (Object.keys(dates).length > 0) {
          normalized._devices[deviceId] = {
            dates,
            updatedAt: deviceData?.updatedAt || null
          };
        }
      }

      // Compatibility for partially migrated files that still only carry top-level dates.
      if (Object.keys(normalized._legacy).length === 0 && Object.keys(normalized._devices).length === 0) {
        copyDateStatsInto(normalized._legacy, raw, raw._updatedAt);
      }
    } else {
      copyDateStatsInto(normalized._legacy, raw, raw._updatedAt);
    }

    return recomputeAggregates(normalized);
  }

  function chooseEntry(existing, incoming) {
    if (!existing) return clone(incoming);
    if (!incoming) return clone(existing);

    const existingUpdatedAt = existing.updatedAt || LEGACY_UPDATED_AT;
    const incomingUpdatedAt = incoming.updatedAt || LEGACY_UPDATED_AT;
    if (incomingUpdatedAt > existingUpdatedAt) return clone(incoming);
    if (incomingUpdatedAt < existingUpdatedAt) return clone(existing);

    // Legacy records often have no timestamp. Keep the larger total to avoid losing a fuller day.
    if ((incoming.total || 0) > (existing.total || 0)) return clone(incoming);
    return clone(existing);
  }

  function mergeDateStats(base, incoming) {
    const merged = clone(base);
    for (const [date, dayStats] of Object.entries(incoming || {})) {
      if (!isValidDateKey(date)) continue;
      if (!merged[date]) merged[date] = {};
      for (const subject of ['chinese', 'english']) {
        if (dayStats[subject]) {
          merged[date][subject] = chooseEntry(merged[date][subject], dayStats[subject]);
        }
      }
    }
    return merged;
  }

  function addIntoAggregate(aggregate, date, subject, entry) {
    if (!aggregate[date]) aggregate[date] = {};
    if (!aggregate[date][subject]) aggregate[date][subject] = { correct: 0, total: 0 };
    aggregate[date][subject].correct += entry.correct || 0;
    aggregate[date][subject].total += entry.total || 0;
  }

  function recomputeAggregates(stats) {
    const normalized = {
      _schemaVersion: DAILY_STATS_SCHEMA_VERSION,
      _legacy: stats._legacy || {},
      _devices: stats._devices || {},
      _updatedAt: stats._updatedAt || null
    };

    for (const [date, dayStats] of Object.entries(normalized._legacy)) {
      for (const subject of ['chinese', 'english']) {
        if (dayStats[subject]) addIntoAggregate(normalized, date, subject, dayStats[subject]);
      }
    }

    for (const deviceData of Object.values(normalized._devices)) {
      for (const [date, dayStats] of Object.entries(deviceData.dates || {})) {
        for (const subject of ['chinese', 'english']) {
          if (dayStats[subject]) addIntoAggregate(normalized, date, subject, dayStats[subject]);
        }
      }
    }

    return normalized;
  }

  function mergeStats(remoteStats, localStats) {
    const remote = normalizeStats(remoteStats);
    const local = normalizeStats(localStats);
    const merged = emptyV2();

    merged._legacy = mergeDateStats(remote._legacy, local._legacy);

    const deviceIds = new Set([
      ...Object.keys(remote._devices || {}),
      ...Object.keys(local._devices || {})
    ]);

    for (const deviceId of deviceIds) {
      const remoteDevice = remote._devices[deviceId] || {};
      const localDevice = local._devices[deviceId] || {};
      const dates = mergeDateStats(remoteDevice.dates || {}, localDevice.dates || {});
      if (Object.keys(dates).length > 0) {
        merged._devices[deviceId] = {
          dates,
          updatedAt: [remoteDevice.updatedAt, localDevice.updatedAt].filter(Boolean).sort().pop() || null
        };
      }
    }

    merged._updatedAt = [remote._updatedAt, local._updatedAt].filter(Boolean).sort().pop() || null;
    return recomputeAggregates(merged);
  }

  function getPublicStats(stats) {
    const normalized = normalizeStats(stats);
    const publicStats = {};
    for (const [key, value] of Object.entries(normalized)) {
      if (isValidDateKey(key)) publicStats[key] = clone(value);
    }
    return publicStats;
  }

  function saveNormalized(stats) {
    saveToStorage(recomputeAggregates(normalizeStats(stats)));
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

          // 合并数据：旧 flat 数据先进 legacy，新记录按设备分账，避免多设备互相覆盖。
          const merged = mergeStats(fileData, localData);
          const mergedChangedRemote = JSON.stringify(merged) !== JSON.stringify(normalizeStats(fileData));
          saveNormalized(merged);
          if (mergedChangedRemote) triggerSync();
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
      const deviceId = getDeviceId();
      const stats = normalizeStats(loadFromStorage());
      const now = new Date().toISOString();

      if (!stats._devices[deviceId]) {
        stats._devices[deviceId] = { dates: {}, updatedAt: null };
      }
      if (!stats._devices[deviceId].dates[date]) {
        stats._devices[deviceId].dates[date] = {};
      }
      if (!stats._devices[deviceId].dates[date][subject]) {
        stats._devices[deviceId].dates[date][subject] = { correct: 0, total: 0, updatedAt: now };
      }

      const deviceStats = stats._devices[deviceId].dates[date][subject];
      deviceStats.correct += correct;
      deviceStats.total += total;
      deviceStats.updatedAt = now;
      stats._devices[deviceId].updatedAt = now;
      stats._updatedAt = now;

      saveNormalized(stats);
      triggerSync();

      const aggregate = getPublicStats(stats)[date][subject];
      console.log(`[DailyStats] 记录: ${date} ${subject} correct=${correct}, total=${total}, 累计 correct=${aggregate.correct}, total=${aggregate.total}`);
    },

    /**
     * 获取所有统计数据
     * @returns {Object} 完整统计数据对象
     */
    getAll() {
      return getPublicStats(loadFromStorage());
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
      const stats = normalizeStats(loadFromStorage());
      return JSON.stringify(stats, null, 2);
    },

    getSyncData() {
      return normalizeStats(loadFromStorage());
    },

    normalizeForSync(stats) {
      return normalizeStats(stats);
    },

    mergeForSync(remoteStats, localStats) {
      return mergeStats(remoteStats, localStats);
    },

    /**
     * 从远程同步数据合并到本地
     * @param {Object} remoteStats - 远程统计数据
     */
    mergeFromRemote(remoteStats) {
      if (!remoteStats) return;
      const local = normalizeStats(loadFromStorage());
      const merged = mergeStats(remoteStats, local);
      saveNormalized(merged);
      console.log('[DailyStats] 合并远程数据完成');
    }
  };
})();
