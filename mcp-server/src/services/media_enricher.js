import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { getDb, getUserBasePath } from './firestore.js';

const execFileAsync = promisify(execFile);

export async function enrichMediaCard({ itemId, category, forceRefresh = false }) {
  if (!itemId) throw new Error('itemId is required.');

  const db = getDb();
  const userDoc = db.doc(getUserBasePath());

  // 若未指定 category，在全庫中搜尋卡片所在 collection
  let targetCol = category;
  let cardData = null;
  let cardDocRef = null;

  if (targetCol) {
    cardDocRef = userDoc.collection(targetCol).doc(itemId);
    const snap = await cardDocRef.get();
    if (snap.exists) cardData = snap.data();
  } else {
    const subCols = await userDoc.listCollections();
    for (const col of subCols) {
      if (['settings', 'researchJobs', 'researchUsage', 'memberships', 'categories', 'inbox'].includes(col.id)) continue;
      const snap = await col.doc(itemId).get();
      if (snap.exists) {
        targetCol = col.id;
        cardData = snap.data();
        cardDocRef = col.doc(itemId);
        break;
      }
    }
  }

  if (!cardData || !cardDocRef) {
    throw new Error(`Card with ID "${itemId}" not found in database.`);
  }

  // 檢查是否已有深度筆記
  const existingNoteText = cardData.note?.blocks ? cardData.note.blocks.map(b => b.data?.text || '').join(' ') : '';
  if (!forceRefresh && cardData.hasNote && existingNoteText.length > 100) {
    return {
      success: true,
      status: 'already_enriched',
      message: 'Card already has comprehensive notes. Use forceRefresh=true to override.',
      title: cardData.note.blocks[0]?.data?.text || cardData.text,
      category: targetCol,
      itemId
    };
  }

  // 提取 URL
  const text = cardData.text || '';
  const urls = text.match(/https?:\/\/[^\s]+/g) || [];
  if (urls.length === 0) {
    throw new Error('No URL found in card text to enrich.');
  }
  const targetUrl = urls[0];

  const tmpDir = `/tmp/enrich_${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. 判斷是否為 Instagram Reel / 影片
    if (targetUrl.includes('instagram.com/reel/') || targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
      const { stdout } = await execFileAsync(
        '/home/cdc/.local/bin/yt-dlp',
        ['--dump-json', '--skip-download', targetUrl],
        { timeout: 15000 }
      );
      const meta = JSON.parse(stdout);
      const title = meta.title || meta.fulltitle || '影音知識精華';
      const desc = meta.description || '';

      const blocks = [
        { type: 'header', data: { text: title, level: 3 } },
        { type: 'paragraph', data: { text: `<b>TL;DR：</b>${desc.substring(0, 150) || '自動多模態分析影音內容。'}` } }
      ];

      if (desc.length > 150) {
        blocks.push({ type: 'paragraph', data: { text: desc.replace(/\n/g, '<br>') } });
      }

      await cardDocRef.update({
        hasNote: true,
        note: { time: Date.now(), blocks, version: '2.30.7' },
        researchSearchText: `${title} ${desc}`.substring(0, 500),
        updatedAt: new Date()
      });

      return {
        success: true,
        type: 'video',
        title,
        category: targetCol,
        itemId
      };
    }

    // 2. Instagram Carousel 多圖貼文
    if (targetUrl.includes('instagram.com/p/') || targetUrl.includes('img_index')) {
      const { stdout } = await execFileAsync(
        '/home/cdc/.local/bin/yt-dlp',
        ['--ignore-no-formats-error', '-j', targetUrl],
        { timeout: 20000 }
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      let desc = '';
      let imgCount = 0;
      for (const l of lines) {
        try {
          const j = JSON.parse(l);
          if (j.description && !desc) desc = j.description;
          if (j.thumbnail) imgCount++;
        } catch(e) {}
      }

      const title = desc.split('\n')[0]?.substring(0, 40) || '多圖輪播知識精華';
      const blocks = [
        { type: 'header', data: { text: title, level: 3 } },
        { type: 'paragraph', data: { text: `<b>TL;DR：</b>收錄 ${imgCount} 張輪播圖解與核心說明。` } },
        { type: 'paragraph', data: { text: desc.replace(/\n/g, '<br>') } }
      ];

      await cardDocRef.update({
        hasNote: true,
        note: { time: Date.now(), blocks, version: '2.30.7' },
        researchSearchText: `${title} ${desc}`.substring(0, 500),
        updatedAt: new Date()
      });

      return {
        success: true,
        type: 'carousel',
        title,
        imgCount,
        category: targetCol,
        itemId
      };
    }

    throw new Error('Unsupported media URL type.');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
  }
}
