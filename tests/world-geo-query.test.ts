import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IndexedWorldGeoQuery,
  createGeoEnvironmentBridge,
  loadWorldGeoQuery,
} from '../src/world/world-geo-query';
import type { BusStopsCatalog, LandmarksCatalog, PortalsCatalog } from '../src/world/geo-contracts';

const PORTALS_SAMPLE: PortalsCatalog = {
  schemaVersion: 1,
  crs: 'EPSG:25829',
  source: 'test-fixture',
  rawInBoundsCount: 3,
  dedupedParcelCount: 0,
  count: 3,
  portals: [
    {
      id: 'p_001',
      street: 'Calle Adarve Santa Ana',
      number: '12',
      postalCode: '10003',
      kind: 'entrance',
      x: -42.34,
      y: 457.3,
      z: -94.6,
      heading: 2.08,
      chunkId: '-1_-1',
      zone: 'casco',
      district: 'casco',
      use: 'commercial',
      buildingId: 'w732194952',
      roadNodeId: 'n419385668',
      roadPoint: [-41.43, -95.11],
    },
    {
      id: 'p_002',
      street: 'Avenida de España',
      number: '7',
      postalCode: '10001',
      kind: 'entrance',
      x: -480.0,
      y: 444.2,
      z: -310.0,
      heading: 0.4,
      chunkId: '-2_-2',
      zone: 'ensanche',
      district: 'canovas_centro',
      use: 'residential',
      buildingId: 'w111',
      roadNodeId: 'n111',
      roadPoint: [-478.0, -305.0],
    },
    {
      id: 'p_003',
      street: 'Calle Pintores',
      number: '4',
      postalCode: '10003',
      kind: 'parcel',
      x: -15.0,
      y: 454.8,
      z: 30.0,
      heading: -1.1,
      chunkId: '-1_0',
      zone: 'casco',
      district: 'casco',
      use: 'residential',
      buildingId: 'w222',
      roadNodeId: 'n222',
      roadPoint: [-12.0, 31.0],
    },
  ],
};

const STOPS_SAMPLE: BusStopsCatalog = {
  schemaVersion: 1,
  crs: 'EPSG:25829',
  source: 'test-fixture',
  count: 2,
  stops: [
    {
      id: 'n4313286122',
      name: 'Plaza Obispo Galarza',
      nameSource: 'osm',
      ref: '001',
      lineRefs: [],
      hasShelter: false,
      hasBench: false,
      hasBin: false,
      tactilePaving: false,
      x: -164.7,
      y: 444.2,
      z: 130.82,
      chunkId: '-1_0',
      zone: 'casco',
      roadNodeId: 'n6703145467',
      roadSegmentId: 'w33176189:8',
      roadPoint: [-173.07, 124.96],
      roadDistanceMeters: 10.22,
      heading: -0.6108,
    },
    {
      id: 'n640511376',
      name: 'Campus (fte. a Politécnica)',
      nameSource: 'osm',
      ref: '73',
      lineRefs: ['L8'],
      hasShelter: true,
      hasBench: true,
      hasBin: false,
      tactilePaving: false,
      x: 2522.94,
      y: 412.5,
      z: 694.49,
      chunkId: '9_2',
      zone: 'periferia',
      roadNodeId: 'n500',
      roadSegmentId: 'w500:0',
      roadPoint: [2520.0, 690.0],
      roadDistanceMeters: 5.3,
      heading: 1.57,
    },
  ],
};

const LANDMARKS_SAMPLE: LandmarksCatalog = {
  schemaVersion: 1,
  region: 'cc-monumental',
  crs: 'EPSG:25829 local meters',
  landmarks: [
    {
      id: 'torre-de-bujaco',
      name: 'Torre de Bujaco',
      scope: 'cc-monumental',
      aliases: [],
      keyFeatures: [],
      references: [],
      sourceIds: ['w385037728'],
      position: { lon: -6.37, lat: 39.47, localMeters: [48.69, 87.68] },
      heightMeters: null,
      heightSource: null,
      heightFromLevelsMeters: null,
    },
  ],
};

