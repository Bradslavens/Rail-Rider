import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BLOOM_LAYER } from "./bloomLayer.ts";
import type { TrackPath } from "../sim/trackPath.ts";

/** Per-car length (m) — matches a Siemens S70 low-floor LRV. */
export const CAR_LEN = 23;
/** Coupler gap between cars (m). */
const CAR_GAP = 0.9;
/** Distance between consecutive car centers along the track. */
export const CAR_SPACING = CAR_LEN + CAR_GAP;
/** Number of cars in the consist. */
export const CAR_COUNT = 3;
/** Total train length — the spawn point must be at least this far up-track. */
export const TRAIN_SPAN = CAR_SPACING * (CAR_COUNT - 1) + CAR_LEN;

/**
 * Articulation joints in car-local z (front → rear), located at the roof-seam
 * waists of the GLB. They split the car into the S70's long–short–long body
 * sections, each of which rides the track on its own tangent.
 */
const SECTION_CUTS = [3.24, -2.87];

export interface TrolleyMesh {
  group: THREE.Group;
  /** Tint the destination signs to the active line's color. */
  setColor: (colorHex: string) => void;
  /** Swap head/tail lights when the driving direction flips. */
  setReverse: (reverse: boolean) => void;
  /** Pose all cars along the track; `s` is the lead car's center arc-length. */
  pose: (path: TrackPath, s: number) => void;
}

// SD Trolley livery bands, painted by normalized height over the body.
const C_UNDERFRAME = new THREE.Color(0x23262a);
const C_BODY_RED = new THREE.Color(0xc0121d);
const C_WINDOW = new THREE.Color(0x0e1216);
const C_ROOF = new THREE.Color(0x9aa1a8);

/**
 * Paint the raw (untextured) Meshy mesh with vertex colors approximating the
 * San Diego Trolley livery: dark underframe, red body, a black window band
 * aligned with the model's embossed side windows (h ≈ 0.35–0.64), red again up
 * to the roofline, and a light gray roof. The cab end caps get a taller black
 * windshield band instead of the side-window one.
 */
