import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientGraphData, TECH_ENTITIES } from '../js/knowledge-graph-data.mjs';

test('buildClientGraphData correctly calculates nodes, edges, and entity weights', () => {
  const cards = [
    {
      id: 'c1',
      collection: 'learning',
      text: 'Claude Code MCP 工具開發教學',
      tagIds: ['tag-1'],
      tags: ['AI Agent']
    },
    {
      id: 'c2',
      collection: 'bookmarks',
      text: 'Obsidian 與 Claude Code 打造 Agentic OS',
      tagIds: ['tag-1', 'tag-2'],
      tags: ['AI Agent', '軟體開發']
    },
    {
      id: 'c3',
      collection: 'todos',
      text: '健身運動指南',
      tagIds: ['tag-3'],
      tags: ['生活與健康']
    }
  ];

  const graph = buildClientGraphData({ cards, minWeight: 2 });
  assert.equal(graph.nodes.length, 3);
  
  // c1 與 c2 共享 'Claude Code' (權重 +3) 與標籤 'AI Agent' (權重 +2) -> 權重 5 >= 2
  const edge = graph.edges.find(e => 
    (e.source === 'c1' && e.target === 'c2') || (e.source === 'c2' && e.target === 'c1')
  );
  assert.ok(edge);
  assert.equal(edge.weight, 5);

  // c3 無共享實體與標籤 -> 無邊線
  const c3Edges = graph.edges.filter(e => e.source === 'c3' || e.target === 'c3');
  assert.equal(c3Edges.length, 0);

  // 驗證節點屬性
  const n1 = graph.nodes.find(n => n.id === 'c1');
  assert.ok(n1);
  assert.equal(n1.title, 'Claude Code MCP 工具開發教學');
  assert.ok(n1.entities.includes('Claude Code'));
  assert.ok(n1.entities.includes('MCP'));
});

test('buildClientGraphData extracts title and TL;DR from Editor.js note', () => {
  const cards = [
    {
      id: 'c10',
      collection: 'learning',
      text: 'https://example.com/some-tool',
      note: {
        blocks: [
          { type: 'header', data: { text: '頂級前端動效庫 <b>Three.js</b>' } },
          { type: 'paragraph', data: { text: 'TL;DR：這是一款基於 WebGL 的 3D 渲染庫，極度強大。' } }
        ]
      },
      tags: ['前端開發']
    }
  ];

  const graph = buildClientGraphData({ cards, minWeight: 1 });
  const n = graph.nodes[0];
  assert.equal(n.title, '頂級前端動效庫 Three.js');
  assert.equal(n.tldr, '這是一款基於 WebGL 的 3D 渲染庫，極度強大。');
  assert.ok(n.entities.includes('Three.js'));
});

test('buildClientGraphData: single generic tag does not form an edge, multiple tags do', () => {
  const cards = [
    { id: 'c1', collection: 'learning', text: 'Card 1', tags: ['AI工具'] },
    { id: 'c2', collection: 'ideas', text: 'Card 2', tags: ['AI工具'] },
    { id: 'c3', collection: 'todos', text: 'Card 3', tags: ['AI工具', '自動化'] },
    { id: 'c4', collection: 'bookmarks', text: 'Card 4', tags: ['AI工具', '自動化'] }
  ];

  const graph = buildClientGraphData({ cards, minWeight: 3 });

  // c1 與 c2 僅共享單一標籤且無實體，權重為 0，不應成邊
  const edge12 = graph.edges.find(e =>
    (e.source === 'c1' && e.target === 'c2') || (e.source === 'c2' && e.target === 'c1')
  );
  assert.equal(edge12, undefined);

  // c3 與 c4 共享 2 個標籤，權重為 4 >= 3，應成功成邊
  const edge34 = graph.edges.find(e =>
    (e.source === 'c3' && e.target === 'c4') || (e.source === 'c4' && e.target === 'c3')
  );
  assert.ok(edge34);
  assert.equal(edge34.weight, 4);
});

