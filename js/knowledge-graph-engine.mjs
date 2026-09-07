/**
 * 2D 物理力導向模擬引擎 (ForceSimulation2D)
 */
export class ForceSimulation2D {
  constructor({ nodes = [], edges = [], width = 800, height = 600 } = {}) {
    this.nodes = nodes;
    this.edges = edges;
    this.width = width;
    this.height = height;

    this.alpha = 1.0;
    this.alphaMin = 0.001;
    this.alphaDecay = 0.02;
    this.velocityDecay = 0.88;

    this.chargeStrength = -140;
    this.linkDistance = 90;
    this.linkStrength = 0.25;
    this.centerStrength = 0.06;

    this.nodeMap = new Map();

    this.init();
  }

  init() {
    const cx = this.width / 2;
    const cy = this.height / 2;

    this.nodes.forEach((node, idx) => {
      this.nodeMap.set(node.id, node);
      if (typeof node.x !== 'number') {
        // 初始呈環狀散開
        const angle = (idx / Math.max(1, this.nodes.length)) * Math.PI * 2;
        const dist = 50 + Math.random() * 200;
        node.x = cx + Math.cos(angle) * dist;
        node.y = cy + Math.sin(angle) * dist;
      }
      if (typeof node.vx !== 'number') node.vx = 0;
      if (typeof node.vy !== 'number') node.vy = 0;
      if (!node.radius) node.radius = 8;
    });

    // 建立邊線對象引用
    this.edges.forEach(edge => {
      edge.sourceNode = this.nodeMap.get(edge.source);
      edge.targetNode = this.nodeMap.get(edge.target);
    });
  }

  tick(iterations = 1) {
    for (let iter = 0; iter < iterations; iter++) {
      if (this.alpha < this.alphaMin) return;

      const cx = this.width / 2;
      const cy = this.height / 2;
      const nodes = this.nodes;
      const numNodes = nodes.length;

      // 1. 節點間相互斥力 (Charge Repulsion)
      for (let i = 0; i < numNodes; i++) {
        const nodeA = nodes[i];
        for (let j = i + 1; j < numNodes; j++) {
          const nodeB = nodes[j];
          let dx = nodeB.x - nodeA.x;
          let dy = nodeB.y - nodeA.y;
          let distSq = dx * dx + dy * dy;
          if (distSq === 0) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            distSq = dx * dx + dy * dy;
          }
          const dist = Math.sqrt(distSq);
          if (dist < 500) {
            // 庫倫斥力
            const force = (this.chargeStrength * this.alpha) / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            nodeA.vx -= fx;
            nodeA.vy -= fy;
            nodeB.vx += fx;
            nodeB.vy += fy;
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

        // 依權重適當縮短距離
        const desiredDist = Math.max(40, this.linkDistance - (edge.weight || 1) * 2);
        const displacement = dist - desiredDist;
        const force = displacement * this.linkStrength * this.alpha;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      // 3. 中心重力 (Center Gravity)
      for (let i = 0; i < numNodes; i++) {
        const node = nodes[i];
        const dx = cx - node.x;
        const dy = cy - node.y;
        node.vx += dx * this.centerStrength * this.alpha;
        node.vy += dy * this.centerStrength * this.alpha;
      }

      // 4. 更新位置與速度阻尼
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
        }
      }

      this.alpha -= this.alphaDecay;
    }
  }

  reheat(targetAlpha = 0.4) {
    this.alpha = Math.max(this.alpha, targetAlpha);
  }
}

/**
 * 2D 知識圖譜畫布渲染與手勢互動控制器 (KnowledgeGraphViewer)
 */
export class KnowledgeGraphViewer {
  constructor({
    canvas,
    graphData,
    onNodeSelect = () => {},
    onCanvasClick = () => {}
  }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.graphData = graphData;
    this.onNodeSelect = onNodeSelect;
    this.onCanvasClick = onCanvasClick;

    // 視圖變換 (Pan & Zoom)
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    // 狀態
    this.selectedNodeId = null;
    this.hoveredNodeId = null;
    this.draggedNode = null;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // 多點觸控縮放
    this.lastTouchDist = 0;

    // 動畫循環控制
    this.isRunning = false;
    this.animFrameId = null;

    // 裝置特徵偵測
    this.isTouchDevice = typeof window !== 'undefined' &&
      (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));

    this.hitPadding = this.isTouchDevice ? 14 : 6;

    // 初始化物理引擎
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 600;
    this.simulation = new ForceSimulation2D({
      nodes: this.graphData.nodes,
      edges: this.graphData.edges,
      width,
      height
    });

    // 預先暖機 40 步讓佈局自然展開
    this.simulation.tick(40);

    // 居中對齊
    this.centerView();

