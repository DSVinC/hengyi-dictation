/**
 * 恒一听写系统 - 主逻辑
 *
 * 功能：
 * 1. 三级导航：科目 → 课/单元 → 词勾选
 * 2. 艾宾浩斯轮次计算
 * 3. 生成听写清单（新课词 + 复习词）
 */

// ============================================
// 应用状态
// ============================================
const AppState = {
  currentPage: 'dictation',  // 当前页面：dictation, vocabulary, progress
  currentSubject: null,       // 当前科目：chinese, english
  currentLesson: null,       // 当前课/单元
  selectedWords: new Set(),   // 已勾选的词语
  lessons: [],                // 语文课列表
  units: [],                  // 英语单元列表
  wordData: {},               // 缓存的词语数据
  isLoading: false            // 全局加载状态
};

// ============================================
// 请求超时配置
// ============================================
const FETCH_TIMEOUT = 10000; // 10秒超时

// ============================================
// 艾宾浩斯复习间隔（天）
// 第0轮: 新学 → 第1轮: 1天后 → 第2轮: 2天后
// 第3轮: 4天后 → 第4轮: 7天后 → 第5轮: 15天后
// ============================================
const EBINGHAUS_INTERVALS = [1, 2, 4, 7, 15];

// ============================================
// 工具函数
// ============================================

/**
 * 带超时的 fetch 请求
 * @param {string} url - 请求URL
 * @param {object} options - fetch选项
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接后刷新页面');
    }
    throw error;
  }
}

/**
 * 解析 JSON 并捕获错误
 * @param {Response} response - fetch响应
 * @returns {Promise<object>}
 */
async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error('数据格式错误，请刷新页面重试');
  }
}

/**
 * 显示全局加载状态
 */
function showLoading() {
  AppState.isLoading = true;
  const loadingEl = document.getElementById('global-loading');
  if (loadingEl) {
    loadingEl.classList.add('visible');
  }
}

/**
 * 隐藏全局加载状态
 */
function hideLoading() {
  AppState.isLoading = false;
  const loadingEl = document.getElementById('global-loading');
  if (loadingEl) {
    loadingEl.classList.remove('visible');
  }
}

/**
 * 显示错误提示
 * @param {string} message - 错误消息
 */
function showError(message) {
  const errorEl = document.getElementById('global-error');
  if (errorEl) {
    errorEl.querySelector('.error-text').textContent = message;
    errorEl.classList.add('visible');
  }
}

/**
 * 隐藏错误提示
 */
function hideError() {
  const errorEl = document.getElementById('global-error');
  if (errorEl) {
    errorEl.classList.remove('visible');
  }
}

/**
 * 计算下一次复习日期
 * @param {number} round - 当前轮次 (0-5)
 * @returns {string|null} 下次复习日期 (ISO 格式) 或 null
 */
function calculateNextReview(round) {
  if (round >= 5) return null; // 第5轮后视为完全掌握
  const days = EBINGHAUS_INTERVALS[round];
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate.toISOString().split('T')[0];
}

/**
 * 判断词语是否需要复习（已到期）
 * @param {object} word - 词语对象
 * @returns {boolean}
 */
function isWordDueForReview(word) {
  if (!word.nextReview || word.round === 0) return false;
  const today = new Date().toISOString().split('T')[0];
  return word.nextReview <= today;
}

// ============================================
// 数据加载
// ============================================

/**
 * 加载语文课列表
 */
async function loadChineseLessons() {
  try {
    showLoading();
    hideError();
    const response = await fetchWithTimeout('data/chinese/lessons.json');
    if (!response.ok) {
      throw new Error('加载失败，请刷新页面重试');
    }
    const data = await parseJsonSafe(response);
    AppState.lessons = data.lessons;
    return data.lessons;
  } catch (error) {
    console.error('加载语文课列表失败:', error);
    showError(error.message || '加载失败，请刷新页面重试');
    return [];
  } finally {
    hideLoading();
  }
}

/**
 * 加载英语单元列表
 */
async function loadEnglishUnits() {
  try {
    showLoading();
    hideError();
    const response = await fetchWithTimeout('data/english/units.json');
    if (!response.ok) {
      throw new Error('加载失败，请刷新页面重试');
    }
    const data = await parseJsonSafe(response);
    AppState.units = data.units;
    return data.units;
  } catch (error) {
    console.error('加载英语单元列表失败:', error);
    showError(error.message || '加载失败，请刷新页面重试');
    return [];
  } finally {
    hideLoading();
  }
}

