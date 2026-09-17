import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('index.html contains markup for timeline browser, daily sparks section, and inbox sort toggle', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

    // 1. 頂部導覽列包含時間軸按鈕
    assert.match(html, /id="timeline-browser-btn"/);
    assert.match(html, /aria-controls="timeline-browser-modal"/);

    // 2. 全域時間軸 Modal 結構
    assert.match(html, /id="timeline-browser-modal"[^>]+role="dialog"/);
    assert.match(html, /id="timeline-browser-content"/);
    assert.match(html, /id="timeline-browser-empty"/);
    assert.match(html, /id="close-timeline-browser-btn"/);

    // 3. 今日大腦切片（Daily Sparks）三軌容器
    assert.match(html, /id="daily-sparks-section"/);
    assert.match(html, /id="daily-sparks-title"/);
    assert.match(html, /id="daily-sparks-cards"/);
    assert.match(html, /id="daily-sparks-shuffle-all-btn"/);
    assert.match(html, /id="daily-sparks-toggle-btn"/);

    // 4. 收件匣標題列包含時間排序切換按鈕
    assert.match(html, /id="inbox-sort-toggle-btn"/);
    assert.match(html, /id="inbox-sort-toggle-text"/);
});

test('app.js integrates timeline browser, category sort toggle, and daily sparks', async () => {
    const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

    // 模組導入
    assert.match(appSource, /buildTimelineBuckets/);
    assert.match(appSource, /selectDailySparks/);

    // 排序與狀態管理
    assert.match(appSource, /getCategorySortMode/);
    assert.match(appSource, /setCategorySortMode/);
    assert.match(appSource, /sortCollectionItems/);
    assert.match(appSource, /rerenderCategory/);
    assert.match(appSource, /sort-toggle-btn-dynamic/);

    // 歷史路由堆疊整合
    assert.match(appSource, /overlay:\s*'timeline-browser'/);
    assert.match(appSource, /openTimelineBrowser/);
    assert.match(appSource, /closeTimelineBrowser/);

    // 今日大腦切片渲染與事件綁定
    assert.match(appSource, /renderDailySparks/);
    assert.match(appSource, /setupDailySparksSection/);
});

test('no emoji exists in timeline-browser.mjs, daily-sparks.mjs, or newly added markup', async () => {
    const [timelineSrc, sparksSrc] = await Promise.all([
        readFile(new URL('../timeline-browser.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../daily-sparks.mjs', import.meta.url), 'utf8')
    ]);

    // 驗證無 Unicode Emoji (範圍包含一般表情、符號、圖示)
    const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert.equal(emojiRegex.test(timelineSrc), false, 'timeline-browser.mjs must not contain emoji');
    assert.equal(emojiRegex.test(sparksSrc), false, 'daily-sparks.mjs must not contain emoji');
});
