import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as domain from './services/domain.js';
import { readUrlContent } from './services/fetcher.js';

export function createMcpServer() {
  const server = new McpServer({
    name: 'my-personal-ai-brain',
    version: '1.0.0'
  });

  server.tool(
    'list_categories',
    '列出個人 AI 大腦中所有可用的分類清單',
    {},
    async () => {
      const categories = await domain.listCategories();
      return {
        content: [{ type: 'text', text: JSON.stringify(categories, null, 2) }]
      };
    }
  );

  server.tool(
    'get_inbox_items',
    '取得收件匣 (Inbox) 中尚未分類的原始碎片',
    {
      limit: z.number().min(1).max(100).optional().describe('最大回傳筆數 (預設 20)')
    },
    async ({ limit }) => {
      const items = await domain.getInboxItems(limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
      };
    }
  );

  server.tool(
    'get_category_items',
    '取得特定分類下的卡片清單',
    {
      category: z.string().describe('分類 ID (如 todos, learning, ideas, bookmarks)'),
      limit: z.number().min(1).max(100).optional().describe('最大回傳筆數 (預設 20)')
    },
    async ({ category, limit }) => {
      const items = await domain.getCategoryItems(category, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
      };
    }
  );

  server.tool(
    'move_item',
    '將單一卡片從來源分類移至目標分類，自動連帶搬移筆記並更新排序',
    {
      itemId: z.string().describe('卡片 ID'),
      fromCategory: z.string().describe('來源分類 (如 inbox)'),
      toCategory: z.string().describe('目標分類 (如 todos)'),
      aiReasoning: z.string().optional().describe('Agent 的分類理由'),
      tags: z.array(z.string()).optional().describe('標籤陣列 (受控白名單: 開源, AI提示詞, AI工具, AI Agent, Claude Code, 軟體開發, 前端開發, 系統架構, 雲端維運, 資訊安全, 學術研究, 資料分析, 影片與多媒體, 社群與傳播, 職涯與面試, 生活與健康, 時尚穿搭, 文件與排版)'),
      dryRun: z.boolean().optional().describe('若為 true 僅模擬變更')
    },
    async ({ itemId, fromCategory, toCategory, aiReasoning, tags, dryRun }) => {
      const res = await domain.moveItem(itemId, fromCategory, toCategory, aiReasoning, tags, dryRun);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  server.tool(
    'batch_classify_items',
    '批次整理收件匣中的多筆碎片 (單次上限 50 筆)',
    {
      items: z.array(
        z.object({
          itemId: z.string(),
          toCategory: z.string(),
          aiReasoning: z.string().optional(),
          tags: z.array(z.string()).optional().describe('標籤 (受控白名單: 開源, AI提示詞, AI工具, AI Agent, Claude Code, 軟體開發, 前端開發, 系統架構, 雲端維運, 資訊安全, 學術研究, 資料分析, 影片與多媒體, 社群與傳播, 職涯與面試, 生活與健康, 時尚穿搭, 文件與排版)')
        })
      ).max(50).describe('待整理卡片陣列'),
      dryRun: z.boolean().optional().describe('若為 true 僅模擬變更')
    },
    async ({ items, dryRun }) => {
      const res = await domain.batchClassifyItems(items, dryRun);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  server.tool(
    'create_item',
    '在指定分類或收件匣中建立一張新卡片',
    {
      category: z.string().optional().describe('目標分類 (預設 inbox)'),
      text: z.string().describe('卡片標題或文字內容'),
      noteText: z.string().optional().describe('卡片詳細筆記內容'),
      tags: z.array(z.string()).optional().describe('標籤 (受控白名單: 開源, AI提示詞, AI工具, AI Agent, Claude Code, 軟體開發, 前端開發, 系統架構, 雲端維運, 資訊安全, 學術研究, 資料分析, 影片與多媒體, 社群與傳播, 職涯與面試, 生活與健康, 時尚穿搭, 文件與排版)')
    },
    async ({ category, text, noteText, tags }) => {
      const res = await domain.createItem(category, text, noteText, tags);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  server.tool(
    'delete_item',
    '刪除指定分類下的卡片及其筆記子集合',
    {
      itemId: z.string().describe('卡片 ID'),
      category: z.string().describe('所在分類')
    },
    async ({ itemId, category }) => {
      const res = await domain.deleteItem(itemId, category);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  server.tool(
    'search_items',
    '模糊搜尋全庫卡片內容',
    {
      keyword: z.string().describe('搜尋關鍵字'),
      limit: z.number().min(1).max(50).optional().describe('最大回傳筆數 (預設 20)')
    },
    async ({ keyword, limit }) => {
      const items = await domain.searchItems(keyword, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
      };
    }
  );

  server.tool(
    'read_url_content',
    '抓取並萃取指定網址之正文內容 (具備 SSRF 防護)',
    {
      url: z.string().url().describe('目標網址'),
      maxLength: z.number().optional().describe('內文字數上限 (預設 3000)')
    },
    async ({ url, maxLength }) => {
      const res = await readUrlContent(url, maxLength);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  return server;
}