/**
 * 加载课/单元的词语数据
 * @param {string} subject - 科目 (chinese/english)
 * @param {string} lessonId - 课/单元ID
 */
async function loadWordData(subject, lessonId) {
  const cacheKey = `${subject}/${lessonId}`;
  if (AppState.wordData[cacheKey]) {
    return AppState.wordData[cacheKey];
  }

  try {
    showLoading();
    hideError();
    const path = subject === 'chinese'
      ? `data/chinese/${lessonId}.json`
      : `data/english/${lessonId}.json`;
    const response = await fetchWithTimeout(path);
    if (!response.ok) {
      throw new Error('加载失败，请刷新页面重试');
    }
    const data = await parseJsonSafe(response);
    AppState.wordData[cacheKey] = data;
    return data;
  } catch (error) {
    console.error(`加载词语数据失败 [${lessonId}]:`, error);
    showError(error.message || '加载失败，请刷新页面重试');
    return null;
  } finally {
    hideLoading();
  }
}

// ============================================
// 页面渲染
// ============================================

/**
 * 渲染主内容区（带淡入动画）
 */
function renderContent(html) {
  const mainContent = document.getElementById('main-content');
  mainContent.classList.remove('fade-in');
  mainContent.innerHTML = html;
  // 触发动画
  requestAnimationFrame(() => {
    mainContent.classList.add('fade-in');
  });
}

/**
 * 渲染听写模式页面
 */
async function renderDictationPage() {
  const html = `
    <h2 class="page-title">选择科目</h2>
    <div class="subject-select">
      <button class="subject-btn chinese" onclick="selectSubject('chinese')">
        <span class="subject-icon">📖</span>
        <span>语文</span>
      </button>
      <button class="subject-btn english" onclick="selectSubject('english')">
        <span class="subject-icon">📚</span>
        <span>英语</span>
      </button>
    </div>
  `;
  renderContent(html);
}

/**
 * 选择科目后渲染课/单元列表
 */
async function selectSubject(subject) {
  AppState.currentSubject = subject;
  AppState.selectedWords.clear();

  const isChinese = subject === 'chinese';
  const items = isChinese
    ? await loadChineseLessons()
    : await loadEnglishUnits();

  const subjectName = isChinese ? '语文' : '英语';
  const itemName = isChinese ? '课' : '单元';

  if (items.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="goBack()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">还没有${itemName}数据，请先添加课程内容</p>
        <p class="empty-hint">提示：在 data/${subject} 目录下创建 lessons.json 或 units.json</p>
      </div>
    `);
    return;
  }

  const listHtml = items.map(item => `
    <div class="lesson-item" onclick="selectLesson('${item.id}')">
      <span class="lesson-name">${item.name}</span>
      <span class="lesson-arrow">›</span>
    </div>
  `).join('');

  renderContent(`
    <button class="back-btn" onclick="goBack()">← 返回</button>
    <h2 class="page-title">${subjectName}${itemName}列表</h2>
    <div class="lesson-list">${listHtml}</div>
  `);
}

/**
 * 选择课/单元后渲染词语勾选列表
 */
async function selectLesson(lessonId) {
  AppState.currentLesson = lessonId;
  AppState.selectedWords.clear();

  const subject = AppState.currentSubject;
  const data = await loadWordData(subject, lessonId);

  if (!data || !data.words || data.words.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="goBackToLessons()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">还没有词语数据，请先添加词语内容</p>
        <p class="empty-hint">提示：在 data/${subject}/${lessonId}.json 中添加词语列表</p>
      </div>
    `);
    return;
  }

  const isChinese = subject === 'chinese';
  const title = isChinese ? data.lessonName : data.unitName;

  renderWordSelectionPage(data, title, isChinese);
}

/**
 * 渲染词语勾选页面
 */