    this.bindEvents();
  }

  centerView() {
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 600;
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
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
      const hitRadius = (n.radius || 8) + this.hitPadding / this.zoom;
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
        this.simulation.reheat();
      } else {
        this.isPanning = true;
        this.panStartX = sx - this.panX;
        this.panStartY = sy - this.panY;
      }
    });

    window.addEventListener('mousemove', e => {
      const rect = cv.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.draggedNode) {
        const { x, y } = this.screenToWorld(sx, sy);
        this.draggedNode.fx = x;
        this.draggedNode.fy = y;
        this.simulation.reheat(0.1);
        return;
      }

      if (this.isPanning) {
        this.panX = sx - this.panStartX;
        this.panY = sy - this.panStartY;
        return;
      }

      // 懸停偵測
      if (!this.isTouchDevice) {
        const hovered = this.findNodeAt(sx, sy);
        const nextHoverId = hovered ? hovered.id : null;
        if (nextHoverId !== this.hoveredNodeId) {
          this.hoveredNodeId = nextHoverId;
          cv.style.cursor = hovered ? 'pointer' : 'default';
        }
      }
    });

    window.addEventListener('mouseup', e => {
      if (this.draggedNode) {
        this.draggedNode.fx = null;
        this.draggedNode.fy = null;
        this.draggedNode = null;
      }
      this.isPanning = false;
    });

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
          this.simulation.reheat();
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
          this.simulation.reheat(0.1);
        } else if (this.isPanning) {
          this.panX = sx - this.panStartX;
          this.panY = sy - this.panStartY;
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

    // 縮放錨點保持
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
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.resize();

    const loop = () => {
      if (!this.isRunning) return;
      this.simulation.tick(1);
      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop() {
    this.isRunning = false;
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

    // 1. 繪製連線 (Edges)
    const selectedId = this.selectedNodeId;
    const hoveredId = this.hoveredNodeId;

    this.graphData.edges.forEach(e => {
      const s = e.sourceNode;
      const t = e.targetNode;
      if (!s || !t) return;

      const isConnectedToSelected = selectedId && (e.source === selectedId || e.target === selectedId);
      const isConnectedToHovered = hoveredId && (e.source === hoveredId || e.target === hoveredId);

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);

      if (isConnectedToSelected) {
        ctx.strokeStyle = '#6366f1'; // Indigo
        ctx.lineWidth = Math.min(4, 1.5 + (e.weight || 1) * 0.4);
        ctx.shadowColor = '#818cf8';
        ctx.shadowBlur = 8;
      } else if (isConnectedToHovered) {
        ctx.strokeStyle = '#38bdf8'; // Sky
        ctx.lineWidth = Math.min(3, 1 + (e.weight || 1) * 0.3);
        ctx.shadowBlur = 0;
      } else if (selectedId) {
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.12)';
        ctx.lineWidth = 0.8;
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = Math.min(2.5, 0.6 + (e.weight || 1) * 0.2);
        ctx.shadowBlur = 0;
      }

      ctx.stroke();
      ctx.shadowBlur = 0; // 重置
    });

    // 2. 繪製節點 (Nodes)
    const categoryColors = {
      learning: '#38bdf8', // 藍
      bookmarks: '#818cf8', // 紫
      todos: '#34d399', // 綠
      ideas: '#fbbf24', // 黃
      inbox: '#94a3b8' // 灰
    };

    this.graphData.nodes.forEach(n => {
      const isSelected = n.id === selectedId;
      const isHovered = n.id === hoveredId;
      const isNeighbor = selectedId && this.graphData.edges.some(e =>
        (e.source === selectedId && e.target === n.id) ||
        (e.target === selectedId && e.source === n.id)
      );

      let alpha = 1.0;
      if (selectedId && !isSelected && !isNeighbor) {
        alpha = 0.15;
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      const baseColor = categoryColors[n.category] || '#a855f7';
      const radius = n.radius || 8;

      // 選取光暈
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
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

      // 節點實心圓
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = baseColor;
      ctx.fill();

      // 標籤文字 (縮放 > 0.6 或重要節點才顯示，避免凌亂)
      const shouldDrawLabel = this.zoom > 0.7 || isSelected || isHovered || isNeighbor || n.degree >= 5;
      if (shouldDrawLabel && alpha > 0.2) {
        ctx.font = `${Math.max(10, 11 / Math.sqrt(this.zoom))}px "Noto Sans TC", sans-serif`;
        ctx.fillStyle = isSelected ? '#ffffff' : (isNeighbor ? '#e2e8f0' : '#94a3b8');
        ctx.textAlign = 'center';
        ctx.fillText(n.title.substring(0, 16), n.x, n.y + radius + 12);
      }

      ctx.restore();
    });

    ctx.restore();
  }
}
