/**
 * 2D 物理力導向模擬引擎 (ForceSimulation2D)
 * 專為知識圖譜設計之星系級力導向佈局，具備：
 * 1. 多核心群落引力場 (Multi-Focal Cluster Centers) - 打造如 PCA/UMAP 般鮮明分立的知識群島
 * 2. 異族超距斥力倍率與海峽緩衝屏障 (Inter-Cluster Barrier) - 杜絕板塊聚合成單一晶格球體
 * 3. ForceAtlas2 LinLog 對數彈簧引力 (Logarithmic Link Force) - 區分島內緊實與跨島長距柔性連線
 * 4. 節點度數自適應斥力 (Degree-Adaptive Repulsion) - 核心節點自然向外傘狀展開
 * 5. 硬性剛體防重疊碰撞約束 (Hard Collision Separation) 與自適應休眠
 * 6. 全局質心平移校正 (Center of Mass Translation) - 消除向心坍縮，徹底打破圓球詛咒
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

    // 物理力參數：強調群島分立、異族強斥力、對數彈簧引力
    this.chargeStrength = -260;
    this.linkDistance = 75;
    this.linkStrength = 0.06;
    this.clusterStrength = 0.035; // 群落向心力，將節點緊實吸附於各自的星系核心
    this.collisionPadding = 18;

    this.isSettled = false;
    this.nodeMap = new Map();
    this.clusterCenters = new Map();
    this.clusterRadii = new Map();
    this.clusterCounts = new Map();

    this.init();
  }

  init() {
    const cx = this.width / 2;
    const cy = this.height / 2;

    // 1. 統計各分類節點數，計算各自島嶼預估半徑 R = sqrt(N) * spacing
    this.clusterCounts.clear();
    this.clusterRadii.clear();
    this.nodes.forEach(n => {
      const cat = n.category || 'inbox';
      this.clusterCounts.set(cat, (this.clusterCounts.get(cat) || 0) + 1);
    });

    const categories = Array.from(this.clusterCounts.keys());
    const numClusters = Math.max(1, categories.length);

    categories.forEach(cat => {
      const count = this.clusterCounts.get(cat) || 1;
      const r = Math.max(65, Math.sqrt(count) * 22);
      this.clusterRadii.set(cat, r);
    });

    // 2. 佈設群落錨點：採用寬幅橢圓軌道 (依畫布長寬比展開)
    const orbitRx = Math.max(380, this.width * 0.36);
    const orbitRy = Math.max(260, this.height * 0.34);

    this.clusterCenters.clear();
    categories.forEach((cat, idx) => {
      if (numClusters === 1) {
        this.clusterCenters.set(cat, { x: cx, y: cy });
      } else {
        const angle = (idx / numClusters) * Math.PI * 2 - Math.PI / 2;
        this.clusterCenters.set(cat, {
          x: cx + Math.cos(angle) * orbitRx,
          y: cy + Math.sin(angle) * orbitRy
        });
      }
    });

    // 群落錨點間距鬆弛 (Relaxation)：確保任意兩島核心間距 >= Ra + Rb + 140px
    const minBuffer = 140;
    for (let step = 0; step < 30; step++) {
      for (let i = 0; i < categories.length; i++) {
        for (let j = i + 1; j < categories.length; j++) {
          const cA = categories[i];
          const cB = categories[j];
          const fA = this.clusterCenters.get(cA);
          const fB = this.clusterCenters.get(cB);
          const rA = this.clusterRadii.get(cA);
          const rB = this.clusterRadii.get(cB);
          const reqDist = rA + rB + minBuffer;

          let dx = fB.x - fA.x;
          let dy = fB.y - fA.y;
          let d = Math.hypot(dx, dy) || 1;
          if (d < reqDist) {
            const overlap = (reqDist - d) * 0.5;
            const pushX = (dx / d) * overlap;
            const pushY = (dy / d) * overlap;
            fA.x -= pushX;
            fA.y -= pushY;
            fB.x += pushX;
            fB.y += pushY;
          }
        }
      }
    }

    // 3. 節點座標初始化：依所屬星系核心圍繞展開，起手即呈群島分立
    const clusterIndexCount = new Map();
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    this.nodes.forEach(node => {
      this.nodeMap.set(node.id, node);
      const cat = node.category || 'inbox';
      const focal = this.clusterCenters.get(cat) || { x: cx, y: cy };

      if (typeof node.x !== 'number') {
        const cIdx = clusterIndexCount.get(cat) || 0;
        clusterIndexCount.set(cat, cIdx + 1);

        const dist = 12 + Math.sqrt(cIdx + 1) * 18;
        const angle = cIdx * goldenAngle;
        node.x = focal.x + Math.cos(angle) * dist;
        node.y = focal.y + Math.sin(angle) * dist;
      }
      if (typeof node.vx !== 'number') node.vx = 0;
      if (typeof node.vy !== 'number') node.vy = 0;
      if (!node.radius) node.radius = 6;
    });

    // 4. 建立邊線對象引用
    this.edges.forEach(edge => {
      edge.sourceNode = this.nodeMap.get(edge.source);
      edge.targetNode = this.nodeMap.get(edge.target);
    });

    this.isSettled = false;
  }

  tick(iterations = 1) {
    for (let iter = 0; iter < iterations; iter++) {
      const isSimulating = this.alpha >= this.alphaMin;
      const nodes = this.nodes;
      const numNodes = nodes.length;

      if (isSimulating) {
        // 1. 度數自適應庫倫斥力 + 異族強斥力 + 異群海峽緩衝屏障 + 硬碰撞分離
        for (let i = 0; i < numNodes; i++) {
          const nodeA = nodes[i];
          const rA = nodeA.radius || 6;
          const degFactorA = 1 + Math.sqrt(nodeA.degree || 1) * 0.35;

          for (let j = i + 1; j < numNodes; j++) {
            const nodeB = nodes[j];
            const rB = nodeB.radius || 6;
            const degFactorB = 1 + Math.sqrt(nodeB.degree || 1) * 0.35;

            let dx = nodeB.x - nodeA.x;
            let dy = nodeB.y - nodeA.y;
            let distSq = dx * dx + dy * dy;
            if (distSq === 0) {
              dx = (Math.random() - 0.5) * 2;
              dy = (Math.random() - 0.5) * 2;
              distSq = dx * dx + dy * dy;
            }
            const dist = Math.sqrt(distSq);

            const isSameCategory = nodeA.category === nodeB.category;

            // (1) 庫倫斥力：同族凝聚（0.35），異族倍率排斥（1.4，相當於 4 倍強斥力）
            if (dist < 600) {
              const clusterRepulsionMultiplier = isSameCategory ? 0.35 : 1.4;
              const effectiveCharge = this.chargeStrength * degFactorA * degFactorB * clusterRepulsionMultiplier;
              const force = (effectiveCharge * this.alpha) / Math.max(30, distSq);
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;

              nodeA.vx -= fx;
              nodeA.vy -= fy;
              nodeB.vx += fx;
              nodeB.vy += fy;
            }

            // (2) 異群海峽緩衝屏障 (Inter-Cluster Strait Barrier)
            // 杜絕不同島嶼的邊界節點貼合融合為單一大球
            if (!isSameCategory && dist < 120) {
              const barrierPush = ((120 - dist) / dist) * 0.3 * this.alpha;
              const bx = dx * barrierPush;
              const by = dy * barrierPush;
              nodeA.vx -= bx;
              nodeA.vy -= by;
              nodeB.vx += bx;
              nodeB.vy += by;
            }

            // (3) 硬性碰撞避免 (Collision Constraint - 杜絕節點疊合葡萄串)
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

        // 2. ForceAtlas2 LinLog 對數彈簧引力：區分島內緊實連線與跨島長距彈性橋樑
        for (let i = 0; i < this.edges.length; i++) {
          const edge = this.edges[i];
          const source = edge.sourceNode;
          const target = edge.targetNode;
          if (!source || !target) continue;

          let dx = target.x - source.x;
          let dy = target.y - source.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const isSameCategory = source.category && target.category && source.category === target.category;

          let desiredDist, edgeStrength;
          if (isSameCategory) {
            // 同島連線：短距緊實，維持島嶼內部凝聚度
            desiredDist = Math.max(40, this.linkDistance - (edge.weight || 1) * 3);
            edgeStrength = this.linkStrength;
          } else {
            // 跨島連線：超長跨海大橋，彈力極其微弱柔和，絕不將不同板塊暴力拉近碰撞
            desiredDist = Math.max(280, this.linkDistance * 4.0);
            edgeStrength = this.linkStrength * 0.08;
          }

          let displacement;
          if (dist > desiredDist) {
            displacement = desiredDist * Math.log(1 + (dist - desiredDist) / desiredDist);
          } else {
            displacement = dist - desiredDist;
          }

          const force = displacement * edgeStrength * this.alpha;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          source.vx += fx;
          source.vy += fy;
          target.vx -= fx;
          target.vy -= fy;
        }

        // 3. 多核心群落向心引力 (Multi-Focal Cluster Attraction)
        for (let i = 0; i < numNodes; i++) {
          const node = nodes[i];
          const cat = node.category || 'inbox';
          const focal = this.clusterCenters.get(cat);
          if (!focal) continue;

          const fdx = focal.x - node.x;
          const fdy = focal.y - node.y;
          node.vx += fdx * this.clusterStrength * this.alpha;
          node.vy += fdy * this.clusterStrength * this.alpha;
        }

        // 4. 全局質心平移修正 (防止整體飄出視界，絕不在內部向心擠壓)
        let totalX = 0, totalY = 0;
        for (let i = 0; i < numNodes; i++) {
          totalX += nodes[i].x;
          totalY += nodes[i].y;
        }
        const meanX = totalX / numNodes;
        const meanY = totalY / numNodes;
        const cx = this.width / 2;
        const cy = this.height / 2;
        const driftX = (cx - meanX) * 0.002 * this.alpha;
        const driftY = (cy - meanY) * 0.002 * this.alpha;
        for (let i = 0; i < numNodes; i++) {
          nodes[i].vx += driftX;
          nodes[i].vy += driftY;
        }

        this.alpha -= this.alphaDecay;
      }

      // 5. 更新位置與速度阻尼
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
 * 將 16 進位色碼轉為 RGBA 字串
 */
