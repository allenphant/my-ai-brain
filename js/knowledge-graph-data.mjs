// 關鍵技術實體識別表 (與 MCP Server 完全對齊)
export const TECH_ENTITIES = [
  'Claude Code', 'FastMCP', 'MCP', 'Cursor', 'Codex', 'Agentic OS',
  'Obsidian', 'Zotero', 'NotebookLM', 'Gemini', 'OpenRouter', 'Bytez',
  'React', 'Tailwind', 'GSAP', 'Three.js', 'Framer Motion', 'SwiftUI',
  'Prompt Caching', 'Prompt Master', 'Crawl4AI', 'agent-browser',
  'Fish Audio', 'Voice Cloning', 'NVIDIA Broadcast', 'NVIDIA NIM',
  'Academic Research', 'Semantic Scholar', 'arXiv', 'DOI',
  'cURL', 'CVE', 'Strix', 'Cybersecurity', 'Learn Git Branching'
];

function stripHtml(html = '') {
  return String(html || '').replace(/<[^>]+>/g, '').trim();
}

export function extractCardTitle(card) {
  if (card.note?.blocks) {
    const headerBlock = card.note.blocks.find(b => b.type === 'header');
    if (headerBlock?.data?.text) {
      const cleanHeader = stripHtml(headerBlock.data.text);
      if (cleanHeader) return cleanHeader;
    }
  }
  const text = card.text || '';
  const noUrl = text.replace(/https?:\/\/[^\s]+/g, '').trim();
  if (noUrl) {
    return noUrl.length > 40 ? noUrl.substring(0, 40) + '...' : noUrl;
  }
  return text.length > 40 ? text.substring(0, 40) + '...' : (text || '無標題');
}

export function extractCardTldr(card) {
  if (card.note?.blocks) {
    const pBlocks = card.note.blocks.filter(b => b.type === 'paragraph');
    const fullText = pBlocks.map(b => stripHtml(b.data?.text)).join(' ');
    const tldrMatch = fullText.match(/TL;DR[：:]\s*([^。！？\n]+[。！？]?)/i);
    if (tldrMatch) {
      return tldrMatch[1].trim();
    }
    if (pBlocks.length > 0) {
      const firstP = stripHtml(pBlocks[0].data?.text);
      if (firstP) return firstP.length > 100 ? firstP.substring(0, 100) + '...' : firstP;
    }
  }
  return '';
}

export function extractMatchedEntities(combinedText = '') {
  const lower = combinedText.toLowerCase();
  return TECH_ENTITIES.filter(entity => lower.includes(entity.toLowerCase()));
}

export function buildClientGraphData({ cards = [], minWeight = 2, maxNodes = 250, query = '' } = {}) {
  const lowerQuery = (query || '').toLowerCase().trim();

  // 1. 整理所有節點
  const allNodes = cards.map(card => {
    const title = extractCardTitle(card);
    const tldr = extractCardTldr(card);
    const text = card.text || '';
    const noteText = card.note?.blocks ? card.note.blocks.map(b => stripHtml(b.data?.text || '')).join(' ') : '';
    const searchText = card.researchSearchText || card.cardSearchText || '';
    const combined = `${title} ${text} ${noteText} ${searchText}`;
    const entities = extractMatchedEntities(combined);

    const tags = Array.isArray(card.tags) ? card.tags : [];
    const tagIds = Array.isArray(card.tagIds) ? card.tagIds : [];

    return {
      id: card.id,
      title,
      text,
      tldr,
      category: card.collection || card.category || 'inbox',
      tags,
      tagIds,
      entities,
      combinedText: combined.toLowerCase(),
      degree: 0
    };
  });

  // 2. 若有 query，優先篩選種子節點，若無則保留全部
  let eligibleNodes = allNodes;
  if (lowerQuery) {
    eligibleNodes = allNodes.filter(n =>
      n.id.toLowerCase() === lowerQuery ||
      n.title.toLowerCase().includes(lowerQuery) ||
      n.entities.some(e => e.toLowerCase().includes(lowerQuery)) ||
      n.tags.some(t => t.toLowerCase().includes(lowerQuery)) ||
      n.combinedText.includes(lowerQuery)
    );
  }

  // 限制節點數量
  const selectedNodes = eligibleNodes.slice(0, maxNodes);
  const nodeMap = new Map(selectedNodes.map(n => [n.id, n]));

  // 3. 計算關聯邊 (Edges)
  const edges = [];
  const edgeSet = new Set();

  for (let i = 0; i < selectedNodes.length; i++) {
    const nodeA = selectedNodes[i];
    for (let j = i + 1; j < selectedNodes.length; j++) {
      const nodeB = selectedNodes[j];

      // 計算共享實體
      const sharedEntities = nodeA.entities.filter(e => nodeB.entities.includes(e));
      // 計算共享標籤
      const sharedTags = nodeA.tags.filter(t => nodeB.tags.includes(t));

      const weight = (sharedEntities.length * 3) + (sharedTags.length * 2);

      if (weight >= minWeight) {
        const edgeId = `${nodeA.id}->${nodeB.id}`;
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);
          edges.push({
            id: edgeId,
            source: nodeA.id,
            target: nodeB.id,
            weight,
            sharedEntities,
            sharedTags
          });
          nodeA.degree++;
          nodeB.degree++;
        }
      }
    }
  }

  // 4. 動態計算節點半徑 (依 degree，介於 6px ~ 18px)
  selectedNodes.forEach(node => {
    node.radius = Math.min(18, Math.max(6, 6 + Math.sqrt(node.degree) * 2.5));
  });

  // 5. 建立實體叢集 (Entity Clusters)
  const entityClusters = new Map();
  for (const entity of TECH_ENTITIES) {
    const matched = selectedNodes.filter(n => n.entities.includes(entity));
    if (matched.length > 0) {
      entityClusters.set(entity, matched.map(n => n.id));
    }
  }

  return {
    nodes: selectedNodes,
    edges,
    entityClusters
  };
}
