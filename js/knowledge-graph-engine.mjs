/**
 * 2D 物理力導向模擬引擎 (ForceSimulation2D)
 * 專為知識圖譜設計之星系級力導向佈局，具備硬性碰撞避免與休眠收斂
 */
export class ForceSimulation2D {
  constructor({ nodes = [], edges = [], width = 800, height = 600 } = {}) {
    this.nodes = nodes;
    this.edges = edges;
    this.width = width;
    this.height = height;

    this.alpha = 1.0;
    this.alphaMin = 0.002;
    this.alphaDecay = 0.012;
    this.velocityDecay = 0.82;

    // 物理力參數：強調斥力展開、極弱向心漂移、適度彈簧引力
    this.chargeStrength = -320;
    this.linkDistance = 110;
    this.linkStrength = 0.045;
    this.centerStrength = 0.006;
    this.collisionPadding = 18;

    this.isSettled = false;
    this.nodeMap = new Map();

    this.init();
  }

  init() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    this.nodes.forEach((node, idx) => {
      this.nodeMap.set(node.id, node);
      if (typeof node.x !== 'number') {
        // 利用費馬螺線 (Fermat spiral) 自然展開節點，避免初始群聚碰撞
        const dist = 36 + Math.sqrt(idx + 1) * 38;
        const angle = idx * goldenAngle;
        node.x = cx + Math.cos(angle) * dist;
        node.y = cy + Math.sin(angle) * dist;
      }
      if (typeof node.vx !== 'number') node.vx = 0;
      if (typeof node.vy !== 'number') node.vy = 0;
      if (!node.radius) node.radius = 6;
    });

    // 建立邊線對象引用
    this.edges.forEach(edge => {
      edge.sourceNode = this.nodeMap.get(edge.source);
      edge.targetNode = this.nodeMap.get(edge.target);
    });

    this.isSettled = false;
  }

  tick(iterations = 1) {
    for (let iter = 0; iter < iterations; iter++) {
      const isSimulating = this.alpha >= this.alphaMin;
      const cx = this.width / 2;
      const cy = this.height / 2;
      const nodes = this.nodes;
      const numNodes = nodes.length;

      if (isSimulating) {
        // 1. 節點間相互斥力 (Charge Repulsion) 與硬性防重疊碰撞 (Hard Collision Separation)
        for (let i = 0; i < numNodes; i++) {
          const nodeA = nodes[i];
          const rA = nodeA.radius || 6;

          for (let j = i + 1; j < numNodes; j++) {
            const nodeB = nodes[j];
            const rB = nodeB.radius || 6;

            let dx = nodeB.x - nodeA.x;
            let dy = nodeB.y - nodeA.y;
            let distSq = dx * dx + dy * dy;
            if (distSq === 0) {
              dx = (Math.random() - 0.5) * 2;
              dy = (Math.random() - 0.5) * 2;
              distSq = dx * dx + dy * dy;
            }
            const dist = Math.sqrt(distSq);

            // (1) 庫倫斥力 (Charge Repulsion)
            if (dist < 600) {
              const force = (this.chargeStrength * this.alpha) / Math.max(30, distSq);
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;

              nodeA.vx -= fx;
              nodeA.vy -= fy;
              nodeB.vx += fx;
              nodeB.vy += fy;
            }

            // (2) 硬性碰撞避免 (Collision Constraint - 杜絕節點疊合葡萄串)
            const minDist = rA + rB + this.collisionPadding;
            if (dist < minDist) {
              const overlap = minDist - dist;
              const push = (overlap / dist) * 0.5;
              const px = dx * push;
              const py = dy * push;

              nodeA.vx -= px;
              nodeA.vy -= py;
              nodeB.vx += px;
              nodeB.vy += py;
            }
          }
        }

        // 2. 邊線彈簧引力 (Link Spring Force)
        for (let i = 0; i < this.edges.length; i++) {
          const edge = this.edges[i];
          const source = edge.sourceNode;
          const target = edge.targetNode;
          if (!source || !target) continue;

          let dx = target.x - source.x;
          let dy = target.y - source.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const desiredDist = Math.max(50, this.linkDistance - (edge.weight || 1) * 2);
          const displacement = dist - desiredDist;
          const force = displacement * this.linkStrength * this.alpha;

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          source.vx += fx;
          source.vy += fy;
          target.vx -= fx;
          target.vy -= fy;
        }

        // 3. 微弱中心漂移 (Gentle Center Drift - 防止無限飄移但絕不向心坍縮)
        for (let i = 0; i < numNodes; i++) {
          const node = nodes[i];
          const dx = cx - node.x;
          const dy = cy - node.y;
          node.vx += dx * this.centerStrength * this.alpha;
          node.vy += dy * this.centerStrength * this.alpha;
        }

        this.alpha -= this.alphaDecay;
      }

      // 4. 更新位置與速度阻尼
      let maxVelocity = 0;
      for (let i = 0; i < numNodes; i++) {
        const node = nodes[i];
        if (typeof node.fx === 'number' && typeof node.fy === 'number') {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
        } else {
          node.vx *= this.velocityDecay;
          node.vy *= this.velocityDecay;
          node.x += node.vx;
          node.y += node.vy;

          const speed = Math.abs(node.vx) + Math.abs(node.vy);
          if (speed > maxVelocity) maxVelocity = speed;
        }
      }

      if (!isSimulating && maxVelocity < 0.02) {
        this.isSettled = true;
        return;
      }
    }
  }

  reheat(targetAlpha = 0.35) {
    this.alpha = Math.max(this.alpha, targetAlpha);
    this.isSettled = false;
  }
}

