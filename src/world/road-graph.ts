import type { RoadNetwork, RoadNetworkSegment } from './types';

export type AgentMode = 'vehicle' | 'pedestrian';

export interface GraphSegment {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly length: number;
  readonly speed: number;
  readonly walkable: boolean;
  readonly drivable: boolean;
  readonly forwardAllowed: boolean;
  readonly reverseAllowed: boolean;
  /** True for a one-way closed OSM way that forms a roundabout. */
  readonly roundabout: boolean;
}

export interface NearestSegment {
  readonly segment: number;
  readonly distance: number;
  readonly x: number;
  readonly z: number;
  readonly progress: number;
  readonly fromIsStart: boolean;
}

const CELL_METERS = 48;
const NO_NODE = -1;

function vehicleSpeed(segment: RoadNetworkSegment): number {
  if (segment.maxSpeedKph !== null) return Math.min(segment.maxSpeedKph / 3.6, 16);
  if (segment.highway === 'residential' || segment.highway === 'service') return 8;
  if (segment.highway === 'pedestrian' || segment.highway === 'footway') return 4;
  return 12;
}

/** Minimal binary heap reused by successive A* searches to avoid per-route allocations. */
class MinHeap {
  private readonly nodes: number[] = [];
  private readonly costs: number[] = [];

  clear(): void {
    this.nodes.length = 0;
    this.costs.length = 0;
  }

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, cost: number): void {
    let index = this.nodes.length;
    this.nodes.push(node);
    this.costs.push(cost);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if ((this.costs[parent] ?? Infinity) <= cost) break;
      this.nodes[index] = this.nodes[parent] ?? node;
      this.costs[index] = this.costs[parent] ?? cost;
      index = parent;
    }
    this.nodes[index] = node;
    this.costs[index] = cost;
  }

  pop(): number {
    const result = this.nodes[0] ?? NO_NODE;
    const lastNode = this.nodes.pop() ?? NO_NODE;
    const lastCost = this.costs.pop() ?? Infinity;
    if (this.nodes.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= this.nodes.length) break;
        const right = left + 1;
        const child =
          right < this.nodes.length &&
          (this.costs[right] ?? Infinity) < (this.costs[left] ?? Infinity)
            ? right
            : left;
        if ((this.costs[child] ?? Infinity) >= lastCost) break;
        this.nodes[index] = this.nodes[child] ?? NO_NODE;
        this.costs[index] = this.costs[child] ?? Infinity;
        index = child;
      }
      this.nodes[index] = lastNode;
      this.costs[index] = lastCost;
    }
    return result;
  }
}

/**
 * Directed view of the OSM-derived road network. Vehicles use one-way rules and
 * drivable highways; pedestrians use walkable segments in both directions.
 */
export class RoadGraph {
  readonly nodeCount: number;
  readonly segmentCount: number;
  readonly segments: GraphSegment[] = [];
  readonly nodeX: Float32Array;
  readonly nodeZ: Float32Array;
  readonly roundaboutNodes: Uint8Array;
  private readonly nodeIndex = new Map<string, number>();
  private readonly graphIndexByRaw = new Map<number, number>();
  private readonly vehicleOut: number[][] = [];
  private readonly pedestrianOut: number[][] = [];
  private readonly segmentCells = new Map<number, number[]>();
  private readonly heap = new MinHeap();
  private readonly costs: Float64Array;
  private readonly costStamps: Uint32Array;
  private readonly previous: Int32Array;
  private readonly closed: Uint32Array;
  private searchGeneration = 0;

