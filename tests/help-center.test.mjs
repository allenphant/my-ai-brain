import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readProductionSources = () => Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

test('help center documents the core workflow, deployment, data boundary, and limitations', async () => {
    const [html] = await readProductionSources();
    assert.match(html, /id="help-center-modal"[^>]+role="dialog"/);
    assert.match(html, /收集 → 研讀 → 整理 → 找回/);
    assert.match(html, /Jina Reader 擷取原文/);
    assert.match(html, /手動審核.*自動通過/s);
    assert.match(html, /https:\/\/allenphant\.github\.io\/my-ai-brain\//);
    assert.match(html, /Firebase Cloud Firestore/);
    assert.match(html, /目前瀏覽器 localStorage/);
    assert.match(html, /影片不會被 Jina 轉錄/);
    assert.match(html, /Key／權限／帳務／模型失效/);
    assert.match(html, /斷網、逾時、5xx/);
});

test('help center is reachable from both navigation surfaces and participates in overlay history', async () => {
    const [html, appSource] = await readProductionSources();
    assert.match(html, /id="help-center-btn"/);
    assert.match(appSource, /function createHelpSidebarLink/);
    assert.match(appSource, /history\.pushState\(\{ overlay: 'help-center'/);
    assert.match(appSource, /targetOverlay === 'help-center'/);
    assert.match(appSource, /modalKeys\(closeHelpCenter\)/);
});

test('research log is reachable, filterable, and participates in overlay history', async () => {
    const [html, appSource] = await readProductionSources();
    assert.match(html, /id="research-log-modal"[^>]+role="dialog"/);
    assert.match(html, /data-research-log-filter="error"/);
    assert.match(appSource, /function createResearchLogSidebarLink/);
    assert.match(appSource, /history\.pushState\(\{ overlay: 'research-log'/);
    assert.match(appSource, /targetOverlay === 'research-log'/);
    assert.match(appSource, /modalKeys\(closeResearchLog\)/);
    assert.match(appSource, /researchBackfillQuotaFailures > backoffSchedule\.length/);
    assert.match(appSource, /pauseAttempts > 3/);
});