/**
 * 8 色高對比星系調色盤
 */
export const GRAPH_PALETTE = [
  '#38bdf8', // 天藍 (Sky)
  '#34d399', // 翡翠綠 (Emerald)
  '#818cf8', // 靛藍 (Indigo)
  '#fbbf24', // 琥珀黃 (Amber)
  '#f43f5e', // 玫瑰粉 (Rose)
  '#2dd4bf', // 湖水綠 (Teal)
  '#a855f7', // 紫羅蘭 (Purple)
  '#fb923c'  // 暖陽橘 (Orange)
];

/**
 * 根據分類 ID 或名稱取得確定性調色盤顏色
 */
export function getCategoryColor(categoryId, categoryName = '') {
  const standard = {
    learning: '#38bdf8',
    bookmarks: '#818cf8',
    todos: '#34d399',
    ideas: '#fbbf24',
    inbox: '#94a3b8'
  };
  if (standard[categoryId]) return standard[categoryId];

  const key = String(categoryName || categoryId || 'general');
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  return GRAPH_PALETTE[Math.abs(hash) % GRAPH_PALETTE.length];
}

/**
 * 2D 知識圖譜畫布渲染與手勢互動控制器 (KnowledgeGraphViewer)
 * 支援批次渲染、條件標籤顯示、智慧休眠排程與全觸控特徵偵測
 */
export class KnowledgeGraphViewer {
  constructor({
    canvas,
    graphData,
    categoryMap = {},
    onNodeSelect = () => {},
    onCanvasClick = () => {}
  }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.graphData = graphData;
    this.categoryMap = categoryMap;
    this.onNodeSelect = onNodeSelect;
    this.onCanvasClick = onCanvasClick;

    // 視圖變換 (Pan & Zoom)
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    // 互動狀態
    this.selectedNodeId = null;
    this.hoveredNodeId = null;
    this.draggedNode = null;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // 多點觸控縮放
    this.lastTouchDist = 0;

    // 標籤模式：'focus' (預設，僅顯示選取/懸停/鄰居) 或 'all' (全顯，帶 AABB 防撞字)
    this.labelMode = 'focus';

    // 群組過濾：null 或 { type: 'category' | 'tag' | 'entity', value: string }
    this.filterGroup = null;

    // 動畫與休眠控制
    this.isRunning = false;
    this.isSleeping = false;
    this.animFrameId = null;

    // 裝置特徵偵測 (嚴格使用特徵偵測，絕不使用螢幕寬度)
    this.isTouchDevice = typeof window !== 'undefined' &&
      (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));