function renderWordSelectionPage(data, title, isChinese) {
  const wordsHtml = data.words.map(word => {
    const isDue = isWordDueForReview(word);
    const reviewTag = isDue
      ? `<span class="review-tag round-${word.round}">R${word.round}</span>`
      : '';

    const meaningHtml = !isChinese && word.meaning
      ? `<span class="word-meaning">${word.meaning}</span>`
      : '';

    const typeHtml = isChinese && word.type
      ? `<span class="word-type">${word.type === 'char' ? '字' : '词'}</span>`
      : '';

    return `
      <label class="word-item" data-word="${word.text}">
        <input type="checkbox" class="word-checkbox"
          onchange="toggleWordSelection('${word.text}')"
          ${word.round > 0 && isDue ? 'checked' : ''}>
        <span class="word-text">${word.text}${reviewTag}</span>
        ${typeHtml}
        ${meaningHtml}
      </label>
    `;
  }).join('');

  renderContent(`
    <button class="back-btn" onclick="goBackToLessons()">← 返回</button>
    <h2 class="page-title">${title}</h2>
    <div class="word-list">${wordsHtml}</div>
    <div class="action-bar">
      <button class="btn btn-secondary" onclick="selectAllWords()">全选</button>
      <button class="btn btn-primary" onclick="generateDictationList()">生成听写清单</button>
    </div>
    <div id="dictation-result"></div>
  `);

  // 自动选中所有到期复习的词
  data.words.forEach(word => {
    if (isWordDueForReview(word)) {
      AppState.selectedWords.add(word.text);
    }
  });
}

/**
 * 切换词语勾选状态
 */
function toggleWordSelection(wordText) {
  if (AppState.selectedWords.has(wordText)) {
    AppState.selectedWords.delete(wordText);
  } else {
    AppState.selectedWords.add(wordText);
  }
}

/**
 * 全选当前课/单元的所有词语
 */
function selectAllWords() {
  const subject = AppState.currentSubject;
  const lessonId = AppState.currentLesson;
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];

  if (data && data.words) {
    data.words.forEach(word => {
      AppState.selectedWords.add(word.text);
    });

    // 更新 UI
    document.querySelectorAll('.word-checkbox').forEach(cb => {
      cb.checked = true;
    });
  }
}

/**
 * 生成听写清单
 */
function generateDictationList() {
  if (AppState.selectedWords.size === 0) {
    alert('请先勾选词语');
    return;
  }

  const subject = AppState.currentSubject;
  const lessonId = AppState.currentLesson;
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];
  const isChinese = subject === 'chinese';

  // 分类：新课词 vs 复习词
  const newWords = [];
  const reviewWords = [];

  data.words.forEach(word => {
    if (AppState.selectedWords.has(word.text)) {
      if (word.round === 0) {
        newWords.push(word);
      } else {
        reviewWords.push(word);
      }
    }
  });

  // 构建清单 HTML（两栏布局）
  let resultHtml = '<div class="dictation-list dictation-two-column">';

  if (newWords.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title new">📝 新课词语 (${newWords.length})</h3>
        <div class="dictation-words">
          ${newWords.map(w => `<span class="dictation-word new">${w.text}</span>`).join('')}
        </div>
      </div>
    `;
  }

  if (reviewWords.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title review">🔄 复习词语 (${reviewWords.length})</h3>
        <div class="dictation-words">
          ${reviewWords.map(w => {
            const roundTag = w.round >= 5 ? '✅' : `R${w.round}`;
            return `<span class="dictation-word review">${w.text} <small>${roundTag}</small></span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  resultHtml += '</div>';

  // 统计信息
  const total = newWords.length + reviewWords.length;
  resultHtml += `<p style="text-align:center; margin-top:16px; color:#666;">共 ${total} 个词语</p>`;

  document.getElementById('dictation-result').innerHTML = resultHtml;
}

/**
 * 返回上一级
 */
function goBack() {
  AppState.currentSubject = null;
  AppState.selectedWords.clear();
  renderDictationPage();
}

/**
 * 返回课/单元列表
 */
function goBackToLessons() {
  AppState.currentLesson = null;
  AppState.selectedWords.clear();
  selectSubject(AppState.currentSubject);
}

// ============================================
// 导航
// ============================================

/**
 * 获取词语状态文本
 * @param {number} round - 当前轮次
 * @returns {object} {icon, text, className}
 */
