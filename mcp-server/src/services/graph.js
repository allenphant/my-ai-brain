import { getDb, getUserBasePath } from './firestore.js';

// 關鍵技術實體識別表 (用於雙向語意圖譜關聯)
const TECH_ENTITIES = [
  'Claude Code', 'FastMCP', 'MCP', 'Cursor', 'Codex', 'Agentic OS',
  'Obsidian', 'Zotero', 'NotebookLM', 'Gemini', 'OpenRouter', 'Bytez',
  'React', 'Tailwind', 'GSAP', 'Three.js', 'Framer Motion', 'SwiftUI',
  'Prompt Caching', 'Prompt Master', 'Crawl4AI', 'agent-browser',
  'Fish Audio', 'Voice Cloning', 'NVIDIA Broadcast', 'NVIDIA NIM',
  'Academic Research', 'Semantic Scholar', 'arXiv', 'DOI',
  'cURL', 'CVE', 'Strix', 'Cybersecurity', 'Learn Git Branching'
];

let cachedCards = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分鐘記憶體快取

export async function loadAllCards(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedCards && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedCards;
  }

  const db = getDb();
  const userDoc = db.doc(getUserBasePath());
  const subCols = await userDoc.listCollections();

  const cards = [];
  for (const col of subCols) {
    if (['settings', 'researchJobs', 'researchUsage', 'memberships', 'categories', 'inbox'].includes(col.id)) continue;
    const snap = await col.get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const text = data.text || '';
      
      // 提取標題
      let title = '';
      if (data.note?.blocks) {
        const headerBlock = data.note.blocks.find(b => b.type === 'header');
        if (headerBlock?.data?.text) {
          title = headerBlock.data.text.replace(/<[^>]+>/g, '').trim();
        }
      }
      if (!title) {
        title = text.replace(/https?:\/\/[^\s]+/g, '').trim().substring(0, 40) || text.substring(0, 40);
      }

      // 提取 TL;DR 與詳細內文
      let tldr = '';
      let fullNoteText = '';
      if (data.note?.blocks) {
        const pBlocks = data.note.blocks.filter(b => b.type === 'paragraph');
        fullNoteText = pBlocks.map(b => (b.data?.text || '').replace(/<[^>]+>/g, '')).join(' ');
        const tldrMatch = fullNoteText.match(/TL;DR[：:]\s*([^。！？\n]+[。！？]?)/i);
        if (tldrMatch) {
          tldr = tldrMatch[1].trim();
        } else if (pBlocks.length > 0) {
          tldr = (pBlocks[0].data?.text || '').replace(/<[^>]+>/g, '').substring(0, 100);
        }
      }

      const searchText = data.researchSearchText || '';
      const combinedText = `${title} ${text} ${searchText} ${fullNoteText}`.toLowerCase();

      // 提取該卡片包含的實體
      const matchedEntities = TECH_ENTITIES.filter(entity => 
        combinedText.includes(entity.toLowerCase())
      );

      cards.push({
        id: doc.id,
        col: col.id,
        title,
        tldr,
        text,
        fullNoteText,
        searchText,
        tagIds: Array.isArray(data.tagIds) ? data.tagIds : (Array.isArray(data.tags) ? data.tags : []),
        entities: matchedEntities,
        hasNote: !!data.hasNote,
        updatedAt: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : (data.createdAt || 0)
      });
    }
  }

  cachedCards = cards;
  lastCacheTime = now;
  return cards;
}