    this.hitPadding = this.isTouchDevice ? 16 : 8;

    // 初始化物理引擎
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 600;
    this.simulation = new ForceSimulation2D({
      nodes: this.graphData.nodes,
      edges: this.graphData.edges,
      width,
      height
    });

    // 預先暖機 60 步，初始佈局直接展開到位
    this.simulation.tick(60);

    // 居中對齊
    this.centerView();

    this.bindEvents();
  }

  setLabelMode(mode) {
    this.labelMode = mode === 'all' ? 'all' : 'focus';
    this.requestRender();
  }

  toggleLabelMode() {
    this.labelMode = this.labelMode === 'focus' ? 'all' : 'focus';
    this.requestRender();
    return this.labelMode;
  }

  setFilterGroup(filter) {
    this.filterGroup = filter;
    this.requestRender();
  }

  centerView() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.requestRender();
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
    this.simulation.width = width;
    this.simulation.height = height;
    this.render();
  }

  screenToWorld(sx, sy) {
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    const wx = (sx - cx - this.panX) / this.zoom + cx;
    const wy = (sy - cy - this.panY) / this.zoom + cy;
    return { x: wx, y: wy };
  }

  findNodeAt(sx, sy) {
    const { x, y } = this.screenToWorld(sx, sy);
    const nodes = this.graphData.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = x - n.x;
      const dy = y - n.y;
      const hitRadius = (n.radius || 6) + this.hitPadding / this.zoom;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return n;
      }
    }
    return null;
  }

  bindEvents() {
    const cv = this.canvas;

    // 滑鼠事件
    cv.addEventListener('mousedown', e => {
      const rect = cv.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const node = this.findNodeAt(sx, sy);
      if (node) {
        this.draggedNode = node;
        node.fx = node.x;
        node.fy = node.y;
        this.simulation.reheat(0.3);
        this.wakeUp();
      } else {
        this.isPanning = true;
        this.panStartX = sx - this.panX;
        this.panStartY = sy - this.panY;
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', e => {
        const rect = cv.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (this.draggedNode) {
          const { x, y } = this.screenToWorld(sx, sy);
          this.draggedNode.fx = x;
          this.draggedNode.fy = y;
          this.simulation.reheat(0.15);
          this.wakeUp();
          return;
        }

        if (this.isPanning) {
          this.panX = sx - this.panStartX;
          this.panY = sy - this.panStartY;
          this.requestRender();
          return;
        }

        // 懸停偵測
        if (!this.isTouchDevice) {
          const hovered = this.findNodeAt(sx, sy);
          const nextHoverId = hovered ? hovered.id : null;
          if (nextHoverId !== this.hoveredNodeId) {
            this.hoveredNodeId = nextHoverId;
            cv.style.cursor = hovered ? 'pointer' : 'default';
            this.requestRender();
          }
        }
      });

      window.addEventListener('mouseup', () => {
        if (this.draggedNode) {
          this.draggedNode.fx = null;
          this.draggedNode.fy = null;
          this.draggedNode = null;
          this.simulation.reheat(0.1);
          this.wakeUp();
        }
        this.isPanning = false;
      });
    }

    cv.addEventListener('click', e => {
      const rect = cv.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const node = this.findNodeAt(sx, sy);

      if (node) {
        this.selectNode(node.id);
      } else {
        this.deselect();
        this.onCanvasClick();
        this.requestRender();
      }
    });

    // 滾輪縮放
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.zoomAt(sx, sy, zoomFactor);
      this.requestRender();
    }, { passive: false });

    // 觸控事件 (嚴格使用特徵偵測適配)
    cv.addEventListener('touchstart', e => {
      const rect = cv.getBoundingClientRect();
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const sx = touch.clientX - rect.left;
        const sy = touch.clientY - rect.top;

        const node = this.findNodeAt(sx, sy);
        if (node) {
          this.draggedNode = node;
          node.fx = node.x;
          node.fy = node.y;
          this.simulation.reheat(0.3);
          this.wakeUp();
        } else {
          this.isPanning = true;
          this.panStartX = sx - this.panX;
          this.panStartY = sy - this.panY;
        }
      } else if (e.touches.length === 2) {
        this.isPanning = false;
        if (this.draggedNode) {
          this.draggedNode.fx = null;
          this.draggedNode.fy = null;
          this.draggedNode = null;
        }
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: false });

    cv.addEventListener('touchmove', e => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const sx = touch.clientX - rect.left;
        const sy = touch.clientY - rect.top;

        if (this.draggedNode) {
          const { x, y } = this.screenToWorld(sx, sy);
          this.draggedNode.fx = x;
          this.draggedNode.fy = y;
          this.simulation.reheat(0.15);
          this.wakeUp();
        } else if (this.isPanning) {
          this.panX = sx - this.panStartX;
          this.panY = sy - this.panStartY;
          this.requestRender();
        }
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (this.lastTouchDist > 0 && dist > 0) {
          const zoomFactor = dist / this.lastTouchDist;
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
          this.zoomAt(midX, midY, zoomFactor);
          this.requestRender();
        }
        this.lastTouchDist = dist;
      }
    }, { passive: false });

    cv.addEventListener('touchend', e => {
      if (e.touches.length === 0) {
        if (this.draggedNode) {
          this.draggedNode.fx = null;
          this.draggedNode.fy = null;
          this.draggedNode = null;
          this.simulation.reheat(0.1);
          this.wakeUp();
        }
        this.isPanning = false;
        this.lastTouchDist = 0;
      }
    });
  }

  zoomAt(sx, sy, factor) {
    const prevZoom = this.zoom;
    const newZoom = Math.min(4.0, Math.max(0.15, prevZoom * factor));
    if (newZoom === prevZoom) return;

    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;

    const wx = (sx - cx - this.panX) / prevZoom;
    const wy = (sy - cy - this.panY) / prevZoom;

    this.zoom = newZoom;
    this.panX = sx - cx - wx * newZoom;
    this.panY = sy - cy - wy * newZoom;
  }

  selectNode(nodeId) {
    this.selectedNodeId = nodeId;
    const node = this.graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // 計算 1-Hop 鄰居與邊
    const neighbors = [];
    this.graphData.edges.forEach(e => {
      if (e.source === nodeId) {
        const targetNode = this.graphData.nodes.find(n => n.id === e.target);
        if (targetNode) neighbors.push({ node: targetNode, edge: e });
      } else if (e.target === nodeId) {
        const sourceNode = this.graphData.nodes.find(n => n.id === e.source);
        if (sourceNode) neighbors.push({ node: sourceNode, edge: e });
      }
    });

    this.onNodeSelect(node, neighbors);
    this.simulation.reheat(0.2);
    this.wakeUp();
  }

  deselect() {
    this.selectedNodeId = null;
  }

  focusOnNode(nodeId) {
    const node = this.graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    this.selectNode(nodeId);

    // 平滑平移至中央
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    this.panX = cx - node.x * this.zoom;
    this.panY = cy - node.y * this.zoom;
    this.simulation.reheat(0.2);
    this.wakeUp();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isSleeping = false;
    this.resize();

    const loop = () => {
      if (!this.isRunning) return;

      if (!this.simulation.isSettled) {
        this.simulation.tick(1);
        this.render();
        this.animFrameId = requestAnimationFrame(loop);
      } else {
        // 物理力已收斂，進入休眠，節省 100% 閒置 CPU
        this.isSleeping = true;
        this.render();
        this.animFrameId = null;
      }
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  wakeUp() {
    if (!this.isRunning) return;
    this.simulation.isSettled = false;
    if (this.isSleeping) {
      this.isSleeping = false;
      if (!this.animFrameId) {
        const loop = () => {
          if (!this.isRunning) return;
          if (!this.simulation.isSettled) {
            this.simulation.tick(1);
            this.render();
            this.animFrameId = requestAnimationFrame(loop);
          } else {
            this.isSleeping = true;
            this.render();
            this.animFrameId = null;
          }
        };
        this.animFrameId = requestAnimationFrame(loop);
      }
    }
  }

  requestRender() {
    if (this.isSleeping) {
      this.render();
    }
  }

  stop() {
    this.isRunning = false;
    this.isSleeping = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  render() {
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    // 清空背景 (沉浸深藍夜空風格)
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    const cx = width / 2;
    const cy = height / 2;
    ctx.translate(cx + this.panX, cy + this.panY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-cx, -cy);

    const selectedId = this.selectedNodeId;
    const hoveredId = this.hoveredNodeId;
    const filterGroup = this.filterGroup;

    // 判斷群組過濾集合 (Filter Group Matching)
    const isFilterActive = Boolean(filterGroup && filterGroup.type && filterGroup.type !== 'all');
    const filterMatchedSet = new Set();
    if (isFilterActive) {
      this.graphData.nodes.forEach(n => {
        let matched = false;
        if (filterGroup.type === 'category') {
          matched = n.category === filterGroup.value;
        } else if (filterGroup.type === 'tag') {
          matched = (n.tags || []).includes(filterGroup.value);
        } else if (filterGroup.type === 'entity') {
          matched = (n.entities || []).includes(filterGroup.value);
        }
        if (matched) filterMatchedSet.add(n.id);
      });
    }

    // 1. 邊線渲染 (Edges) - 區分批次繪製 (Batch) 與高亮強調 (Active)
    const normalEdges = [];
    const activeEdges = [];

    for (let i = 0; i < this.graphData.edges.length; i++) {
      const e = this.graphData.edges[i];
      const s = e.sourceNode;
      const t = e.targetNode;
      if (!s || !t) continue;

      const isConnectedToSelected = selectedId && (e.source === selectedId || e.target === selectedId);
      const isConnectedToHovered = hoveredId && (e.source === hoveredId || e.target === hoveredId);

      if (isConnectedToSelected || isConnectedToHovered) {
        activeEdges.push({ edge: e, isSelected: isConnectedToSelected });
      } else {
        normalEdges.push(e);
      }
    }

    // (1) 批次繪製一般非高亮邊線：單一 Draw Call，效能提升 10 倍以上
    if (normalEdges.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < normalEdges.length; i++) {
        const e = normalEdges[i];
        ctx.moveTo(e.sourceNode.x, e.sourceNode.y);
        ctx.lineTo(e.targetNode.x, e.targetNode.y);
      }

      if (selectedId) {
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.12)';
      } else if (isFilterActive) {
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.10)';
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      }
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // (2) 獨立繪製高亮邊線
    for (let i = 0; i < activeEdges.length; i++) {
      const { edge: e, isSelected } = activeEdges[i];
      ctx.beginPath();
      ctx.moveTo(e.sourceNode.x, e.sourceNode.y);
      ctx.lineTo(e.targetNode.x, e.targetNode.y);

      if (isSelected) {
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = Math.min(3.5, 1.8 + (e.weight || 1) * 0.3);
        ctx.shadowColor = '#818cf8';
        ctx.shadowBlur = 8;
      } else {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = Math.min(2.5, 1.2 + (e.weight || 1) * 0.2);
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#38bdf8';
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 2. 節點渲染 (Nodes)
    // 找出目前選取節點的一度關聯集合
    const neighborSet = new Set();
    if (selectedId) {
      this.graphData.edges.forEach(e => {
        if (e.source === selectedId) neighborSet.add(e.target);
        if (e.target === selectedId) neighborSet.add(e.source);
      });
    }

    const nodesToDrawText = [];

    this.graphData.nodes.forEach(n => {
      const isSelected = n.id === selectedId;
      const isHovered = n.id === hoveredId;
      const isNeighbor = neighborSet.has(n.id);
      const isFilterMatch = !isFilterActive || filterMatchedSet.has(n.id);

      let alpha = 1.0;
      if (selectedId) {
        if (!isSelected && !isNeighbor) alpha = 0.10;
      } else if (isFilterActive) {
        if (!isFilterMatch) alpha = 0.08;
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      const catName = this.categoryMap[n.category] || '';
      const baseColor = getCategoryColor(n.category, catName);
      const radius = n.radius || 6;

      // 選取或懸停光暈
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.25)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 實心節點本體
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = baseColor;
      ctx.fill();

      // 標籤候選篩選 (Obsidian 體驗：預設焦點模式下絕不干擾星空全景)
      let shouldShowText = false;
      if (isSelected || isHovered) {
        shouldShowText = true;
      } else if (isNeighbor) {
        shouldShowText = true;
      } else if (this.labelMode === 'all') {
        shouldShowText = (alpha > 0.2);
      } else if (this.zoom >= 2.0) {
        shouldShowText = (alpha > 0.2);
      }

      if (shouldShowText && alpha > 0.15) {
        nodesToDrawText.push({
          node: n,
          isSelected,
          isHovered,
          isNeighbor,
          degree: n.degree || 0,
          radius
        });
      }

      ctx.restore();
    });

    // 3. 標籤文字 (在所有節點之上繪製，嚴格執行 AABB 空間包圍盒防重疊演算法)
    if (nodesToDrawText.length > 0) {
      const fontSize = Math.max(10, Math.min(13, 11 / Math.sqrt(this.zoom)));
      ctx.font = `500 ${fontSize}px "Noto Sans TC", -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 依重要度降冪排序：選取(1000) > 懸停(500) > 一度鄰居(100) > 節點度數
      nodesToDrawText.sort((a, b) => {
        const scoreA = (a.isSelected ? 1000 : 0) + (a.isHovered ? 500 : 0) + (a.isNeighbor ? 100 : 0) + a.degree;
        const scoreB = (b.isSelected ? 1000 : 0) + (b.isHovered ? 500 : 0) + (b.isNeighbor ? 100 : 0) + b.degree;
        return scoreB - scoreA;
      });

      const drawnRects = [];

      for (let i = 0; i < nodesToDrawText.length; i++) {
        const item = nodesToDrawText[i];
        const n = item.node;
        const rawTitle = n.title || '無標題';
        const title = rawTitle.length > 18 ? rawTitle.substring(0, 17) + '…' : rawTitle;

        const metrics = ctx.measureText(title);
        const textW = metrics.width;
        const textH = fontSize + 4;
        const boxX = n.x - textW / 2 - 4;
        const boxY = n.y + item.radius + 4;
        const boxW = textW + 8;
        const boxH = textH;

        // AABB 碰撞檢測：選取與懸停強制繪製，其餘重疊標籤自動剔除防撞字
        const rect = { x1: boxX - 2, y1: boxY - 2, x2: boxX + boxW + 2, y2: boxY + boxH + 2 };
        const isHighPriority = item.isSelected || item.isHovered;

        const hasCollision = drawnRects.some(r =>
          !(rect.x2 < r.x1 || rect.x1 > r.x2 || rect.y2 < r.y1 || rect.y1 > r.y2)
        );

        if (hasCollision && !isHighPriority) {
          continue;
        }

        drawnRects.push(rect);

        // 繪製背景膠囊底襯
        ctx.fillStyle = item.isSelected ? 'rgba(30, 41, 59, 0.95)' : 'rgba(15, 23, 42, 0.84)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(boxX, boxY, boxW, boxH, 4);
        } else {
          ctx.rect(boxX, boxY, boxW, boxH);
        }
        ctx.fill();

        if (item.isSelected) {
          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // 文字色彩
        if (item.isSelected) {
          ctx.fillStyle = '#ffffff';
        } else if (item.isHovered) {
          ctx.fillStyle = '#38bdf8';
        } else if (item.isNeighbor) {
          ctx.fillStyle = '#f1f5f9';
        } else {
          ctx.fillStyle = '#cbd5e1';
        }

        ctx.fillText(title, n.x, boxY + boxH / 2);
      }
    }

    ctx.restore();
  }
}
