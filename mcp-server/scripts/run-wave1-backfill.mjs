import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
dotenv.config();
import { initFirestore, getDb } from '../src/services/firestore.js';

const execFileAsync = promisify(execFile);

function decodeEntities(encodedString) {
  if (!encodedString) return '';
  return encodedString
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\x27');
}

async function fetchMetadata(url) {
  // 1. Instagram via yt-dlp
  if (url.includes('instagram.com/reel/') || url.includes('instagram.com/p/')) {
    try {
      const { stdout } = await execFileAsync(
        '/home/cdc/.local/bin/yt-dlp',
        ['--dump-json', '--skip-download', url],
        { timeout: 12000 }
      );
      const j = JSON.parse(stdout);
      return {
        source: 'instagram',
        title: j.title || j.fulltitle || 'Instagram 貼文',
        description: j.description || '',
        uploader: j.uploader || ''
      };
    } catch (e) {
      return { source: 'instagram:fallback', description: '' };
    }
  }

  // 2. YouTube via oEmbed
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const j = await resp.json();
        return {
          source: 'youtube',
          title: j.title || '',
          description: j.title ? `YouTube 影片：${j.title}（作者：${j.author_name || '未知'}）` : ''
        };
      }
    } catch (e) {}
  }

  // 3. HTTP Open Graph / Title
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(6000)
    });
    const html = await resp.text();
    const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
    const ogDesc = (html.match(/<meta\s+property=["\x27]og:description["\x27]\s+content=["\x27]([^"\x27]+)["\x27]/i) || [])[1] || '';
    return {
      source: 'web:og',
      title: decodeEntities(title.trim()),
      description: decodeEntities(ogDesc.trim())
    };
  } catch (e) {
    return { source: 'web:fallback', description: '' };
  }
}

async function run() {
  initFirestore();
  const db = getDb();
  const userDoc = db.doc('artifacts/my-personal-ai-brain/users/lfZ6u2ndoRPpDKwVY7dnVaF6oGo2');
  const subCols = await userDoc.listCollections();

  const candidates = [];
  for (const c of subCols) {
    if (['settings', 'researchJobs', 'researchUsage', 'memberships', 'categories', 'inbox'].includes(c.id)) continue;
    const snap = await c.get();
    for (const d of snap.docs) {
      const data = d.data();
      const text = data.text || '';
      const urls = text.match(/https?:\/\/[^\s]+/g) || [];
      if (urls.length === 1 && (!data.hasNote || !data.researchSearchText)) {
        candidates.push({
          id: d.id,
          col: c.id,
          url: urls[0],
          text: data.text
        });
      }
    }
  }

  console.log(`Starting Wave 1 Full Backfill on ${candidates.length} candidate cards...`);
  const startTime = Date.now();

  const stats = {
    total: candidates.length,
    processed: 0,
    threads: 0,
    instagram: 0,
    youtube: 0,
    web: 0,
    fallback: 0
  };

  const CONCURRENCY = 5;
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < candidates.length) {
      const idx = currentIndex++;
      const item = candidates[idx];

      try {
        const meta = await fetchMetadata(item.url);
        const rawContent = (meta.description || meta.title || '').trim();
        const userHint = item.text.replace(item.url, '').trim();

        if (meta.source.startsWith('instagram')) stats.instagram++;
        else if (meta.source.startsWith('youtube')) stats.youtube++;
        else if (item.url.includes('threads.com')) stats.threads++;
        else stats.web++;

        if (!rawContent) stats.fallback++;

        const tldr = rawContent ? rawContent.slice(0, 160).replace(/\n+/g, ' ') : (userHint || '社群來源內容');
        const notes = rawContent
          ? `由 Tier 1 / yt-dlp 自動解析來源：${rawContent.slice(0, 600).replace(/\n+/g, ' ')}`
          : `社群網頁正文受防護，根據卡片短評「${userHint}」建立研讀索引。`;

        const noteDoc = {
          time: Date.now(),
          blocks: [
            {
              type: 'paragraph',
              data: { text: `<strong>TL;DR：</strong>${tldr}` }
            },
            {
              type: 'paragraph',
              data: { text: `<strong>重點筆記：</strong>${notes}` }
            },
            {
              type: 'paragraph',
              data: { text: `<strong>原始來源：</strong><a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.url}</a>` }
            }
          ],
          version: '2.28.2'
        };

        const targetRef = userDoc.collection(item.col).doc(item.id);
        const batch = db.batch();
        batch.update(targetRef, {
          hasNote: true,
          researchSearchText: `${tldr} ${notes}`
        });
        batch.set(targetRef.collection('details').doc('note'), noteDoc);
        await batch.commit();

        stats.processed++;
        if (stats.processed % 25 === 0 || stats.processed === stats.total) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[Progress: ${stats.processed}/${stats.total} (${((stats.processed / stats.total) * 100).toFixed(1)}%)] Elapsed: ${elapsed}s`);
        }
      } catch (err) {
        console.error(`Error processing card ${item.id} (${item.url}):`, err.message);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n================ Wave 1 Backfill Complete ================');
  console.log(`Total Cards Processed: ${stats.processed}/${stats.total}`);
  console.log(`Threads Cards: ${stats.threads}`);
  console.log(`Instagram Cards: ${stats.instagram}`);
  console.log(`YouTube Cards: ${stats.youtube}`);
  console.log(`Web/GitHub Cards: ${stats.web}`);
  console.log(`Fallback (Protected/Empty): ${stats.fallback}`);
  console.log(`Total Execution Time: ${totalTime}s (avg ${(totalTime / stats.processed).toFixed(2)}s/card)`);
  console.log('==========================================================');
}

run().catch(console.error);