export function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length < 7) {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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

  fitToView(padding = 70) {
    if (!this.graphData.nodes || this.graphData.nodes.length === 0) return;
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 600;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < this.graphData.nodes.length; i++) {
      const n = this.graphData.nodes[i];
      if (typeof n.x === 'number' && typeof n.y === 'number') {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
    }

    if (!isFinite(minX)) return;

    const graphW = Math.max(100, maxX - minX);
    const graphH = Math.max(100, maxY - minY);
    const availW = Math.max(100, width - padding * 2);
    const availH = Math.max(100, height - padding * 2);

    const targetZoom = Math.min(1.05, Math.min(availW / graphW, availH / graphH));
    this.zoom = Math.max(0.35, targetZoom);

    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;
    const cx = width / 2;
    const cy = height / 2;

    this.panX = (cx - graphCenterX) * this.zoom;
    this.panY = (cy - graphCenterY) * this.zoom;
    this.requestRender();
  }

  centerView() {
    this.fitToView();
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
    this.panX = (cx - node.x) * this.zoom;
    this.panY = (cy - node.y) * this.zoom;
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

    // 0. 繪製多核心群落島嶼背景星雲微光與名稱標註 (Ambient Galaxy Nebulae & Island Watermarks)
    if (this.simulation.clusterCenters && this.simulation.clusterCenters.size > 1) {
      ctx.save();
      for (const [cat, focal] of this.simulation.clusterCenters.entries()) {
        const catName = this.categoryMap[cat] || cat;
        const color = getCategoryColor(cat, catName);
        const radius = this.simulation.clusterRadii?.get(cat) || 120;
        const count = this.simulation.clusterCounts?.get(cat) || 0;

        let alpha = 1.0;
        if (isFilterActive) {
          alpha = (filterGroup.type === 'category' && filterGroup.value === cat) ? 1.0 : 0.12;
        }

        ctx.globalAlpha = alpha;

        // 背景星雲微光 (Ambient Nebula Glow)
        const glow = ctx.createRadialGradient(focal.x, focal.y, 10, focal.x, focal.y, radius * 1.15);
        glow.addColorStop(0, hexToRgba(color, 0.09));
        glow.addColorStop(0.65, hexToRgba(color, 0.03));
        glow.addColorStop(1, 'rgba(11, 15, 25, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(focal.x, focal.y, radius * 1.15, 0, Math.PI * 2);
        ctx.fill();

        // 群落星系浮水印標題 (Island Title Watermark)
        const titleFontSize = Math.max(12, Math.min(16, 14 / Math.sqrt(this.zoom)));
        ctx.font = `700 ${titleFontSize}px "Noto Sans TC", -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = hexToRgba(color, 0.45);
        const label = count > 0 ? `${catName} (${count})` : catName;
        ctx.fillText(label, focal.x, focal.y - radius - 8);
      }
      ctx.restore();
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