export async function buildKnowledgeGraph({ query = '', maxNodes = 20, minWeight = 2, format = 'wiki' }) {
  const cards = await loadAllCards();
  const lowerQuery = (query || '').toLowerCase().trim();

  // 1. 決定種子節點 (Seed Nodes)
  let seedCards = [];
  if (lowerQuery) {
    seedCards = cards.filter(c => 
      c.id.toLowerCase() === lowerQuery ||
      c.title.toLowerCase().includes(lowerQuery) ||
      c.searchText.toLowerCase().includes(lowerQuery) ||
      c.fullNoteText.toLowerCase().includes(lowerQuery) ||
      c.entities.some(e => e.toLowerCase().includes(lowerQuery)) ||
      c.tagIds.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  // 若無指定 query 或找不到種子，選取包含最多實體與筆記的高權重核心卡片
  if (seedCards.length === 0) {
    seedCards = [...cards]
      .filter(c => c.hasNote)
      .sort((a, b) => b.entities.length - a.entities.length)
      .slice(0, 10);
  }

  const seedIds = new Set(seedCards.map(c => c.id));
  const activeNodeIds = new Set(seedIds);
  const edges = [];

  // 2. 計算關聯邊 (Edges)
  for (const cardA of cards) {
    for (const cardB of cards) {
      if (cardA.id >= cardB.id) continue; // 避免重複雙向計算

      let weight = 0;
      const reasons = [];

      // 共享技術實體 (每個 +3)
      const sharedEntities = cardA.entities.filter(e => cardB.entities.includes(e));
      if (sharedEntities.length > 0) {
        weight += sharedEntities.length * 3;
        reasons.push(`共享技術: ${sharedEntities.join(', ')}`);
      }

      // 共享標籤 (每個 +2)
      const sharedTags = cardA.tagIds.filter(t => cardB.tagIds.includes(t));
      if (sharedTags.length > 0) {
        weight += sharedTags.length * 2;
        reasons.push(`共享標籤 (${sharedTags.length}個)`);
      }

      // 內文提及對方的標題或重要關鍵字 (+4)
      if (cardA.title.length >= 4 && cardB.fullNoteText.toLowerCase().includes(cardA.title.toLowerCase())) {
        weight += 4;
        reasons.push(`內文引用 [[${cardA.title}]]`);
      }
      if (cardB.title.length >= 4 && cardA.fullNoteText.toLowerCase().includes(cardB.title.toLowerCase())) {
        weight += 4;
        reasons.push(`內文引用 [[${cardB.title}]]`);
      }

      if (weight >= minWeight) {
        // 若其中一端是種子節點，則將另一端納入可視化節點
        if (seedIds.has(cardA.id) || seedIds.has(cardB.id) || !lowerQuery) {
          edges.push({
            source: cardA.id,
            target: cardB.id,
            weight,
            reason: reasons.join(' | ')
          });
          activeNodeIds.add(cardA.id);
          activeNodeIds.add(cardB.id);
        }
      }
    }
  }

  // 截斷節點數量至 maxNodes
  const nodeIdsArray = Array.from(activeNodeIds).slice(0, maxNodes);
  const finalNodes = cards.filter(c => nodeIdsArray.includes(c.id));
  const finalNodeSet = new Set(finalNodes.map(n => n.id));
  const finalEdges = edges.filter(e => finalNodeSet.has(e.source) && finalNodeSet.has(e.target))
    .sort((a, b) => b.weight - a.weight);

  // 3. 輸出 LLM Wiki Markdown 格式
  let wikiMarkdown = '';
  wikiMarkdown += `# 知識大腦關聯圖譜 (Knowledge Graph Wiki)\n\n`;
  if (lowerQuery) {
    wikiMarkdown += `> **檢索核心**：\`${query}\` | 命中節點：${finalNodes.length} 個 | 關聯邊：${finalEdges.length} 條\n\n`;
  } else {
    wikiMarkdown += `> **全庫技術樞紐視角** | 節點：${finalNodes.length} 個 | 關聯邊：${finalEdges.length} 條\n\n`;
  }

  wikiMarkdown += `## 核心知識節點 (Nodes)\n\n`;
  for (const node of finalNodes) {
    wikiMarkdown += `### [[${node.title}]]\n`;
    wikiMarkdown += `- **卡片 ID**：\`${node.col}/${node.id}\`\n`;
    if (node.tldr) {
      wikiMarkdown += `- **TL;DR**：${node.tldr}\n`;
    }
    if (node.entities.length > 0) {
      wikiMarkdown += `- **核心技術標籤**：${node.entities.map(e => `\`#${e}\``).join(' ')}\n`;
    }

    // 列出連出的關聯卡片
    const connectedEdges = finalEdges.filter(e => e.source === node.id || e.target === node.id);
    if (connectedEdges.length > 0) {
      wikiMarkdown += `- **雙向關聯鏈結 (Links)**：\n`;
      for (const edge of connectedEdges) {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const otherNode = cards.find(c => c.id === otherId);
        if (otherNode) {
          wikiMarkdown += `  - ⇄ [[${otherNode.title}]] (權重: ${edge.weight}) —— ${edge.reason}\n`;
        }
      }
    }
    wikiMarkdown += `\n`;
  }

  // 4. 聚合技術實體地圖 (Entity Map)
  const entityClusters = {};
  for (const node of finalNodes) {
    for (const ent of node.entities) {
      if (!entityClusters[ent]) entityClusters[ent] = [];
      entityClusters[ent].push(`[[${node.title}]]`);
    }
  }

  wikiMarkdown += `## 技術棧與實體網絡叢集 (Entity Clusters)\n\n`;
  for (const [entity, titles] of Object.entries(entityClusters)) {
    if (titles.length >= 2) {
      wikiMarkdown += `* **\`${entity}\`** (${titles.length} 個節點)：${titles.join(' ↔ ')}\n`;
    }
  }

  return {
    query: query || null,
    totalNodes: finalNodes.length,
    totalEdges: finalEdges.length,
    wikiMarkdown,
    graph: {
      nodes: finalNodes.map(n => ({ id: n.id, title: n.title, col: n.col, entities: n.entities, tldr: n.tldr })),
      edges: finalEdges
    }
  };
}