test('buildClientGraphData enforces maxEdgesPerNode (K-NN pruning) and Obsidian radius', () => {
  // 建立 10 張卡片，全部共享相同的科技實體與標籤
  const cards = Array.from({ length: 10 }, (_, i) => ({
    id: `card-${i}`,
    collection: 'learning',
    text: `Card ${i} using React and TypeScript for frontend`,
    tags: ['前端', '架構']
  }));

  const graph = buildClientGraphData({ cards, minWeight: 3, maxEdgesPerNode: 3 });

  // 驗證每個節點的邊數絕對不超過 maxEdgesPerNode (3)
  graph.nodes.forEach(node => {
    assert.ok(node.degree <= 3, `Node ${node.id} degree ${node.degree} exceeds max 3`);
    // 節點半徑符合 Obsidian 標準 (4px ~ 9px)
    assert.ok(node.radius >= 4 && node.radius <= 9, `Node radius ${node.radius} out of bounds`);
  });
});

test('buildClientGraphData extracts dynamic tagClusters and categoryClusters', () => {
  const cards = [
    { id: 'c1', collection: 'learning', text: 'Card 1', tags: ['AI Agent', 'Python'] },
    { id: 'c2', collection: 'bookmarks', text: 'Card 2', tags: ['AI Agent', 'Web'] },
    { id: 'c3', collection: 'learning', text: 'Card 3', tags: ['Python'] }
  ];

  const graph = buildClientGraphData({ cards, minWeight: 2 });

  // 驗證 tagClusters
  assert.ok(graph.tagClusters instanceof Map);
  assert.deepEqual(graph.tagClusters.get('AI Agent'), ['c1', 'c2']);
  assert.deepEqual(graph.tagClusters.get('Python'), ['c1', 'c3']);
  assert.deepEqual(graph.tagClusters.get('Web'), ['c2']);

  // 驗證 categoryClusters
  assert.ok(graph.categoryClusters instanceof Map);
  assert.deepEqual(graph.categoryClusters.get('learning'), ['c1', 'c3']);
  assert.deepEqual(graph.categoryClusters.get('bookmarks'), ['c2']);
});

test('buildClientGraphData with autoExtractEntities dynamically discovers recurring entities without hardcoding', () => {
  // CLABSI 和 FastAPI 並不在預設的 TECH_ENTITIES 白名單中
  assert.equal(TECH_ENTITIES.includes('CLABSI'), false);
  assert.equal(TECH_ENTITIES.includes('FastAPI'), false);

  const cards = [
    { id: 'm1', collection: 'learning', text: '醫院感控年報 CLABSI 監視數據統計與標準化比值分析' },
    { id: 'm2', collection: 'bookmarks', text: 'CLABSI 導管相關血流感染預防指引與組合式照護' },
    { id: 'dev1', collection: 'cdc_projects', text: '後端服務採用 FastAPI 建構非同步微服務' },
    { id: 'dev2', collection: 'todos', text: '優化 FastAPI 接口路由與 Swagger 文檔' }
  ];

  const graph = buildClientGraphData({ cards, autoExtractEntities: true, minWeight: 3 });

  // 驗證 m1 與 m2 自動透過未寫死的 CLABSI 成邊 (權重 +3)
  const medEdge = graph.edges.find(e =>
    (e.source === 'm1' && e.target === 'm2') || (e.source === 'm2' && e.target === 'm1')
  );
  assert.ok(medEdge, 'Should form edge between m1 and m2 via dynamically extracted CLABSI');
  assert.equal(medEdge.weight, 3);
  assert.ok(medEdge.sharedEntities.includes('CLABSI'));

  // 驗證 dev1 與 dev2 自動透過未寫死的 FastAPI 成邊 (權重 +3)
  const devEdge = graph.edges.find(e =>
    (e.source === 'dev1' && e.target === 'dev2') || (e.source === 'dev2' && e.target === 'dev1')
  );
  assert.ok(devEdge, 'Should form edge between dev1 and dev2 via dynamically extracted FastAPI');
  assert.equal(devEdge.weight, 3);
  assert.ok(devEdge.sharedEntities.includes('FastAPI'));
});


