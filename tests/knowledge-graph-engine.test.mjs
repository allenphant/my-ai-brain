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