  constructor(network: RoadNetwork) {
    this.nodeCount = network.nodes.length;
    this.segmentCount = network.segments.length;
    this.nodeX = new Float32Array(this.nodeCount);
    this.nodeZ = new Float32Array(this.nodeCount);
    this.roundaboutNodes = new Uint8Array(this.nodeCount);
    this.costs = new Float64Array(this.nodeCount);
    this.costStamps = new Uint32Array(this.nodeCount);
    this.previous = new Int32Array(this.nodeCount);
    this.closed = new Uint32Array(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i += 1) {
      const node = network.nodes[i];
      if (!node) continue;
      this.nodeX[i] = node.position[0];
      this.nodeZ[i] = node.position[1];
      this.nodeIndex.set(node.id, i);
      this.vehicleOut.push([]);
      this.pedestrianOut.push([]);
    }

    // Validate endpoints once so roundabout detection and segment construction
    // share the same index mapping.
    const validRawIndices: number[] = [];
    for (let rawIndex = 0; rawIndex < this.segmentCount; rawIndex += 1) {
      const raw = network.segments[rawIndex];
      if (!raw) continue;
      const from = this.nodeIndex.get(raw.fromNode);
      const to = this.nodeIndex.get(raw.toNode);
      if (from === undefined || to === undefined || from === to) continue;
      validRawIndices.push(rawIndex);
      this.graphIndexByRaw.set(rawIndex, this.segments.length);
    }
    const roundabouts = this.detectRoundabouts(network, validRawIndices);

    for (const rawIndex of validRawIndices) {
      const raw = network.segments[rawIndex];
      if (!raw) continue;
      const from = this.nodeIndex.get(raw.fromNode);
      const to = this.nodeIndex.get(raw.toNode);
      if (from === undefined || to === undefined) continue;
      const roundabout = roundabouts.has(this.graphIndexByRaw.get(rawIndex) ?? -1);
      const baseSpeed = vehicleSpeed(raw);
      const segment: GraphSegment = {
        id: raw.id,
        from,
        to,
        length: Math.max(raw.lengthMeters, 0.01),
        speed: roundabout ? Math.min(baseSpeed, 5.5) : baseSpeed,
        walkable: raw.walkable,
        drivable: raw.laneCount > 0,
        forwardAllowed: raw.forwardAllowed,
        reverseAllowed: raw.reverseAllowed,
        roundabout,
      };
      const index = this.segments.length;
      this.segments.push(segment);
      if (roundabout) {
        this.roundaboutNodes[from] = 1;
        this.roundaboutNodes[to] = 1;
      }
      if (segment.walkable) {
        this.pedestrianOut[from]?.push(index * 2);
        this.pedestrianOut[to]?.push(index * 2 + 1);
      }
      if (segment.drivable) {
        if (segment.forwardAllowed) this.vehicleOut[from]?.push(index * 2);
        if (segment.reverseAllowed) this.vehicleOut[to]?.push(index * 2 + 1);
      }
      this.indexSegment(index, segment);
    }
  }

  nodePosition(node: number): readonly [number, number] {
    return [this.nodeX[node] ?? 0, this.nodeZ[node] ?? 0];
  }

  /** Returns the node at the far end of a directed edge. */
  edgeDestination(edge: number): number {
    const segment = this.segments[edge >> 1];
    if (!segment) return NO_NODE;
    return (edge & 1) === 0 ? segment.to : segment.from;
  }

  edgeLength(edge: number): number {
    return this.segments[edge >> 1]?.length ?? 1;
  }

  edgeSegment(edge: number): number {
    return edge >> 1;
  }

  isRoundaboutEdge(edge: number): boolean {
    return this.segments[edge >> 1]?.roundabout === true;
  }

  isRoundaboutNode(node: number): boolean {
    return this.roundaboutNodes[node] === 1;
  }

  outgoingEdges(node: number, mode: AgentMode): readonly number[] {
    return (mode === 'pedestrian' ? this.pedestrianOut[node] : this.vehicleOut[node]) ?? [];
  }