function getWordStatus(round) {
  if (round === 0) {
    return { icon: '🆕', text: '新词', className: 'status-new' };
  } else if (round >= 1 && round <= 5) {
    return { icon: '📝', text: `复习中 R${round}`, className: 'status-review' };
  } else {
    return { icon: '✅', text: '已掌握', className: 'status-mastered' };
  }
}

/**
 * 格式化日期显示
 * @param {string|null} dateStr - ISO日期字符串
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dateOnly = date.toDateString();
  if (dateOnly === today.toDateString()) return '今天';
  if (dateOnly === tomorrow.toDateString()) return '明天';

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日`;
}

// ============================================
// 词库管理页面
// ============================================

/**
 * 渲染词库管理页面 - 科目选择
 */
function renderVocabularyPage() {
  AppState.currentSubject = null;
  AppState.currentLesson = null;

  const html = `
    <h2 class="page-title">词库管理</h2>
    <div class="subject-select">
      <button class="subject-btn chinese" onclick="selectVocabSubject('chinese')">
        <span class="subject-icon">📖</span>
        <span>语文</span>
      </button>
      <button class="subject-btn english" onclick="selectVocabSubject('english')">
        <span class="subject-icon">📚</span>
        <span>英语</span>
      </button>
    </div>
  `;
  renderContent(html);
}

/**
 * 选择科目后渲染课/单元列表（词库管理）
 */
async function selectVocabSubject(subject) {
  AppState.currentSubject = subject;

  const isChinese = subject === 'chinese';
  const items = isChinese
    ? await loadChineseLessons()
    : await loadEnglishUnits();

  const subjectName = isChinese ? '语文' : '英语';
  const itemName = isChinese ? '课' : '单元';

  if (items.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="renderVocabularyPage()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">还没有${itemName}数据，请先添加课程内容</p>
        <p class="empty-hint">提示：在 data/${subject} 目录下创建 lessons.json 或 units.json</p>
      </div>
    `);
    return;
  }

  // 统计每个课/单元的词语状态
  const itemsWithStats = await Promise.all(items.map(async (item) => {
    const data = await loadWordData(subject, item.id);
    if (!data || !data.words) {
      return { ...item, newCount: 0, reviewCount: 0, masteredCount: 0, totalCount: 0 };
    }
    const newCount = data.words.filter(w => w.round === 0).length;
    const reviewCount = data.words.filter(w => w.round >= 1 && w.round <= 5).length;
    const masteredCount = data.words.filter(w => w.round >= 6).length;
    return { ...item, newCount, reviewCount, masteredCount, totalCount: data.words.length };
  }));

  const listHtml = itemsWithStats.map(item => `
    <div class="lesson-item" onclick="selectVocabLesson('${item.id}')">
      <div class="lesson-info">
        <span class="lesson-name">${item.name}</span>
        <div class="lesson-stats">
          <span class="stat-badge stat-new">🆕 ${item.newCount}</span>
          <span class="stat-badge stat-review">📝 ${item.reviewCount}</span>
          <span class="stat-badge stat-mastered">✅ ${item.masteredCount}</span>
        </div>
      </div>
      <span class="lesson-arrow">›</span>
    </div>
  `).join('');

  renderContent(`
    <button class="back-btn" onclick="renderVocabularyPage()">← 返回</button>
    <h2 class="page-title">${subjectName}${itemName}列表</h2>
    <div class="lesson-list">${listHtml}</div>
  `);
}

/**
 * 选择课/单元后渲染词语列表（词库管理）
 */
async function selectVocabLesson(lessonId) {
  AppState.currentLesson = lessonId;

  const subject = AppState.currentSubject;
  const data = await loadWordData(subject, lessonId);
  const isChinese = subject === 'chinese';

  if (!data || !data.words || data.words.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="selectVocabSubject('${subject}')">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">还没有词语数据，请先添加词语内容</p>
        <p class="empty-hint">提示：在 data/${subject}/${lessonId}.json 中添加词语列表</p>
      </div>
    `);
    return;
  }

  const title = isChinese ? data.lessonName : data.unitName;

  // 按状态分组排序：新词 → 复习中 → 已掌握
  const sortedWords = [...data.words].sort((a, b) => {
    const getPriority = (w) => {
      if (w.round === 0) return 0;
      if (w.round >= 1 && w.round <= 5) return 1;
      return 2;
    };
    return getPriority(a) - getPriority(b);
  });

  const wordsHtml = sortedWords.map(word => {
    const status = getWordStatus(word.round);
    const meaningHtml = !isChinese && word.meaning
      ? `<span class="vocab-word-meaning">${word.meaning}</span>`
      : '';

    const typeHtml = isChinese && word.type
      ? `<span class="word-type">${word.type === 'char' ? '字' : '词'}</span>`
      : '';

    const nextReviewText = word.nextReview ? formatDate(word.nextReview) : '-';

    return `
      <div class="vocab-word-item">
        <div class="vocab-word-main">
          <span class="vocab-word-text">${word.text}</span>
          ${typeHtml}
          ${meaningHtml}
        </div>
        <div class="vocab-word-meta">
          <span class="vocab-status ${status.className}">${status.icon} ${status.text}</span>
          <span class="vocab-next-review">下次: ${nextReviewText}</span>
        </div>
      </div>
    `;
  }).join('');

  // 统计信息
  const newCount = data.words.filter(w => w.round === 0).length;
  const reviewCount = data.words.filter(w => w.round >= 1 && w.round <= 5).length;
  const masteredCount = data.words.filter(w => w.round >= 6).length;

  renderContent(`
    <button class="back-btn" onclick="selectVocabSubject('${subject}')">← 返回</button>
    <h2 class="page-title">${title}</h2>
    <div class="vocab-summary">
      <span class="stat-badge stat-new">🆕 新词 ${newCount}</span>
      <span class="stat-badge stat-review">📝 复习 ${reviewCount}</span>
      <span class="stat-badge stat-mastered">✅ 掌握 ${masteredCount}</span>
    </div>
    <div class="vocab-word-list">${wordsHtml}</div>
  `);
}

