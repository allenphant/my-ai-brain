import test from 'node:test';
import assert from 'node:assert/strict';
import { ForceSimulation2D } from '../js/knowledge-graph-engine.mjs';

test('ForceSimulation2D initializes coordinates and converges velocity', () => {
  const nodes = [
    { id: '1', title: 'Node 1', radius: 10 },
    { id: '2', title: 'Node 2', radius: 10 }
  ];
  const edges = [{ source: '1', target: '2', weight: 3 }];
  
  const sim = new ForceSimulation2D({ nodes, edges, width: 800, height: 600 });
  
  // 驗證初始座標被賦予合理範圍
  assert.equal(typeof nodes[0].x, 'number');
  assert.equal(typeof nodes[0].y, 'number');
  assert.ok(nodes[0].x >= 0 && nodes[0].x <= 800);
  assert.ok(nodes[0].y >= 0 && nodes[0].y <= 600);

  // 執行 100 步模擬
  sim.tick(100);

  // 驗證速度在阻尼與 alpha 衰減下收斂
  assert.ok(Math.abs(nodes[0].vx) < 5);
  assert.ok(Math.abs(nodes[0].vy) < 5);
});

test('ForceSimulation2D respects fixed coordinates during drag', () => {
  const nodes = [
    { id: '1', title: 'Node 1', radius: 10 },
    { id: '2', title: 'Node 2', radius: 10 }
  ];
  const edges = [{ source: '1', target: '2', weight: 3 }];
  
  const sim = new ForceSimulation2D({ nodes, edges, width: 800, height: 600 });
  nodes[0].fx = 150;
  nodes[0].fy = 250;

  sim.tick(20);

  // 驗證固定座標不被物理力撼動
  assert.equal(nodes[0].x, 150);
  assert.equal(nodes[0].y, 250);
});

test('ForceSimulation2D settles and enters isSettled state', () => {
  const nodes = [
    { id: '1', title: 'Node 1', radius: 6 },
    { id: '2', title: 'Node 2', radius: 6 }
  ];
  const edges = [{ source: '1', target: '2', weight: 2 }];

  const sim = new ForceSimulation2D({ nodes, edges, width: 800, height: 600 });

  // 模擬足夠步數，驗證系統成功收斂休眠
  sim.tick(120);
  assert.equal(sim.isSettled, true);

  // 重新加熱後，狀態重設為未收斂
  sim.reheat();
  assert.equal(sim.isSettled, false);
});

test('ForceSimulation2D collision avoidance enforces distance between overlapping nodes', () => {
  const nodes = [
    { id: '1', title: 'Node 1', radius: 6, x: 400, y: 300 },
    { id: '2', title: 'Node 2', radius: 6, x: 400.1, y: 300.1 }
  ];
  const edges = [];

  const sim = new ForceSimulation2D({ nodes, edges, width: 800, height: 600 });
  // 覆寫初始座標使其高度重疊
  nodes[0].x = 400;
  nodes[0].y = 300;
  nodes[1].x = 400.1;
  nodes[1].y = 300.1;

  // 執行一步物理模擬
  sim.tick(1);

  // 驗證碰撞排斥力使兩者速度方向相反且迅速彈開
  const dist = Math.hypot(nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y);
  assert.ok(dist > 0.5, `Distance ${dist} should expand immediately from collision force`);
});

test('getCategoryColor returns mapped or deterministic palette color', async () => {
  const { getCategoryColor, GRAPH_PALETTE } = await import('../js/knowledge-graph-engine.mjs');

  // 預設分類
  assert.equal(getCategoryColor('learning'), '#38bdf8');
  assert.equal(getCategoryColor('bookmarks'), '#818cf8');
  assert.equal(getCategoryColor('todos'), '#34d399');

  // 自訂分類 ID (如 Firestore 隨機字串) 應映射至調色盤顏色
  const customColor1 = getCategoryColor('9Lup7gmE11HRsnq00WdP', '我的研究專案');
  assert.ok(GRAPH_PALETTE.includes(customColor1));

  const customColor2 = getCategoryColor('abc123xyz', '財務規劃');
  assert.ok(GRAPH_PALETTE.includes(customColor2));
});

test('KnowledgeGraphViewer manages label modes and filter groups', async () => {
  const { KnowledgeGraphViewer } = await import('../js/knowledge-graph-engine.mjs');
  const mockCanvas = {
    getContext: () => ({
      scale: () => {},
      setTransform: () => {},
      fillRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      arc: () => {},
      fill: () => {},
      measureText: () => ({ width: 40 }),
      fillText: () => {}
    }),
    clientWidth: 800,
    clientHeight: 600,
    addEventListener: () => {}
  };

  const graphData = {
    nodes: [
      { id: '1', title: 'Node 1', category: 'learning', tags: ['AI'] },
      { id: '2', title: 'Node 2', category: 'bookmarks', tags: ['Web'] }
    ],
    edges: []
  };

  const viewer = new KnowledgeGraphViewer({ canvas: mockCanvas, graphData });
  assert.equal(viewer.labelMode, 'focus');

  // 切換為 all 模式
  const mode = viewer.toggleLabelMode();
  assert.equal(mode, 'all');
  assert.equal(viewer.labelMode, 'all');

  // 切換回 focus 模式
  viewer.toggleLabelMode();
  assert.equal(viewer.labelMode, 'focus');

  // 設定群組過濾
  viewer.setFilterGroup({ type: 'category', value: 'learning' });
  assert.deepEqual(viewer.filterGroup, { type: 'category', value: 'learning' });

  viewer.setFilterGroup(null);
  assert.equal(viewer.filterGroup, null);
});