function paintLivery(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const posAttr = geometry.getAttribute("position");
  const colors = new Float32Array(posAttr.count * 3);
  const spanY = bb.max.y - bb.min.y;
  const capZ = (bb.max.z - bb.min.z) / 2 - 2.0; // end caps: nose/windshield zone

  for (let i = 0; i < posAttr.count; i++) {
    const h = (posAttr.getY(i) - bb.min.y) / spanY;
    const isCap = Math.abs(posAttr.getZ(i)) > capZ;
    let c: THREE.Color;
    if (h < 0.19) c = C_UNDERFRAME;
    else if (h >= 0.88) c = C_ROOF;
    else if (isCap) c = h >= 0.42 ? C_WINDOW : C_BODY_RED;
    else if (h < 0.35) c = C_BODY_RED;
    else if (h < 0.64) c = C_WINDOW;
    else if (h < 0.86) c = C_BODY_RED;
    else c = C_ROOF;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/**
 * Split the car geometry at the articulation cuts. Triangles are bucketed by
 * centroid z — the cuts fall in the bellows seams, so no clean clipping is
 * needed. The returned geometries share the car's vertex attributes and carry
 * only their own index.
 */
function splitSections(geometry: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const index = geometry.getIndex()!;
  const posAttr = geometry.getAttribute("position");
  const buckets: number[][] = [[], [], []];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const z = (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3;
    const k = z >= SECTION_CUTS[0] ? 0 : z >= SECTION_CUTS[1] ? 1 : 2;
    buckets[k].push(a, b, c);
  }
  return buckets.map((idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", posAttr);
    g.setAttribute("normal", geometry.getAttribute("normal"));
    g.setAttribute("color", geometry.getAttribute("color"));
    g.setIndex(idx);
    return g;
  });
}

/** Emissive fixtures at one end of a car: two lamps plus a beam spotlight. */
interface EndLights {
  lamps: THREE.MeshStandardMaterial;
  beam?: THREE.SpotLight;
}

function addEndLights(
  parent: THREE.Group,
  zEnd: number,
  kind: "head" | "tail",
  withBeam: boolean,
): EndLights {
  const isHead = kind === "head";
  const mat = new THREE.MeshStandardMaterial({
    color: isHead ? 0xfff4cf : 0x3a0d0d,
    emissive: isHead ? 0xffe9a8 : 0xff2222,
    emissiveIntensity: 0,
  });
  // The nose rakes back ~0.25 m at lamp height, so tuck the lamps in flush.
  const dir = Math.sign(zEnd);
  for (const dx of [-0.78, 0.78]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 20), mat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(dx, 1.15, zEnd - dir * 0.32);
    lamp.layers.enable(BLOOM_LAYER);
    parent.add(lamp);
  }

  let beam: THREE.SpotLight | undefined;
  if (withBeam) {
    beam = new THREE.SpotLight(0xfff0c2, 0, 90, Math.PI / 7, 0.45, 1.2);
    beam.position.set(0, 1.2, zEnd);
    beam.target.position.set(0, 0.4, zEnd + dir * 45);
    parent.add(beam, beam.target);
  }
  return { lamps: mat, beam };
}

/** One independently posed body section: its pivot is the section center. */
interface Section {
  group: THREE.Group;
  /** Section center in car-local z. */
  center: number;
  /** Half the section length — track tangents are sampled at ±this. */
  half: number;
}

/**
 * Build a 3-car consist from the Meshy GLB. Each car is split at its
 * articulation joints into three body sections, and every section rides its
 * own pair of track sample points — so cars bend through curves at the
 * bellows exactly like the real articulated vehicle. The outward cab ends
 * carry working head/tail lights that swap with the driving direction, and
 * roof-mounted destination signs take the line color.
 */
export async function buildTrolley(colorHex: string): Promise<TrolleyMesh> {
  const gltf = await new GLTFLoader().loadAsync("models/trolley.glb");

  // The raw scan ships positions+indices only: orient long axis to Z, ground
  // it on the railhead, scale to car length, then paint and light it.
  let source: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !source) source = m.geometry;
  });
  if (!source) throw new Error("trolley.glb contains no mesh");
  const geometry = (source as THREE.BufferGeometry).clone();

  geometry.rotateY(Math.PI / 2); // long axis X -> Z
  geometry.computeBoundingBox();
  let bb = geometry.boundingBox!;
  const scale = CAR_LEN / (bb.max.z - bb.min.z);
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  bb = geometry.boundingBox!;
  geometry.translate(
    -(bb.min.x + bb.max.x) / 2,
    -bb.min.y + 0.25, // clear the railhead
    -(bb.min.z + bb.max.z) / 2,
  );
  geometry.computeVertexNormals();
  paintLivery(geometry);
  const sectionGeos = splitSections(geometry);

  const bodyMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.18,
  });
  const bellowsMat = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.9 });

  const group = new THREE.Group();
  const sections: Section[][] = []; // [car][section], front → rear
  const signMats: THREE.MeshStandardMaterial[] = [];

  const bounds = [CAR_LEN / 2, ...SECTION_CUTS, -CAR_LEN / 2];
  const frontZ = CAR_LEN / 2;
  let headFront!: EndLights;
  let tailFront!: EndLights;
  let headRear!: EndLights;
  let tailRear!: EndLights;

  for (let i = 0; i < CAR_COUNT; i++) {
    const carSections: Section[] = [];
    for (let k = 0; k < 3; k++) {
      const zA = bounds[k + 1];
      const zB = bounds[k];
      const center = (zA + zB) / 2;
      const sec = new THREE.Group();

      // Shift the mesh so the section's center is the group's pivot.
      const mesh = new THREE.Mesh(sectionGeos[k], bodyMat);
      mesh.position.z = -center;
      sec.add(mesh);

      // The short center section carries a dark bellows over each joint.
      if (k === 1) {
        for (const cut of SECTION_CUTS) {
          const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.45, 3.0, 1.3), bellowsMat);
          bellows.position.set(0, 2.0, cut - center);
          sec.add(bellows);
        }
      }

      group.add(sec);
      carSections.push({ group: sec, center, half: (zB - zA) / 2 });
    }
    sections.push(carSections);

    // Destination sign + light fixtures on the consist's outward cab ends,
    // parented to the end section so they articulate with it.
    const ends: Array<{ sec: Section; zEnd: number }> = [];
    if (i === 0) ends.push({ sec: carSections[0], zEnd: frontZ });
    if (i === CAR_COUNT - 1) ends.push({ sec: carSections[2], zEnd: -frontZ });
    for (const { sec, zEnd } of ends) {
      const zLocal = zEnd - sec.center;
      const signMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: 0.8,
      });
      // Lit but kept off the bloom layer — bloom turns it into a color blob.
      // The windshield rakes back ~0.7 m at sign height; keep the sign flush.
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 0.08), signMat);
      sign.position.set(0, 3.1, zLocal - Math.sign(zEnd) * 0.69);
      sec.group.add(sign);
      signMats.push(signMat);

      if (zEnd > 0) {
        headFront = addEndLights(sec.group, zLocal, "head", true);
        tailFront = addEndLights(sec.group, zLocal, "tail", false);
      } else {
        headRear = addEndLights(sec.group, zLocal, "head", true);
        tailRear = addEndLights(sec.group, zLocal, "tail", false);
      }
    }
  }

  function applyDirection(reverse: boolean): void {
    const headOn = reverse ? headRear : headFront;
    const headOff = reverse ? headFront : headRear;
    const tailOn = reverse ? tailFront : tailRear;
    const tailOff = reverse ? tailRear : tailFront;
    headOn.lamps.emissiveIntensity = 1.6;
    headOff.lamps.emissiveIntensity = 0;
    tailOn.lamps.emissiveIntensity = 1.2;
    tailOff.lamps.emissiveIntensity = 0;
    if (headOn.beam) headOn.beam.intensity = 250;
    if (headOff.beam) headOff.beam.intensity = 0;
  }
  applyDirection(false);

  return {
    group,
    setColor: (hex: string) => {
      for (const m of signMats) m.emissive.set(hex);
    },
    setReverse: applyDirection,
    pose: (path: TrackPath, s: number) => {
      for (let i = 0; i < CAR_COUNT; i++) {
        const sCar = s - i * CAR_SPACING;
        for (const sec of sections[i]) {
          const sc = sCar + sec.center;
          const f = path.positionAt(sc + sec.half);
          const r = path.positionAt(sc - sec.half);
          sec.group.position.set((f.x + r.x) / 2, 0, (f.z + r.z) / 2);
          sec.group.rotation.y = Math.atan2(f.x - r.x, f.z - r.z);
        }
      }
    },
  };
}