  nearestSegment(x: number, z: number, mode: AgentMode): NearestSegment | undefined {
    let best: NearestSegment | undefined;
    const search = (cellX: number, cellZ: number): void => {
      for (const index of this.segmentCells.get((cellX + 4096) * 8192 + cellZ + 4096) ?? []) {
        const segment = this.segments[index];
        if (!segment || !this.accepts(segment, mode)) continue;
        const candidate = this.projectOntoSegment(x, z, segment, index);
        if (!best || candidate.distance < best.distance) best = candidate;
      }
    };
    const baseX = Math.floor(x / CELL_METERS);
    const baseZ = Math.floor(z / CELL_METERS);
    for (let radius = 0; radius <= 5 && !best; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
          search(baseX + dx, baseZ + dz);
        }
      }
    }
    if (best) return best;
    // Sparse rural areas can fall outside every populated cell near the player.
    for (let index = 0; index < this.segments.length; index += 1) {
      const segment = this.segments[index];
      if (!segment || !this.accepts(segment, mode)) continue;
      const candidate = this.projectOntoSegment(x, z, segment, index);
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    return best;
  }

  nearestNode(x: number, z: number, mode: AgentMode): number {
    const nearest = this.nearestSegment(x, z, mode);
    if (!nearest) return NO_NODE;
    const segment = this.segments[nearest.segment];
    if (!segment) return NO_NODE;
    const direct = nearest.fromIsStart ? segment.from : segment.to;
    const candidate = nearest.fromIsStart ? segment.to : segment.from;
    return this.outgoingEdges(direct, mode).length > 0 ? direct : candidate;
  }

  /** A* over directed edges; returns node indices including both endpoints. */
  route(from: number, to: number, mode: AgentMode): number[] {
    if (from === to || from < 0 || to < 0 || from >= this.nodeCount || to >= this.nodeCount)
      return [];
    const generation = ++this.searchGeneration;
    this.heap.clear();
    this.costs[from] = 0;
    this.costStamps[from] = generation;
    this.previous[from] = NO_NODE;
    this.closed[from] = 0;
    this.heap.push(from, this.heuristic(from, to));
    while (this.heap.size > 0) {
      const current = this.heap.pop();
      if (current === NO_NODE) break;
      if (this.closed[current] === generation) continue;
      this.closed[current] = generation;
      if (current === to) return this.reconstruct(from, to);
      const currentCost =
        this.costStamps[current] === generation ? (this.costs[current] ?? Infinity) : Infinity;
      for (const edge of this.outgoingEdges(current, mode)) {
        const next = this.edgeDestination(edge);
        if (next === NO_NODE || this.closed[next] === generation) continue;
        const cost = currentCost + this.edgeLength(edge);
        const known =
          this.costStamps[next] === generation ? (this.costs[next] ?? Infinity) : Infinity;
        if (cost >= known) continue;
        this.costs[next] = cost;
        this.costStamps[next] = generation;
        this.previous[next] = current;
        this.heap.push(next, cost + this.heuristic(next, to));
      }
    }
    return [];
  }

  /**
   * OSM encodes roundabout circulation as a short, one-way closed way. Detecting
   * that topology locally avoids inventing a junction tag and keeps the AI from
   * treating every segment of a roundabout as a fresh intersection.
   */
  private detectRoundabouts(network: RoadNetwork, validRawIndices: readonly number[]): Set<number> {
    const byWay = new Map<string, number[]>();
    for (const rawIndex of validRawIndices) {
      const raw = network.segments[rawIndex];
      if (!raw) continue;
      const group = byWay.get(raw.wayId) ?? [];
      group.push(rawIndex);
      byWay.set(raw.wayId, group);
    }

    const result = new Set<number>();
    for (const candidates of byWay.values()) {
      if (candidates.length < 4 || candidates.length > 40) continue;
      let totalLength = 0;
      const drivable = candidates.every((rawIndex) => {
        const raw = network.segments[rawIndex];
        if (!raw || raw.laneCount <= 0 || raw.oneWay === 0) return false;
        totalLength += raw.lengthMeters;
        return true;
      });
      if (!drivable || totalLength < 20 || totalLength > 400) continue;

      const incident = new Map<string, number[]>();
      for (const rawIndex of candidates) {
        const raw = network.segments[rawIndex];
        if (!raw) continue;
        const from = incident.get(raw.fromNode) ?? [];
        from.push(rawIndex);
        incident.set(raw.fromNode, from);
        const to = incident.get(raw.toNode) ?? [];
        to.push(rawIndex);
        incident.set(raw.toNode, to);
      }

      const start = network.segments[candidates[0] ?? -1]?.fromNode;
      if (start === undefined) continue;
      const used = new Set<number>();
      let current = start;
      let direction = 0;
      let closed = false;
      while (used.size <= candidates.length) {
        const next = (incident.get(current) ?? []).find((index) => !used.has(index));
        if (next === undefined) break;
        used.add(next);
        const raw = network.segments[next];
        if (!raw) break;
        const step = raw.fromNode === current ? 1 : -1;
        if (direction === 0) direction = step;
        else if (step !== direction) break;
        current = step === 1 ? raw.toNode : raw.fromNode;
        if (current === start) {
          closed = true;
          break;
        }
      }
      if (!closed || used.size !== candidates.length) continue;

      for (const rawIndex of candidates) {
        const graphIndex = this.graphIndexByRaw.get(rawIndex);
        if (graphIndex !== undefined) result.add(graphIndex);
      }
    }
    return result;
  }

  private accepts(segment: GraphSegment, mode: AgentMode): boolean {
    return mode === 'pedestrian' ? segment.walkable : segment.drivable;
  }

  private projectOntoSegment(
    x: number,
    z: number,
    segment: GraphSegment,
    index: number,
  ): NearestSegment {
    const ax = this.nodeX[segment.from] ?? 0;
    const az = this.nodeZ[segment.from] ?? 0;
    const bx = this.nodeX[segment.to] ?? 0;
    const bz = this.nodeZ[segment.to] ?? 0;
    const dx = bx - ax;
    const dz = bz - az;
    const squared = dx * dx + dz * dz;
    const progress =
      squared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / squared)) : 0;
    const pointX = ax + dx * progress;
    const pointZ = az + dz * progress;
    return {
      segment: index,
      distance: Math.hypot(x - pointX, z - pointZ),
      x: pointX,
      z: pointZ,
      progress,
      fromIsStart: progress < 0.5,
    };
  }

  private indexSegment(index: number, segment: GraphSegment): void {
    const ax = this.nodeX[segment.from] ?? 0;
    const az = this.nodeZ[segment.from] ?? 0;
    const bx = this.nodeX[segment.to] ?? 0;
    const bz = this.nodeZ[segment.to] ?? 0;
    const minX = Math.floor(Math.min(ax, bx) / CELL_METERS);
    const maxX = Math.floor(Math.max(ax, bx) / CELL_METERS);
    const minZ = Math.floor(Math.min(az, bz) / CELL_METERS);
    const maxZ = Math.floor(Math.max(az, bz) / CELL_METERS);
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const key = (x + 4096) * 8192 + z + 4096;
        const bucket = this.segmentCells.get(key);
        if (bucket) bucket.push(index);
        else this.segmentCells.set(key, [index]);
      }
    }
  }

  private heuristic(from: number, to: number): number {
    const dx = (this.nodeX[from] ?? 0) - (this.nodeX[to] ?? 0);
    const dz = (this.nodeZ[from] ?? 0) - (this.nodeZ[to] ?? 0);
    return Math.hypot(dx, dz);
  }

  private reconstruct(from: number, to: number): number[] {
    const path: number[] = [to];
    let current = to;
    while (current !== from && path.length < 1024) {
      const parent = this.previous[current] ?? NO_NODE;
      if (parent === NO_NODE) return [];
      path.push(parent);
      current = parent;
    }
    return current === from ? path.reverse() : [];
  }
}
