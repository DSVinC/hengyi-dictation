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
  isLoading: false,           // 全局加载状态
  currentDictationList: [],   // 当前听写清单（用于批改）
  originalDictationHtml: '',  // 原始清单 HTML（用于取消批改）
  reviewWordsPage: 1          // 复习中的词分页页码
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

/**
 * 获取科目所有到期复习词
 * @param {string} subject - 科目 (chinese/english)
 * @returns {Promise<Array>} 到期复习词列表 [{ text, meaning, round, lessonId, lessonName, ... }]
 */
async function getAllDueReviewWords(subject) {
  const isChinese = subject === 'chinese';
  const items = isChinese ? AppState.lessons : AppState.units;
  const today = new Date().toISOString().split('T')[0];

  const dueWords = [];

  for (const item of items) {
    const cacheKey = `${subject}/${item.id}`;
    // 确保数据已加载
    if (!AppState.wordData[cacheKey]) {
      await loadWordData(subject, item.id);
    }
    const data = AppState.wordData[cacheKey];

    if (data && data.words) {
      // 合并 localStorage 进度
      mergeProgressToWords(data, subject, item.id);
      const lessonName = isChinese ? data.lessonName : data.unitName;
      data.words.forEach(word => {
        // round >= 1 且 nextReview <= today
        if (word.round >= 1 && word.nextReview && word.nextReview <= today) {
          dueWords.push({
            ...word,
            subject: subject,
            lessonId: item.id,
            lessonName: lessonName
          });
        }
      });
    }
  }

  // 按轮次排序：R1 > R2 > R3 > R4 > R5
  dueWords.sort((a, b) => a.round - b.round);

  return dueWords;
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
async function loadWordData(subject, lessonId, silent = false) {
  const cacheKey = `${subject}/${lessonId}`;
  if (AppState.wordData[cacheKey]) {
    return AppState.wordData[cacheKey];
  }

  try {
    if (!silent) showLoading();
    if (!silent) hideError();
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
    if (!silent) showError(error.message || '加载失败，请刷新页面重试');
    return null;
  } finally {
    if (!silent) hideLoading();
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
 * 选择课/单元后渲染词语勾选列表（异步）
 */
async function selectLesson(lessonId) {
  AppState.currentLesson = lessonId;
  AppState.selectedWords.clear();

  const subject = AppState.currentSubject;
  let data = await loadWordData(subject, lessonId);

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

  // 合并 localStorage 进度到词数据
  data = mergeProgressToWords(data, subject, lessonId);

  const isChinese = subject === 'chinese';
  const title = isChinese ? data.lessonName : data.unitName;

  // 先渲染页面（不含到期复习词），再异步加载复习词
  await renderWordSelectionPage(data, title, isChinese);
  // 异步加载到期复习词，不阻塞页面
  loadAndRenderDueReviewWords(subject, isChinese);
}

/**
 * 渲染词语勾选页面（带到期复习词独立区块）
 */
function renderWordSelectionPage(data, title, isChinese) {
  const subject = AppState.currentSubject;
  const currentLessonWords = data.words.filter(w => w.round === 0);

  // 新词勾选列表
  const newWordsHtml = currentLessonWords.map(word => {
    const typeHtml = isChinese && word.type
      ? `<span class="word-type">${word.type === 'char' ? '字' : '词'}</span>`
      : '';
    return `
      <label class="word-item" data-word="${word.text}">
        <input type="checkbox" class="word-checkbox"
          onchange="toggleWordSelection('${word.text}')">
        <span class="word-text">${word.text}</span>
        ${typeHtml}
      </label>
    `;
  }).join('');

  const WORD_LIMIT = 20;
  const selectedCount = AppState.selectedWords.size;

  renderContent(`
    <button class="back-btn" onclick="goBackToLessons()">← 返回</button>
    <h2 class="page-title">${title}</h2>
    <p id="limit-hint" class="limit-hint">已选 ${selectedCount} 词 / R1 到期 0 词 / 共 ${selectedCount}/${WORD_LIMIT}</p>
    <h3 class="section-title new">🆕 新课词语（${currentLessonWords.length}）</h3>
    <div class="word-list">${newWordsHtml}</div>
    <div id="due-review-container"></div>
    <div class="action-bar">
      <button class="btn btn-secondary" onclick="selectAllWords()">全选新词</button>
      <button class="btn btn-primary" onclick="generateDictationList()">生成听写清单</button>
    </div>
    <div id="dictation-result"></div>
  `);
}

/**
 * 异步加载到期复习词并插入到页面（不阻塞首屏渲染）
 */
async function loadAndRenderDueReviewWords(subject, isChinese) {
  const dueReviewWords = await getAllDueReviewWords(subject);
  const r1DueWords = dueReviewWords.filter(w => w.round === 1);
  const r2PlusDueWords = dueReviewWords.filter(w => w.round >= 2);

  if (dueReviewWords.length === 0) return;

  // 自动加入 R1 到期词
  r1DueWords.forEach(word => AppState.selectedWords.add(word.text));

  const WORD_LIMIT = 20;
  const selectedCount = AppState.selectedWords.size;
  const totalCount = selectedCount + r1DueWords.length;

  // 更新词数提示
  const hintEl = document.getElementById('limit-hint');
  if (hintEl) {
    hintEl.textContent = `已选 ${selectedCount} 词 / R1 到期 ${r1DueWords.length} 词 / 共 ${totalCount}/${WORD_LIMIT}`;
  }

  // 渲染到期复习词区块
  const container = document.getElementById('due-review-container');
  if (!container) return;

  let html = '';

  if (r1DueWords.length > 0) {
    html += `
      <div class="due-review-section">
        <h3 class="section-title review-r1">🔴 到期复习-R1（必听写）</h3>
        <p class="limit-hint">${r1DueWords.length} 个词已到期，自动加入听写清单</p>
        <div class="word-list review-list">
          ${r1DueWords.map(word => `
            <label class="word-item disabled-item" data-word="${word.text}">
              <input type="checkbox" class="word-checkbox" checked disabled>
              <span class="word-text">${word.text}<span class="review-tag review-tag-r1">R1</span></span>
              ${!isChinese ? `<span class="word-extra"><span class="word-phonetic">${word.phonetic ? '/' + word.phonetic + '/' : ''}</span>${word.meaning ? `<span class="word-meaning">${word.meaning}</span>` : ''}</span>` : ''}
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (r2PlusDueWords.length > 0) {
    html += `
      <div class="due-review-section">
        <h3 class="section-title review">🔄 到期复习-R2+（建议复习）</h3>
        <div class="word-list review-list">
          ${r2PlusDueWords.map(word => {
            const isSelected = AppState.selectedWords.has(word.text);
            return `
              <label class="word-item" data-word="${word.text}">
                <input type="checkbox" class="word-checkbox"
                  onchange="toggleWordSelection('${word.text}')"
                  ${isSelected ? 'checked' : ''}>
                <span class="word-text">${word.text}<span class="review-tag round-${word.round}">R${word.round}</span></span>
                ${!isChinese ? `<span class="word-extra"><span class="word-phonetic">${word.phonetic ? '/' + word.phonetic + '/' : ''}</span>${word.meaning ? `<span class="word-meaning">${word.meaning}</span>` : ''}</span>` : ''}
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
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
 * 全选当前课/单元的新词（R0）
 */
function selectAllWords() {
  const subject = AppState.currentSubject;
  const lessonId = AppState.currentLesson;
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];

  if (data && data.words) {
    // 只全选新词（R0），不选复习词
    data.words.forEach(word => {
      if (word.round === 0) {
        AppState.selectedWords.add(word.text);
      }
    });

    // 更新 UI（只更新新词区块的 checkbox）
    document.querySelectorAll('.word-list:not(.review-list) .word-checkbox').forEach(cb => {
      const wordItem = cb.closest('.word-item');
      const wordText = wordItem.dataset.word;
      const wordData = data.words.find(w => w.text === wordText);
      if (wordData && wordData.round === 0) {
        cb.checked = true;
      }
    });
  }
}

/**
 * 生成听写清单（带自动到期复习词）
 */
async function generateDictationList() {
  const subject = AppState.currentSubject;
  const lessonId = AppState.currentLesson;
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];
  const isChinese = subject === 'chinese';

  // 1. 收集手动勾选的词
  const manualSelected = [];
  data.words.forEach(word => {
    if (AppState.selectedWords.has(word.text)) {
      manualSelected.push({
        ...word,
        subject: subject,
        lessonId: lessonId,
        lessonName: isChinese ? data.lessonName : data.unitName,
        isManual: true
      });
    }
  });

  // 如果没有任何勾选，提示用户
  if (manualSelected.length === 0) {
    // 但仍检查是否有到期复习词
    const dueWords = await getAllDueReviewWords(subject);
    if (dueWords.length === 0) {
      alert('请先勾选词语');
      return;
    }
  }

  // 2. 获取所有到期复习词（跨课/单元）
  const allDueWords = await getAllDueReviewWords(subject);

  // 3. 去重：到期词已被手动勾选的不重复
  const manualTexts = new Set(manualSelected.map(w => w.text));
  const autoDueWords = allDueWords.filter(w => !manualTexts.has(w.text));

  // 4. 分类
  const r1DueWords = autoDueWords.filter(w => w.round === 1);      // R1 到期（最高优先级）
  const r2PlusDueWords = autoDueWords.filter(w => w.round >= 2);   // R2-R5 到期
  const manualR0Words = manualSelected.filter(w => w.round === 0); // 手动勾选的 R0 新词
  const manualReviewWords = manualSelected.filter(w => w.round >= 1); // 手动勾选的复习词

  // 5. 排序逻辑
  const WORD_LIMIT = 20;

  // R1 必听写，可突破限制
  const finalR1 = r1DueWords;

  // 计算剩余名额
  const remainingSlots = Math.max(0, WORD_LIMIT - finalR1.length);

  // 手动勾选的 R0 新词（纳入剩余名额）
  const finalR0 = manualR0Words.slice(0, remainingSlots);
  const postponedR0 = manualR0Words.slice(remainingSlots);

  // 再次计算剩余名额
  const slotsAfterR0 = Math.max(0, remainingSlots - finalR0.length);

  // 手动勾选的复习词优先纳入
  const finalManualReview = manualReviewWords.slice(0, slotsAfterR0);
  const postponedManualReview = manualReviewWords.slice(slotsAfterR0);

  // 再次计算剩余名额
  const slotsAfterManualReview = Math.max(0, slotsAfterR0 - finalManualReview.length);

  // R2-R5 在剩余名额内按轮次排序纳入
  const finalR2Plus = r2PlusDueWords.slice(0, slotsAfterManualReview);
  const postponedR2Plus = r2PlusDueWords.slice(slotsAfterManualReview);

  // 6. 合并延期词语
  const postponedWords = [...postponedR0, ...postponedManualReview, ...postponedR2Plus];

  // 7. 构建清单 HTML
  // 英语词展示音标+中文意思的辅助函数
  const formatWordExtra = (w) => {
    if (w.subject === 'english') {
      let extra = '';
      if (w.phonetic) extra += `<span class="word-phonetic">/${w.phonetic}/</span>`;
      if (w.meaning) extra += `<span class="word-meaning">${w.meaning}</span>`;
      return extra ? `<span class="word-extra">${extra}</span>` : '';
    }
    return '';
  };

  let resultHtml = '<div class="dictation-list dictation-two-column">';

  // 📝 新课词语（R0 手动勾选）
  if (finalR0.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title new">📝 新课词语 (${finalR0.length})</h3>
        <div class="dictation-words">
          ${finalR0.map(w => `<span class="dictation-word new" data-meaning="${encodeURIComponent(w.meaning || '')}">${w.text}${formatWordExtra(w)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  // 🔴 到期复习-R1（自动加入）
  if (finalR1.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title review-r1">🔴 到期复习-R1 (${finalR1.length})</h3>
        <div class="dictation-words">
          ${finalR1.map(w => `<span class="dictation-word review-r1" data-meaning="${encodeURIComponent(w.meaning || '')}">${w.text}${formatWordExtra(w)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  // 🔄 到期复习-R2+（分批纳入）
  const allReviewWords = [...finalManualReview, ...finalR2Plus];
  if (allReviewWords.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title review">🔄 到期复习-R2+ (${allReviewWords.length})</h3>
        <div class="dictation-words">
          ${allReviewWords.map(w => {
            const roundTag = w.round >= 5 ? '✅' : `R${w.round}`;
            return `<span class="dictation-word review" data-meaning="${encodeURIComponent(w.meaning || '')}">${w.text}${formatWordExtra(w)} <small>${roundTag}</small></span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  resultHtml += '</div>';

  // ⏸️ 延期词语提示
  if (postponedWords.length > 0) {
    resultHtml += `
      <div class="postponed-notice">
        ⏸️ 延期词语: ${postponedWords.length} 个（明天再复习）
      </div>
    `;
  }

  // 统计信息
  const totalIncluded = finalR0.length + finalR1.length + allReviewWords.length;
  resultHtml += `<p class="dictation-total">共 ${totalIncluded} 个词（${postponedWords.length} 个延期到明天）</p>`;

  // 追加听写完毕按钮
  resultHtml += `
    <div class="action-bar grading-action-bar">
      <button class="btn btn-primary btn-lg" id="btn-start-grading" onclick="startDictationGrading()">
        📝 听写完毕
      </button>
    </div>
  `;

  document.getElementById('dictation-result').innerHTML = resultHtml;

  // 保存当前清单数据供批改使用
  AppState.currentDictationList = [];
  finalR0.forEach(w => AppState.currentDictationList.push({ text: w.text, lessonId: lessonId, round: w.round || 0, subject: subject, meaning: w.meaning || '' }));
  finalR1.forEach(w => AppState.currentDictationList.push({ text: w.text, lessonId: w.lessonId || lessonId, round: w.round || 1, subject: subject, meaning: w.meaning || '' }));
  allReviewWords.forEach(w => AppState.currentDictationList.push({ text: w.text, lessonId: w.lessonId || lessonId, round: w.round || 1, subject: subject, meaning: w.meaning || '' }));
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
// 批改反馈闭环
// ============================================

/**
 * 进入批改勾选模式
 */
function startDictationGrading() {
  // 防重复点击锁
  if (AppState.isGrading) return;
  AppState.isGrading = true;

  const resultEl = document.getElementById('dictation-result');
  if (!resultEl) { AppState.isGrading = false; return; }

  // 保存原始 HTML
  AppState.originalDictationHtml = resultEl.innerHTML;

  // 把 dictation-word spans 替换为 checkbox labels
  let html = resultEl.innerHTML;

  // 移除听写完毕按钮（innerHTML 替换会丢失 DOM disabled 状态）
  const startBtn = document.getElementById('btn-start-grading');
  if (startBtn) startBtn.remove();

  // 先插入顶部提示区
  const gradingNotice = `
    <div class="grading-notice">
      <p>📌 请在清单中勾选写错的字词（不勾选表示写对）</p>
      <div class="grading-action-bar">
        <button class="btn btn-success" id="btn-finish-grading" onclick="confirmFinishGrading()">✅ 错字词勾选完毕</button>
        <button class="btn btn-secondary" id="btn-cancel-grading" onclick="cancelDictationGrading()">取消</button>
      </div>
    </div>
  `;

  // 把每个 dictation-word 替换为可勾选的 label（保留音标+中文）
  html = html.replace(
    /<span class="dictation-word ([^"]*)" data-meaning="([^"]*)">([^<]+)(<span class="word-extra">[\s\S]*?<\/span>)?<\/span>/g,
    function(match, className, meaningEncoded, wordText, extraHtml) {
      const meaning = decodeURIComponent(meaningEncoded);
      const item = AppState.currentDictationList.find(w => w.text === wordText);
      const lessonId = item ? item.lessonId : '';
      const round = item ? item.round : 0;
      // 从 word-extra 中提取音标
      const phoneticMatch = extraHtml ? extraHtml.match(/\/([^/]+)\//) : null;
      const phoneticHtml = phoneticMatch ? `<span class="grading-phonetic">/${phoneticMatch[1]}/</span>` : '';
      const meaningHtml = meaning ? `<span class="grading-meaning">${meaning}</span>` : '';
      return `<label class="grading-word-item ${className}"><input type="checkbox" class="wrong-cb" data-word="${wordText}" data-lesson="${lessonId}" data-round="${round}"><span class="word-text">${wordText}</span>${phoneticHtml}${meaningHtml}</label>`;
    }
  );

  // 隐藏听写完毕按钮（已在上面被替换为禁用状态）

  // 插入提示区 + 替换内容
  resultEl.innerHTML = gradingNotice + html;
}

/**
 * 退出批改勾选模式，恢复原清单
 */
function cancelDictationGrading() {
  AppState.isGrading = false;
  const resultEl = document.getElementById('dictation-result');
  if (!resultEl || !AppState.originalDictationHtml) return;
  resultEl.innerHTML = AppState.originalDictationHtml;
  // 恢复听写完毕按钮（重新渲染 action-bar）
  const actionBar = resultEl.querySelector('.action-bar');
  if (!actionBar) {
    const bar = document.createElement('div');
    bar.className = 'action-bar grading-action-bar';
    bar.innerHTML = '<button class="btn btn-primary btn-lg" id="btn-start-grading" onclick="startDictationGrading()">📝 听写完毕</button>';
    resultEl.appendChild(bar);
  }
}

/**
 * 二次确认后完成批改
 */
function confirmFinishGrading() {
  const wrongCount = document.querySelectorAll('.wrong-cb:checked').length;
  const totalCount = document.querySelectorAll('.wrong-cb').length;
  const correctCount = totalCount - wrongCount;
  const msg = `共 ${totalCount} 个词，确认 ${wrongCount} 个写错、${correctCount} 个写对？\n确认后将更新复习轮次。`;
  if (!confirm(msg)) return;
  finishDictationGrading();
}

/**
 * 完成批改，更新轮次并保存
 */
function finishDictationGrading() {
  // 一次性锁定：禁用批改模式按钮
  const finishBtn = document.getElementById('btn-finish-grading');
  const cancelBtn = document.getElementById('btn-cancel-grading');
  if (finishBtn) {
    finishBtn.disabled = true;
    finishBtn.textContent = '⏳ 保存中…';
    finishBtn.style.opacity = '0.5';
  }
  if (cancelBtn) cancelBtn.disabled = true;

  // 收集被勾选的错词
  const wrongWords = new Set();
  document.querySelectorAll('.wrong-cb:checked').forEach(cb => {
    wrongWords.add(cb.dataset.word);
  });

  const wordUpdates = [];
  let correctCount = 0;
  let wrongCount = 0;

  AppState.currentDictationList.forEach(item => {
    const isWrong = wrongWords.has(item.text);
    const newRound = isWrong ? 1 : Math.min((item.round || 0) + 1, 6);
    const nextReview = calculateNextReview(newRound);

    if (isWrong) {
      wrongCount++;
    } else {
      correctCount++;
    }

    // 获取已有错词次数
    const existing = findWordProgress(item.subject, item.lessonId, item.text);
    const existingWrongCount = existing ? (existing.wrongCount || 0) : 0;

    wordUpdates.push({
      text: item.text,
      lessonId: item.lessonId,
      subject: item.subject,
      round: newRound,
      nextReview: nextReview,
      wrongCount: isWrong ? existingWrongCount + 1 : existingWrongCount
    });
  });

  // 保存进度
  saveProgress(wordUpdates);

  // 显示结果摘要
  const earliestNext = wordUpdates
    .filter(w => w.nextReview)
    .sort((a, b) => a.nextReview.localeCompare(b.nextReview))[0];

  const earliestDate = earliestNext ? formatDate(earliestNext.nextReview) : '-';

  const summaryHtml = `
    <div class="result-summary">
      <h3>✅ 听写完成！</h3>
      <div class="stats">
        <span class="stat correct">✅ ${correctCount} 正确</span>
        <span class="stat wrong">❌ ${wrongCount} 错误</span>
      </div>
      <p>📅 下次复习：<strong>${earliestDate}</strong></p>
      <div class="action-bar" style="margin-top:16px;">
        <button class="btn btn-primary" onclick="goBackToLessons()">返回选课</button>
      </div>
    </div>
  `;

  const resultEl = document.getElementById('dictation-result');
  if (resultEl) resultEl.innerHTML = summaryHtml;
}

/**
 * 保存进度到 localStorage
 */
function saveProgress(wordUpdates) {
  const progress = JSON.parse(localStorage.getItem('hengyi-dictation-progress') || '{}');

  wordUpdates.forEach(update => {
    const key = `${update.subject}/${update.lessonId}/${update.text}`;
    const existing = progress[key] || {};
    progress[key] = {
      text: update.text,
      lessonId: update.lessonId,
      subject: update.subject,
      round: update.round,
      nextReview: update.nextReview,
      wrongCount: update.wrongCount || existing.wrongCount || 0,
      updatedAt: new Date().toISOString()
    };
  });

  localStorage.setItem('hengyi-dictation-progress', JSON.stringify(progress));
  console.log('进度已保存:', wordUpdates.length, '个词');
}

/**
 * 查找某个词的进度记录
 */
function findWordProgress(subject, lessonId, text) {
  const progress = JSON.parse(localStorage.getItem('hengyi-dictation-progress') || '{}');
  const key = `${subject}/${lessonId}/${text}`;
  return progress[key] || null;
}

/**
 * 从 localStorage 合并进度到词数据
 */
function mergeProgressToWords(data, subject, lessonId) {
  if (!data || !data.words) return data;
  const progress = JSON.parse(localStorage.getItem('hengyi-dictation-progress') || '{}');
  const lessonKey = `${subject}/${lessonId}`;

  data.words.forEach(word => {
    const key = `${lessonKey}/${word.text}`;
    if (progress[key]) {
      word.round = progress[key].round !== undefined ? progress[key].round : word.round;
      word.nextReview = progress[key].nextReview || word.nextReview;
      word.wrongCount = progress[key].wrongCount || word.wrongCount || 0;
    }
  });

  return data;
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
    const data = await loadWordData(subject, item.id, true);
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
        data = mergeProgressToWords(data, 'chinese', lesson.id);
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
        data = mergeProgressToWords(data, 'english', unit.id);
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
      <button class="filter-btn all ${filter === 'all' ? 'active' : ''}" onclick="AppState.reviewWordsPage=1;renderProgressPage('all')">全部</button>
      <button class="filter-btn chinese ${filter === 'chinese' ? 'active' : ''}" onclick="AppState.reviewWordsPage=1;renderProgressPage('chinese')">语文</button>
      <button class="filter-btn english ${filter === 'english' ? 'active' : ''}" onclick="AppState.reviewWordsPage=1;renderProgressPage('english')">英语</button>
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

  // 复习中词（可手动调整轮次）
  const reviewWords = allWords
    .filter(w => w.round >= 1 && w.round <= 5)
    .sort((a, b) => a.round - b.round);

  // 分页配置
  const REVIEW_PAGE_SIZE = 20;
  const totalReviewPages = Math.ceil(reviewWords.length / REVIEW_PAGE_SIZE);
  const reviewPage = Math.min(AppState.reviewWordsPage, totalReviewPages) || 1;
  const startIdx = (reviewPage - 1) * REVIEW_PAGE_SIZE;
  const endIdx = startIdx + REVIEW_PAGE_SIZE;
  const pagedReviewWords = reviewWords.slice(startIdx, endIdx);

  const reviewHtml = reviewWords.length > 0
    ? `
      <div class="manual-section">
        <h3 class="manual-title">📝 复习中的词 (${reviewWords.length})</h3>
        <div class="manual-word-list">
          ${pagedReviewWords.map(word => {
            const name = word.lessonName || word.unitName || '';
            const phonetic = word.phonetic ? '/' + word.phonetic + '/ ' : '';
            return `<div class="manual-word-item">
              <span class="manual-word-text">${word.text} ${phonetic}${word.meaning || ''}</span>
              <div class="manual-word-info">
                <span class="manual-word-lesson">${name}</span>
                <span class="error-round">R${word.round}</span>
                <span class="manual-btn-group">
                  <select class="manual-round-select" id="round-select-${word.text.replace(/'/g, "\\'")}" style="font-size:12px;padding:2px 4px;border:1px solid #ddd;border-radius:4px;">
                    <option value="0">R0</option>
                    <option value="1" ${word.round===1?'selected':''}>R1</option>
                    <option value="2" ${word.round===2?'selected':''}>R2</option>
                    <option value="3" ${word.round===3?'selected':''}>R3</option>
                    <option value="4" ${word.round===4?'selected':''}>R4</option>
                    <option value="5" ${word.round===5?'selected':''}>R5</option>
                    <option value="6">已掌握</option>
                  </select>
                  <button class="manual-btn btn-r1" onclick="manualSetRound('${word.subject}','${word.lessonId}','${word.text}',document.getElementById('round-select-${word.text.replace(/'/g, "\\'")}').value)">确认</button>
                  <button class="manual-btn btn-reset" onclick="manualResetWord('${word.subject}','${word.lessonId}','${word.text}')">重置</button>
                </span>
              </div>
            </div>`;
          }).join('')}
        </div>
        ${totalReviewPages > 1 ? `
          <div class="pagination" style="margin-top: 16px; display: flex; justify-content: center; align-items: center; gap: 12px;">
            <button class="btn btn-secondary" style="padding: 8px 16px; font-size: 14px;" ${reviewPage <= 1 ? 'disabled' : ''} onclick="changeReviewPage(${reviewPage - 1}, '${filter}')">上一页</button>
            <span style="color: #666; font-size: 14px;">第 ${reviewPage} / ${totalReviewPages} 页</span>
            <button class="btn btn-secondary" style="padding: 8px 16px; font-size: 14px;" ${reviewPage >= totalReviewPages ? 'disabled' : ''} onclick="changeReviewPage(${reviewPage + 1}, '${filter}')">下一页</button>
          </div>
        ` : ''}
      </div>
    `
    : '';

  // 手动添加错词表单
  const lessonOptions = [];
  if (filter === 'all' || filter === 'chinese') {
    chineseLessons.forEach(l => lessonOptions.push(`<option value="chinese|${l.id}">${l.name}</option>`));
  }
  if (filter === 'all' || filter === 'english') {
    englishUnits.forEach(u => lessonOptions.push(`<option value="english|${u.id}">${u.name}</option>`));
  }

  const addWordHtml = `
    <div class="manual-section">
      <h3 class="manual-title">➕ 手动添加词 / 调整轮次</h3>
      <div class="add-word-form">
        <input type="text" id="manual-word-input" placeholder="输入词语" class="manual-input">
        <select id="manual-lesson-select" class="manual-input">
          <option value="">选择课/单元</option>
          ${lessonOptions.join('')}
        </select>
        <select id="manual-round-select" class="manual-input">
          <option value="0">R0 新词</option>
          <option value="1" selected>R1（1天后复习）</option>
          <option value="2">R2（3天后复习）</option>
          <option value="3">R3（7天后复习）</option>
          <option value="4">R4（16天后复习）</option>
          <option value="5">R5（35天后复习）</option>
          <option value="6">已掌握</option>
        </select>
        <div class="add-word-buttons">
          <button class="btn btn-primary" style="flex:1;font-size:14px;padding:10px;" onclick="manualAddWordWithRound()">添加</button>
        </div>
      </div>
    </div>
  `;

  // 高频错词排行（带手动调整按钮）
  const errorHtml = errorWords.length > 0
    ? `
      <div class="error-ranking">
        <h3 class="error-title">⚠️ 高频错词排行 (前10)</h3>
        <div class="error-list">
          ${errorWords.map(word => {
            const phonetic = word.phonetic ? '/' + word.phonetic + '/ ' : '';
            return `<div class="error-item">
              <span class="error-word">${word.text} ${phonetic}${word.meaning || ''}</span>
              <div class="error-info">
                <span class="error-count">❌ ${word.wrongCount}次</span>
                <span class="error-round">R${word.round}</span>
                <button class="manual-btn btn-r1" onclick="manualSetRound('${word.subject}','${word.lessonId || word.unitId}','${word.text}',1)">设为R1</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `
    : `
      <div class="error-ranking">
        <h3 class="error-title">⚠️ 高频错词排行</h3>
        <div class="empty-state">
          <p class="empty-text">暂无错词记录</p>
          <p class="empty-hint">使用下方表单手动添加错词</p>
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
    ${addWordHtml}
    ${reviewHtml}
    ${errorHtml}
    ${progressHtml}
  `);
}

// ============================================
// 进度总览手动管理
// ============================================

/**
 * 手动设置词语轮次（用于进度总览页面）
 */
/**
 * 静默更新词语进度（不弹窗、不重绘）
 * @param {number} [wrongCountIncrement=0] - 错词次数增量
 */
function updateWordProgress(subject, lessonId, text, round, wrongCountIncrement = 0) {
  const nextReview = round >= 6 ? null : calculateNextReview(round);
  const key = `${subject}/${lessonId}/${text}`;
  const progress = JSON.parse(localStorage.getItem('hengyi-dictation-progress') || '{}');
  const existing = progress[key] || {};
  progress[key] = {
    text: text,
    lessonId: lessonId,
    subject: subject,
    round: round,
    nextReview: nextReview,
    wrongCount: (existing.wrongCount || 0) + wrongCountIncrement,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem('hengyi-dictation-progress', JSON.stringify(progress));
  return key;
}

/**
 * 手动设置词语进度并弹窗反馈 + 刷新页面（用户入口）
 */
function manualSetRound(subject, lessonId, text, round) {
  // 确保 round 是数字类型（从 select value 获取的是字符串）
  round = parseInt(round, 10);
  updateWordProgress(subject, lessonId, text, round);
  const roundName = round >= 6 ? '已掌握' : round === 0 ? '新词' : `R${round} 复习中`;
  alert(`✅ ${text} 已设为${roundName}`);
  const activeFilter = document.querySelector('.filter-btn.active');
  const filter = activeFilter ? activeFilter.textContent.trim().toLowerCase() : 'all';
  renderProgressPage(filter === '语文' ? 'chinese' : filter === '英语' ? 'english' : 'all');
}

/**
 * 重置词语为新词（R0）
 */
function manualResetWord(subject, lessonId, text) {
  manualSetRound(subject, lessonId, text, 0);
}

/**
 * 切换复习中的词分页
 */
function changeReviewPage(page, filter) {
  AppState.reviewWordsPage = page;
  renderProgressPage(filter);
}

/**
 * 手动添加错词并设为R1
 */
function manualAddWordR1() {
  const wordInput = document.getElementById('manual-word-input');
  const lessonSelect = document.getElementById('manual-lesson-select');
  if (!wordInput.value.trim()) { alert('请输入词语'); return; }
  if (!lessonSelect.value) { alert('请选择课/单元'); return; }

  const [subject, lessonId] = lessonSelect.value.split('|');
  const text = wordInput.value.trim();

  // 查找词库中是否存在该词
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];
  if (!data || !data.words || !data.words.find(w => w.text === text)) {
    if (!confirm(`词库中未找到 "${text}"，仍要添加吗？`)) return;
  }

  // 一次性写入：设为R1 + 错词次数+1，只写一次 localStorage
  updateWordProgress(subject, lessonId, text, 1, 1);
  wordInput.value = ''; // 在重绘前清空
  alert(`✅ ${text} 已设为 R1 复习中（错词次数+1）`);
  // 刷新当前页面
  const activeFilter = document.querySelector('.filter-btn.active');
  const filter = activeFilter ? activeFilter.textContent.trim().toLowerCase() : 'all';
  renderProgressPage(filter === '语文' ? 'chinese' : filter === '英语' ? 'english' : 'all');
}

/**
 * 手动设词语为已掌握
 */
function manualAddWordMastered() {
  const wordInput = document.getElementById('manual-word-input');
  const lessonSelect = document.getElementById('manual-lesson-select');
  if (!wordInput.value.trim()) { alert('请输入词语'); return; }
  if (!lessonSelect.value) { alert('请选择课/单元'); return; }

  const [subject, lessonId] = lessonSelect.value.split('|');
  const text = wordInput.value.trim();
  wordInput.value = ''; // 在重绘前清空
  updateWordProgress(subject, lessonId, text, 6);
  alert(`✅ ${text} 已设为已掌握`);
  // 刷新当前页面
  const activeFilter = document.querySelector('.filter-btn.active');
  const filter = activeFilter ? activeFilter.textContent.trim().toLowerCase() : 'all';
  renderProgressPage(filter === '语文' ? 'chinese' : filter === '英语' ? 'english' : 'all');
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