describe('WorldGeoQuery spatial index and contracts', () => {
  it('queries nearest portals with filters, building lookup, and normalized Spanish search', () => {
    const query = new IndexedWorldGeoQuery(PORTALS_SAMPLE, STOPS_SAMPLE, LANDMARKS_SAMPLE);
    expect(query.portalCount).toBe(3);

    const nearCasco = query.findNearestPortal(-20, 20, { maxDistanceMeters: 120 });
    expect(nearCasco?.item.id).toBe('p_003');

    const entranceOnly = query.findNearestPortal(-20, 20, {
      maxDistanceMeters: 200,
      kind: 'entrance',
    });
    expect(entranceOnly?.item.id).toBe('p_001');

    expect(query.getPortalsForBuilding('w732194952').map((p) => p.id)).toEqual(['p_001']);
    expect(query.searchPortals('espana canovas').map((p) => p.id)).toEqual(['p_002']);
  });

  it('provides road-snapped vehicle stop anchors and environment bridge callbacks', () => {
    const query = new IndexedWorldGeoQuery(PORTALS_SAMPLE, STOPS_SAMPLE, LANDMARKS_SAMPLE);
    const stop = query.findNearestBusStop(2510, 690, 50);
    expect(stop?.item.id).toBe('n640511376');

    const anchor = query.toVehicleStopAnchor(stop!.item, 6);
    expect(anchor.roadSegmentId).toBe('w500:0');
    expect(anchor.stopPosition).toEqual([2520.0, 412.5, 690.0]);
    expect(anchor.stopRadiusMeters).toBe(6);

    const bridge = createGeoEnvironmentBridge({
      geo: query,
      worldRegion: 'cc-monumental',
      groundHeightAt: (x, z) => (x === 10 && z === 20 ? 451.5 : undefined),
      collidesWithBuilding: (x, z) => Math.hypot(x, z) < 5,
    });
    expect(bridge.sampleGroundHeight(10, 20)).toBe(451.5);
    expect(bridge.isFootprintFree(0, 0, 1)).toBe(false);
    expect(bridge.isFootprintFree(50, 50, 1)).toBe(true);
  });

  it('loads catalogs from relative URLs matching subpath hosting', async () => {
    const requested: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      requested.push(url);
      const body = url.includes('portals.json')
        ? PORTALS_SAMPLE
        : url.includes('bus-stops.json')
          ? STOPS_SAMPLE
          : LANDMARKS_SAMPLE;
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const geo = await loadWorldGeoQuery('https://example.github.io/CTA/', { fetcher: mockFetch });
    expect(requested).toEqual([
      'https://example.github.io/CTA/data/world/portals.json',
      'https://example.github.io/CTA/data/world/bus-stops.json',
      'https://example.github.io/CTA/data/landmarks/landmarks.json',
    ]);
    expect(geo.landmarkCount).toBe(1);
    expect(geo.findNearestLandmark(49, 88, 30)?.item.id).toBe('torre-de-bujaco');
  });

  it('validates exported production-ready portals.json and bus-stops.json catalogs on disk', async () => {
    const root = process.cwd();
    const [portalsRaw, stopsRaw, landmarksRaw] = await Promise.all([
      readFile(path.join(root, 'public/data/world/portals.json'), 'utf8'),
      readFile(path.join(root, 'public/data/world/bus-stops.json'), 'utf8'),
      readFile(path.join(root, 'public/data/landmarks/landmarks.json'), 'utf8'),
    ]);
    const portals = JSON.parse(portalsRaw) as PortalsCatalog;
    const stops = JSON.parse(stopsRaw) as BusStopsCatalog;
    const landmarks = JSON.parse(landmarksRaw) as LandmarksCatalog;
    const query = new IndexedWorldGeoQuery(portals, stops, landmarks);

    expect(query.portalCount).toBeGreaterThan(15_000);
    expect(query.busStopCount).toBeGreaterThanOrEqual(200);
    expect(query.landmarkCount).toBe(19);

    const plazaPortal = query.findNearestPortal(-23.56, 14.51, { maxDistanceMeters: 5 });
    expect(plazaPortal?.item.y).toBeGreaterThan(400);
    expect(plazaPortal?.item.y).toBeLessThan(550);
    expect(plazaPortal?.item.district).not.toBe('ensanche');

    const galarzaStop = query.getBusStopById('n4313286122');
    expect(galarzaStop?.y).toBeGreaterThan(400);
    expect(galarzaStop?.y).toBeLessThan(550);
    expect(galarzaStop?.roadSegmentId).toBeTruthy();
  });
});
