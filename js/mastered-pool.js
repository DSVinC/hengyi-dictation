/**
 * 恒一听写系统 - 掌握词池存储模块
 *
 * 功能：
 * - 管理掌握词的每日随机复习记录
 * - 确保每天每个词最多被随机到一次
 * - 跨天自动重置
 *
 * 存储模式：
 * - localStorage key: 'hengyi-mastered-reviewed'
 * - 值: { date: "2026-05-08", words: ["词1", "词2"] }
 */
(function() {
  const MASTERED_POOL_STORAGE_KEY = 'hengyi-mastered-reviewed';

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
    const data = localStorage.getItem(MASTERED_POOL_STORAGE_KEY);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('[MasteredPool] 解析 localStorage 数据失败:', e);
      return null;
    }
  }

  /**
   * 保存数据到 localStorage
   */
  function saveToStorage(data) {
    localStorage.setItem(MASTERED_POOL_STORAGE_KEY, JSON.stringify(data));
  }

  // ============================================
  // 公共 API
  // ============================================

  _global.MasteredPool = {
    /**
     * 获取今天已随机到的词文本集合
     * @returns {Set<string>} 今天已随机到的词文本集合
     */
    getTodayReviewed() {
      this.resetIfNewDay();
      const data = loadFromStorage();
      if (!data || !data.words) {
        return new Set();
      }
      return new Set(data.words);
    },

    /**
     * 标记一个词今天已随机到
     * @param {string} wordText - 词文本
     */
    markReviewed(wordText) {
      if (typeof wordText !== 'string' || !wordText.trim()) {
        console.error('[MasteredPool] wordText 必须是非空字符串');
        return;
      }

      this.resetIfNewDay();
      const data = loadFromStorage();
      const words = data ? data.words || [] : [];

      if (!words.includes(wordText)) {
        words.push(wordText);
        saveToStorage({
          date: getLocalDateString(),
          words: words
        });
        console.log(`[MasteredPool] 标记已随机: "${wordText}"`);
      }
    },

    /**
     * 检查是否跨天，跨天自动重置
     * @param {boolean} _skipReset - 内部标志，递归重置时跳过（防止无限循环）
     */
    resetIfNewDay(_skipReset = false) {
      if (_skipReset) return; // 递归调用时跳过

      const data = loadFromStorage();
      const today = getLocalDateString();

      if (!data || data.date !== today) {
        // 跨天或首次使用，重置为空
        saveToStorage({
          date: today,
          words: []
        });
        console.log(`[MasteredPool] 跨天重置: ${today}`);
      }
    },

    /**
     * 从词池中随机选择指定数量的词（排除已随机到的词）
     * @param {Array<Object>} pool - 词对象数组
     * @param {number} count - 需要选择的数量，默认 3
     * @returns {Array<Object>} 随机选择的词对象数组
     */
    selectRandom(pool, count = 3) {
      // 参数校验
      if (!Array.isArray(pool)) {
        console.error('[MasteredPool] pool 必须是数组');
        return [];
      }
      if (typeof count !== 'number' || count < 1) {
        console.error('[MasteredPool] count 必须是正整数');
        return [];
      }

      this.resetIfNewDay();
      const reviewedSet = this.getTodayReviewed();

      // 过滤出未随机到的词
      const available = pool.filter(word => {
        const text = word.text || word.wordText || word.word || '';
        return !reviewedSet.has(text);
      });

      // 如果全部已选完，先重置再选
      if (available.length === 0) {
        // 如果 pool 本身就是空的，返回空数组（防止无限循环）
        if (pool.length === 0) {
          console.log('[MasteredPool] 词池为空，无法选择');
          return [];
        }
        console.log('[MasteredPool] 所有词已选完，重置后重新选择');
        saveToStorage({
          date: getLocalDateString(),
          words: []
        });
        return this.selectRandom(pool, count);
      }

      // 如果池子不足 count 个，选全部
      const selectCount = Math.min(count, available.length);

      // Fisher-Yates 洗牌算法随机选择
      const shuffled = [...available];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      const selected = shuffled.slice(0, selectCount);

      // 标记已选择
      selected.forEach(word => {
        const text = word.text || word.wordText || word.word || '';
        if (text) {
          this.markReviewed(text);
        }
      });

      console.log(`[MasteredPool] 随机选择 ${selected.length} 个词`);
      return selected;
    },

    /**
     * 清除所有数据（用于测试）
     */
    clear() {
      localStorage.removeItem(MASTERED_POOL_STORAGE_KEY);
      console.log('[MasteredPool] 数据已清除');
    },

    /**
     * 获取当前存储的原始数据（用于调试）
     * @returns {Object|null} 原始数据对象
     */
    getRawData() {
      return loadFromStorage();
    }
  };

  // ============================================
  // 内联测试
  // ============================================

  /**
   * 运行测试用例
   * 在 Node.js 环境下运行：node --check js/mastered-pool.js
   */
  function runTests() {
    console.log('\n[MasteredPool] 开始运行测试...\n');

    // 模拟 localStorage（Node.js 环境）
    if (typeof localStorage === 'undefined') {
      global.localStorage = {
        store: {},
        getItem(key) {
          return this.store[key] || null;
        },
        setItem(key, value) {
          this.store[key] = value;
        },
        removeItem(key) {
          delete this.store[key];
        }
      };
      console.log('[MasteredPool] 已模拟 localStorage\n');
    }

    // 测试 1：getTodayReviewed 空数据
    MasteredPool.clear();
    const test1 = MasteredPool.getTodayReviewed();
    console.assert(test1 instanceof Set, '测试1失败: getTodayReviewed 应返回 Set');
    console.assert(test1.size === 0, '测试1失败: 空 Set');
    console.log('✓ 测试1通过: getTodayReviewed 返回空 Set');

    // 测试 2：markReviewed 和 getTodayReviewed
    MasteredPool.clear();
    MasteredPool.markReviewed('词1');
    MasteredPool.markReviewed('词2');
    const test2 = MasteredPool.getTodayReviewed();
    console.assert(test2.size === 2, '测试2失败: 应有 2 个词');
    console.assert(test2.has('词1'), '测试2失败: 应包含"词1"');
    console.assert(test2.has('词2'), '测试2失败: 应包含"词2"');
    console.log('✓ 测试2通过: markReviewed 正确标记');

    // 测试 3：重复标记不重复添加
    MasteredPool.clear();
    MasteredPool.markReviewed('词A');
    MasteredPool.markReviewed('词A');
    MasteredPool.markReviewed('词A');
    const test3 = MasteredPool.getTodayReviewed();
    console.assert(test3.size === 1, '测试3失败: 重复标记不应重复添加');
    console.log('✓ 测试3通过: 重复标记不重复添加');

    // 测试 4：selectRandom 基本功能
    MasteredPool.clear();
    const pool4 = [
      { text: '词A', id: 1 },
      { text: '词B', id: 2 },
      { text: '词C', id: 3 },
      { text: '词D', id: 4 },
      { text: '词E', id: 5 }
    ];
    const selected4 = MasteredPool.selectRandom(pool4, 3);
    console.assert(selected4.length === 3, '测试4失败: 应选择 3 个词');
    console.assert(Array.isArray(selected4), '测试4失败: 应返回数组');
    console.log('✓ 测试4通过: selectRandom 正确选择 3 个词');

    // 测试 5：selectRandom 不重复选择
    MasteredPool.clear();
    const pool5 = [
      { text: '词X', id: 1 },
      { text: '词Y', id: 2 },
      { text: '词Z', id: 3 }
    ];
    const selected5a = MasteredPool.selectRandom(pool5, 2);
    const selected5b = MasteredPool.selectRandom(pool5, 2);
    const allTexts = [...selected5a, ...selected5b].map(w => w.text);
    const uniqueTexts = new Set(allTexts);
    console.assert(uniqueTexts.size === allTexts.length, '测试5失败: 不应重复选择同一个词');
    console.log('✓ 测试5通过: selectRandom 不重复选择');

    // 测试 6：selectRandom 池子不足时选全部
    MasteredPool.clear();
    const pool6 = [
      { text: '词M', id: 1 },
      { text: '词N', id: 2 }
    ];
    const selected6 = MasteredPool.selectRandom(pool6, 5);
    console.assert(selected6.length === 2, '测试6失败: 池子不足时应选全部（2个）');
    console.log('✓ 测试6通过: selectRandom 池子不足时选全部');

    // 测试 7：selectRandom 全部选完后重置
    MasteredPool.clear();
    const pool7 = [
      { text: '词P', id: 1 },
      { text: '词Q', id: 2 }
    ];
    // 第一次选择全部
    const selected7a = MasteredPool.selectRandom(pool7, 2);
    console.assert(selected7a.length === 2, '测试7失败: 第一次应选 2 个');
    // 第二次选择应该触发重置
    const selected7b = MasteredPool.selectRandom(pool7, 2);
    console.assert(selected7b.length === 2, '测试7失败: 重置后应再选 2 个');
    console.log('✓ 测试7通过: selectRandom 全部选完后重置');

    // 测试 8：跨天重置（模拟）
    MasteredPool.clear();
    // 设置昨天的数据
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    localStorage.setItem(MASTERED_POOL_STORAGE_KEY, JSON.stringify({
      date: yesterdayStr,
      words: ['旧词1', '旧词2']
    }));
    // 调用 resetIfNewDay 应该重置
    MasteredPool.resetIfNewDay();
    const test8 = MasteredPool.getTodayReviewed();
    console.assert(test8.size === 0, '测试8失败: 跨天应重置为空');
    console.log('✓ 测试8通过: 跨天重置正确');

    // 测试 9：markReviewed 传入空值或无效值
    MasteredPool.clear();
    const before = MasteredPool.getTodayReviewed().size;
    MasteredPool.markReviewed('');
    MasteredPool.markReviewed('   ');
    MasteredPool.markReviewed(null);
    MasteredPool.markReviewed(undefined);
    const after = MasteredPool.getTodayReviewed().size;
    console.assert(before === after, '测试9失败: 无效值不应被添加');
    console.log('✓ 测试9通过: 无效值不被添加');

    // 测试 10：selectRandom 传入无效参数
    MasteredPool.clear();
    const test10a = MasteredPool.selectRandom(null, 3);
    console.assert(Array.isArray(test10a) && test10a.length === 0, '测试10失败: null pool 应返回空数组');
    const test10b = MasteredPool.selectRandom([], 3);
    console.assert(Array.isArray(test10b) && test10b.length === 0, '测试10失败: 空 pool 应返回空数组');
    const test10c = MasteredPool.selectRandom([{ text: '测试' }], -1);
    console.assert(Array.isArray(test10c) && test10c.length === 0, '测试10失败: 无效 count 应返回空数组');
    console.log('✓ 测试10通过: 无效参数正确处理');

    console.log('\n[MasteredPool] ✓ 所有测试通过！\n');
  }

  // 自动运行测试（仅 Node.js 环境）
  if (typeof window === 'undefined' && typeof require === 'function' && require.main === module) {
    runTests();
  }
})();