/**
 * 切换页面
 */
function switchPage(page) {
  AppState.currentPage = page;

  // 更新导航栏状态
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // 重置状态
  AppState.currentSubject = null;
  AppState.currentLesson = null;
  AppState.selectedWords.clear();

  // 渲染对应页面
  switch (page) {
    case 'dictation':
      renderDictationPage();
      break;
    case 'vocabulary':
      renderVocabularyPage();
      break;
    case 'progress':
      renderProgressPage('all');
      break;
  }
}

// ============================================
// 进度总览页面
// ============================================

/**
 * 渲染进度总览页面
 * @param {string} filter - 筛选类型: all, chinese, english
 */
async function renderProgressPage(filter = 'all') {
  renderContent('<div class="loading">加载中...</div>');

  // 加载所有数据
  const chineseLessons = await loadChineseLessons();
  const englishUnits = await loadEnglishUnits();

  // 收集所有词语数据
  const allWords = [];
  const lessonStats = [];

  // 加载语文词语
  if (filter === 'all' || filter === 'chinese') {
    for (const lesson of chineseLessons) {
      const data = await loadWordData('chinese', lesson.id);
      if (data && data.words) {
        data.words.forEach(word => {
          allWords.push({ ...word, subject: 'chinese', lessonId: lesson.id, lessonName: data.lessonName });
        });
        const masteredCount = data.words.filter(w => w.round >= 6).length;
        lessonStats.push({
          name: lesson.name,
          subject: 'chinese',
          mastered: masteredCount,
          total: data.words.length,
          percent: data.words.length > 0 ? Math.round((masteredCount / data.words.length) * 100) : 0
        });
      }
    }
  }

  // 加载英语词语
  if (filter === 'all' || filter === 'english') {
    for (const unit of englishUnits) {
      const data = await loadWordData('english', unit.id);
      if (data && data.words) {
        data.words.forEach(word => {
          allWords.push({ ...word, subject: 'english', unitId: unit.id, unitName: data.unitName });
        });
        const masteredCount = data.words.filter(w => w.round >= 6).length;
        lessonStats.push({
          name: unit.name,
          subject: 'english',
          mastered: masteredCount,
          total: data.words.length,
          percent: data.words.length > 0 ? Math.round((masteredCount / data.words.length) * 100) : 0
        });
      }
    }
  }

  // 计算总体统计
  const totalCount = allWords.length;
  const masteredCount = allWords.filter(w => w.round >= 6).length;
  const reviewCount = allWords.filter(w => w.round >= 1 && w.round <= 5).length;
  const newCount = allWords.filter(w => w.round === 0).length;
  const masteryPercent = totalCount > 0 ? Math.round((masteredCount / totalCount) * 100) : 0;

  // 高频错词排行（前10）
  const errorWords = allWords
    .filter(w => w.wrongCount > 0)
    .sort((a, b) => b.wrongCount - a.wrongCount)
    .slice(0, 10);

  // 按完成度排序课/单元
  lessonStats.sort((a, b) => b.percent - a.percent);

  // 渲染页面
  const filterHtml = `
    <div class="filter-bar">
      <button class="filter-btn all ${filter === 'all' ? 'active' : ''}" onclick="renderProgressPage('all')">全部</button>
      <button class="filter-btn chinese ${filter === 'chinese' ? 'active' : ''}" onclick="renderProgressPage('chinese')">语文</button>
      <button class="filter-btn english ${filter === 'english' ? 'active' : ''}" onclick="renderProgressPage('english')">英语</button>
    </div>
  `;

  // 总体统计卡片
  const statsHtml = `
    <div class="stats-card">
      <h3 class="stats-title">📊 总体统计</h3>
      <div class="stats-grid">
        <div class="stat-item total">
          <span class="stat-value">${totalCount}</span>
          <span class="stat-label">总词数</span>
        </div>
        <div class="stat-item mastered">
          <span class="stat-value">${masteredCount}</span>
          <span class="stat-label">已掌握</span>
        </div>
        <div class="stat-item review">
          <span class="stat-value">${reviewCount}</span>
          <span class="stat-label">复习中</span>
        </div>
        <div class="stat-item new">
          <span class="stat-value">${newCount}</span>
          <span class="stat-label">新词</span>
        </div>
      </div>
      <div class="mastery-section">
        <div class="mastery-ring">
          <svg viewBox="0 0 100 100">
            <circle class="mastery-ring-bg" cx="50" cy="50" r="40"></circle>
            <circle class="mastery-ring-progress" cx="50" cy="50" r="40"
              stroke-dasharray="${2 * Math.PI * 40}"
              stroke-dashoffset="${2 * Math.PI * 40 * (1 - masteryPercent / 100)}"></circle>
          </svg>
          <span class="mastery-percent">${masteryPercent}%</span>
        </div>
        <span class="mastery-label">掌握率</span>
      </div>
    </div>
  `;

  // 高频错词排行
  const errorHtml = errorWords.length > 0
    ? `
      <div class="error-ranking">
        <h3 class="error-title">⚠️ 高频错词排行 (前10)</h3>
        <div class="error-list">
          ${errorWords.map(word => `
            <div class="error-item">
              <span class="error-word">${word.text}</span>
              <div class="error-info">
                <span class="error-count">❌ ${word.wrongCount}次</span>
                <span class="error-round">R${word.round}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : `
      <div class="error-ranking">
        <h3 class="error-title">⚠️ 高频错词排行</h3>
        <div class="empty-state">
          <p class="empty-text">暂无错词记录</p>
        </div>
      </div>
    `;

  // 各课/单元完成情况
  const progressHtml = lessonStats.length > 0
    ? `
      <div class="lesson-progress">
        <h3 class="progress-title">📚 各课/单元完成情况</h3>
        <div class="progress-list">
          ${lessonStats.map(stat => {
            const barClass = stat.percent < 30 ? 'low' : stat.percent < 60 ? 'medium' : '';
            return `
              <div class="progress-item">
                <div class="progress-header">
                  <span class="progress-lesson-name">${stat.name}</span>
                  <span class="progress-numbers">${stat.mastered}/${stat.total}</span>
                </div>
                <div class="progress-bar-container">
                  <div class="progress-bar ${barClass}" style="width: ${stat.percent}%"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `
    : `
      <div class="lesson-progress">
        <h3 class="progress-title">📚 各课/单元完成情况</h3>
        <div class="empty-state">
          <p class="empty-text">暂无课/单元数据</p>
        </div>
      </div>
    `;

  renderContent(`
    <h2 class="page-title">进度总览</h2>
    ${filterHtml}
    ${statsHtml}
    ${errorHtml}
    ${progressHtml}
  `);
}

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  // 绑定导航按钮事件
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // 默认显示听写模式
  renderDictationPage();
});