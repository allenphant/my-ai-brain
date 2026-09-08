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

export function buildClientGraphData({
  cards = [],
  minWeight = 3,
  maxEdgesPerNode = 5,
  maxNodes = 250,
  query = ''
} = {}) {
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

  // 3. 計算關聯邊候選池 (Candidate Edges)
  const candidateEdges = [];

  for (let i = 0; i < selectedNodes.length; i++) {
    const nodeA = selectedNodes[i];
    for (let j = i + 1; j < selectedNodes.length; j++) {
      const nodeB = selectedNodes[j];

      // 計算共享實體
      const sharedEntities = nodeA.entities.filter(e => nodeB.entities.includes(e));
      // 計算共享標籤
      const sharedTags = nodeA.tags.filter(t => nodeB.tags.includes(t));

      // 權重計算：實體是強語意關聯 (+3/個)；單一標籤不足以成邊，需多標籤(+2/個)或結合實體(+2)
      let weight = sharedEntities.length * 3;
      if (sharedTags.length >= 2) {
        weight += sharedTags.length * 2;
      } else if (sharedTags.length === 1 && sharedEntities.length > 0) {
        weight += 2;
      }

      if (weight >= minWeight) {
        candidateEdges.push({
          id: `${nodeA.id}->${nodeB.id}`,
          source: nodeA.id,
          target: nodeB.id,
          weight,
          sharedEntities,
          sharedTags
        });
      }
    }
  }

  // 4. K-NN 邊線修剪 (Pruning: 避免毛球效應，限制每個節點最大關聯邊數)
  candidateEdges.sort((a, b) => b.weight - a.weight);
  const nodeDegree = new Map();
  const edges = [];

  for (const edge of candidateEdges) {
    const degA = nodeDegree.get(edge.source) || 0;
    const degB = nodeDegree.get(edge.target) || 0;

    if (degA < maxEdgesPerNode && degB < maxEdgesPerNode) {
      edges.push(edge);
      nodeDegree.set(edge.source, degA + 1);
      nodeDegree.set(edge.target, degB + 1);
    }
  }

  // 回填 degree 與節點半徑
  selectedNodes.forEach(node => {
    node.degree = nodeDegree.get(node.id) || 0;
    // 5. 節點半徑採用 Obsidian 標準尺寸：4px ~ 9px (避免重疊覆蓋)
    node.radius = Math.min(9, Math.max(4, 4 + Math.sqrt(node.degree) * 1.5));
  });

  // 6. 建立實體叢集 (Entity Clusters)
  const entityClusters = new Map();
  for (const entity of TECH_ENTITIES) {
    const matched = selectedNodes.filter(n => n.entities.includes(entity));
    if (matched.length > 0) {
      entityClusters.set(entity, matched.map(n => n.id));
    }
  }

  // 7. 建立真實標籤叢集 (Tag Clusters - 動態統計所有出現的真實標籤)
  const tagClusters = new Map();
  selectedNodes.forEach(node => {
    (node.tags || []).forEach(tag => {
      const trimmed = (tag || '').trim();
      if (!trimmed) return;
      if (!tagClusters.has(trimmed)) tagClusters.set(trimmed, []);
      tagClusters.get(trimmed).push(node.id);
    });
  });

  // 8. 建立分類叢集 (Category Clusters - 動態統計所有出現的分類集合)
  const categoryClusters = new Map();
  selectedNodes.forEach(node => {
    const cat = node.category || 'inbox';
    if (!categoryClusters.has(cat)) categoryClusters.set(cat, []);
    categoryClusters.get(cat).push(node.id);
  });

  return {
    nodes: selectedNodes,
    edges,
    entityClusters,
    tagClusters,
    categoryClusters
  };
}

